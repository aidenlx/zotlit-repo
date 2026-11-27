import type { DesktopSlot } from "#desktop-slot";
import type { LandCiRun } from "#land-queue";
import { regex } from "arkregex";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { SOURCE_BRANCH } from "@zotlit/config/repositories";

import { attributionLines, isAgentBranch } from "#ai-attribution";
import {
  CONVENTIONAL_FORMAT,
  isConventionalSubject,
} from "#conventional-commit";
import {
  acquireDesktopSlot,
  describeLeaseEnd,
  DesktopSlotBlockedError,
  EXIT_ADMISSION_BLOCKED,
  formatDuration,
  SILENCE_LIMIT_MS,
  throttledProgress,
} from "#desktop-slot";
import { verifyHalf } from "#gate-halves";
import {
  landAdmission,
  landStateDir,
  landWaitLog,
  recordLandWait,
} from "#land-queue";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const LAND_WAIT_MS = HOUR;
export const LAND_CONFLICT_CHECK_MS = MINUTE;
export const LAND_CONFLICT_FETCH_TIMEOUT_MS = 30_000;
export const LAND_ATTEMPTS = 3;

const TRUNK = SOURCE_BRANCH;

export const LAND_GATES = {
  change: verifyHalf("local"),
  release: ["pnpm", "verify", "--release"],
} as const satisfies Record<string, readonly [string, ...string[]]>;

export const LAND_INSTALL = [
  "pnpm",
  "install",
  "--frozen-lockfile",
  "--prefer-offline",
] as const satisfies readonly [string, ...string[]];

export type LandStep =
  | "preflight"
  | "queue"
  | "fetch"
  | "rebase"
  | "install"
  | "gate"
  | "record"
  | "ci"
  | "push"
  | "lease";

export const LAND_RECORD_PATH = ".scratch/land-record.md";

export const LAND_RECORD_SECTIONS = [
  "Summary",
  "Testing",
  "Risk",
  "How to revert",
  "Review",
  "Open points",
  "e2e",
] as const;

export const LAND_CI_CHECK = "Record PR tests";
export const RECORD_PR_WORKFLOW = ".github/workflows/record-pr.yml";
export const LAND_CI_TIMEOUT_MINUTES = 40;
export const LAND_CI_WAIT_MS = (LAND_CI_TIMEOUT_MINUTES + 5) * MINUTE;
export const LAND_AFTER_CI_MARKER = "<!-- zotlit-land: after-ci -->";
export const LAND_WORKFLOW = ".github/workflows/land.yml";
export const LAND_PR_PATH = ".scratch/land-pr.md";
export const LAND_AFTER_CI_WAIT_MS = 15 * MINUTE;
const LAND_AFTER_CI_POLL_MS = 10_000;
const LAND_CI_POLL_MS = 30_000;
const LAND_MERGED_WAIT_MS = 30_000;
const LAND_MERGED_POLL_MS = 2_000;

export interface CiCheck {
  id: number;
  status:
    | "queued"
    | "in_progress"
    | "completed"
    | "waiting"
    | "requested"
    | "pending";
  conclusion: string | null;
  url: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface RecordPullRequest {
  number: number;
  url: string;
}

export interface OpenRecordPullRequest extends RecordPullRequest {
  title: string;
  body: string;
  draft: boolean;
}

export interface LandGitHub {
  advanceMain: (
    input: { number: number; head: string; base: string },
    progress: (line: string) => void,
  ) => Promise<void>;
  findOpenPullRequest: (query: {
    head: string;
    base: string;
  }) => Promise<OpenRecordPullRequest | undefined>;
  createPullRequest: (pull: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }) => Promise<RecordPullRequest>;
  editPullRequest: (
    number: number,
    pull: { title: string; body: string },
  ) => Promise<void>;
  setDraft: (number: number, draft: boolean) => Promise<void>;
  pullRequestState: (number: number) => Promise<"OPEN" | "CLOSED" | "MERGED">;
  readCheck: (query: {
    commit: string;
    name: string;
    branch: string;
  }) => Promise<CiCheck | undefined>;
}

export interface LandOptions {
  cwd: string;
  squash?: boolean;
  record?: LandRecord;
  gate?: readonly [string, ...string[]];
  install?: readonly [string, ...string[]];
  github?: LandGitHub;
  remote?: string;
  queueDir?: string;
  logDir?: string;
  waitLog?: string;
  waitMs?: number;
  conflictCheckMs?: number;
  conflictFetchTimeoutMs?: number;
  silenceMs?: number;
  pollMs?: number;
  attempts?: number;
  /** How long the land waits for the CI check. @default LAND_CI_WAIT_MS */
  ciWaitMs?: number;
  /** How often the land reads the CI check. @default 30 s */
  ciPollMs?: number;
  afterCi?: boolean;
  draft?: boolean;
  afterCiWaitMs?: number;
  afterCiPollMs?: number;
  /**
   * How long the land reads the record PR's state after the push of `main`.
   * @default LAND_MERGED_WAIT_MS
   */
  mergedWaitMs?: number;
  /** How often it reads the state in that time. @default LAND_MERGED_POLL_MS */
  mergedPollMs?: number;
  say?: (line: string) => void;
}

export type LandResult =
  | {
      ok: true;
      attempts: number;
      waitMs: number;
      logPath: string;
      record?: RecordPullRequest & { merged: boolean };
      draft?: true;
    }
  | {
      ok: false;
      step: LandStep;
      message: string;
      logPath: string;
      exitCode: number;
    };

class LandFailure extends Error {
  readonly step: LandStep;
  readonly exitCode: number;

  constructor(step: LandStep, message: string, exitCode = 1) {
    super(message);
    this.step = step;
    this.exitCode = exitCode;
  }
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

class Shell {
  #current: ChildProcess | undefined;
  readonly #cwd: string;
  readonly #log: WriteStream;
  progress: ((what: string) => void) | undefined;

  constructor(cwd: string, log: WriteStream) {
    this.#cwd = cwd;
    this.#log = log;
  }

  run(
    command: string,
    args: readonly string[],
    timeoutMs?: number,
  ): Promise<RunResult> {
    this.#log.write(`\n$ ${[command, ...args].join(" ")}\n`);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.#cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      this.#current = child;
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.#log.write(`(timed out after ${timeoutMs} ms)\n`);
              this.stop("SIGTERM");
            }, timeoutMs);
      let stdout = "";
      let stderr = "";
      const what = `output of ${command} ${args[0] ?? ""}`.trim();
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk;
        this.#log.write(chunk);
        this.progress?.(what);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk;
        this.#log.write(chunk);
        this.progress?.(what);
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (this.#current === child) this.#current = undefined;
        if (signal) this.#log.write(`(ended by ${signal})\n`);
        resolve({ code: code ?? 128, stdout, stderr });
      });
    });
  }

  async git(step: LandStep, ...args: string[]): Promise<string> {
    const result = await this.run("git", args);
    if (result.code !== 0) {
      throw new LandFailure(
        step,
        `git ${args.join(" ")} exited ${result.code}: ${result.stderr.trim()}`,
      );
    }
    return result.stdout.trim();
  }

  async test(...args: string[]): Promise<boolean> {
    return (await this.run("git", args)).code === 0;
  }

  stop(signal: NodeJS.Signals): void {
    const child = this.#current;
    if (!child?.pid) return;
    try {
      process.kill(
        process.platform === "win32" ? child.pid : -child.pid,
        signal,
      );
    } catch {
      // Gone already.
    }
  }
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export async function land(options: LandOptions): Promise<LandResult> {
  const { cwd } = options;
  const to = TRUNK;
  const remote = options.remote ?? "origin";
  const silenceMs = options.silenceMs ?? SILENCE_LIMIT_MS.childOutput;
  const say = options.say ?? ((line: string) => console.error(line));
  const logDir = options.logDir ?? join(landStateDir(), "logs");
  await mkdir(logDir, { recursive: true });
  const stamp = Temporal.Now.instant().toString().replaceAll(":", "-");
  const logPath = join(logDir, `${stamp}-${process.pid}.log`);
  const log = createWriteStream(logPath, { flags: "a" });
  const sh = new Shell(cwd, log);
  say(`Land log: ${logPath}`);

  let slot: DesktopSlot | undefined;
  let leaseOver: string | undefined;
  let source = "";
  let attempts = 0;
  let current: LandStep = "preflight";
  const ciRuns: LandCiRun[] = [];
  let enqueuedAt = Temporal.Now.instant();
  const onSignal = (signal: NodeJS.Signals) => {
    sh.stop("SIGTERM");
    slot?.release();
    process.exit(
      128 + (signal === "SIGINT" ? 2 : signal === "SIGHUP" ? 1 : 15),
    );
  };

  try {
    if (options.draft && options.afterCi) {
      throw new LandFailure(
        "preflight",
        `--draft opens a draft record PR, and ${LAND_WORKFLOW} does not land a draft, so --after-ci cannot go with it. Run pnpm land --draft without --after-ci.`,
      );
    }
    const pre = await preflight(sh, remote);
    const squash = options.squash ?? Boolean(options.github);
    const record =
      options.record ??
      (options.github || squash ? await readRecord(sh) : undefined);
    await checkSubjects(sh, {
      squashTitle: squash ? record?.title : undefined,
      upstream: `${remote}/${to}`,
    });
    if (options.github) await checkGitHub(options.github, pre.branch);
    source = pre.branch;
    say(`Land ${source} into ${to}: waiting for the Land Turn.`);
    for (const signal of SIGNALS) process.on(signal, onSignal);
    current = "queue";
    enqueuedAt = Temporal.Now.instant();
    try {
      slot = await acquireDesktopSlot({
        admission: landAdmission(),
        ...(options.queueDir ? { dir: options.queueDir } : {}),
        cwd,
        command: `land ${source} into ${to}`,
        silenceMs,
        waitMs: options.waitMs ?? LAND_WAIT_MS,
        ...(options.pollMs ? { pollMs: options.pollMs } : {}),
        signals: false,
        whileWaiting: conflictWatch(sh, log, {
          remote,
          to,
          everyMs: options.conflictCheckMs ?? LAND_CONFLICT_CHECK_MS,
          fetchTimeoutMs:
            options.conflictFetchTimeoutMs ?? LAND_CONFLICT_FETCH_TIMEOUT_MS,
        }),
        log: (line) => {
          say(line);
          log.write(`${line}\n`);
        },
        onLeaseEnd: (owner) => {
          leaseOver = describeLeaseEnd(
            owner,
            Temporal.Now.instant().epochMilliseconds,
          );
          log.write(`\nThe Lease of the Land Turn ended: ${leaseOver}.\n`);
          sh.stop("SIGTERM");
        },
      });
    } catch (error) {
      if (!(error instanceof DesktopSlotBlockedError)) throw error;
      throw new LandFailure("queue", error.message, EXIT_ADMISSION_BLOCKED);
    }
    const turn = slot;
    sh.progress = throttledProgress(
      (what) => turn.progress(what),
      Math.min(5_000, silenceMs / 10),
    );
    const waitMs = sinceEnqueue(Temporal.Instant.from(slot.owner.admittedAt));
    say(`Land Turn taken after ${(waitMs / 1000).toFixed(1)} s.`);

    const step = async <T>(name: LandStep, run: () => Promise<T>) => {
      if (leaseOver) throw leaseEnded(leaseOver);
      current = name;
      turn.progress(name);
      say(`▸ ${name}`);
      log.write(`\n▸ ${name}\n`);
      let value: T;
      try {
        value = await run();
      } catch (error) {
        if (leaseOver) throw leaseEnded(leaseOver);
        throw error;
      }
      if (leaseOver) throw leaseEnded(leaseOver);
      return value;
    };
    const maxAttempts = options.attempts ?? LAND_ATTEMPTS;
    let pull: RecordPullRequest | undefined;
    for (;;) {
      attempts += 1;
      await step("fetch", () => fetchTarget(sh, remote, to));
      const base = await sh.git("rebase", "rev-parse", `${remote}/${to}`);
      const reinstall = await step("rebase", async () => {
        const before = await sh.git("rebase", "rev-parse", "HEAD");
        await rebaseOnto(sh, base, pre.head);
        if (squash && record) {
          const message = `${record.title}\n\n${record.body}`;
          if (attributionLines(message).length) {
            throw new LandFailure(
              "rebase",
              "Remove AI attribution from the squash message in the land record.",
            );
          }
          const head = await sh.git("rebase", "rev-parse", "HEAD");
          const tree = await sh.git("rebase", "rev-parse", "HEAD^{tree}");
          if (
            (await sh.git("rebase", "show", "-s", "--format=%P%n%B", head)) !==
            `${base}\n${message}`
          ) {
            const commit = await sh.git(
              "rebase",
              "commit-tree",
              tree,
              "-p",
              base,
              "-m",
              message,
            );
            await sh.git(
              "rebase",
              "update-ref",
              "-m",
              "land --squash",
              "HEAD",
              commit,
              head,
            );
          }
        }
        return changesInstallInputs(sh, before);
      });
      const install = options.install ?? LAND_INSTALL;
      if (reinstall) {
        await step("install", async () => {
          const [command, ...args] = install;
          const result = await sh.run(command, args);
          if (result.code !== 0) {
            throw new LandFailure(
              "install",
              `${install.join(" ")} exited ${result.code}. The branch is rebased onto ${remote}/${to}, whose dependency files differ from the ones installed here. Run ${install.join(" ")}, fix what it names, and land again.`,
            );
          }
        });
      }
      const gate = options.gate;
      if (gate) {
        await step("gate", async () => {
          const [command, ...args] = gate;
          const result = await sh.run(command, args);
          if (result.code !== 0) {
            throw new LandFailure(
              "gate",
              `${gate.join(" ")} exited ${result.code}.`,
            );
          }
        });
      } else {
        say("The gate is skipped; the CI check still runs.");
      }
      const github = options.github;
      let pushed: boolean;
      if (github && record) {
        pull = await step("record", () =>
          openRecord(sh, github, {
            cwd,
            afterCi: options.afterCi ?? false,
            draft: options.draft ?? false,
            remote,
            branch: pre.branch,
            base: to,
            record: options.afterCi
              ? { ...record, body: `${record.body}\n\n${LAND_AFTER_CI_MARKER}` }
              : record,
            say,
          }),
        );
        if (options.draft) {
          await finish("draft");
          say(`Draft record PR: ${pull.url}. ${to} is unchanged.`);
          return {
            ok: true,
            draft: true,
            attempts,
            waitMs,
            logPath,
            record: { ...pull, merged: false },
          };
        }
        const head = await sh.git("ci", "rev-parse", "HEAD");
        await step("ci", () =>
          waitForCi(github, {
            commit: head,
            branch: pre.branch,
            waitMs: options.ciWaitMs ?? LAND_CI_WAIT_MS,
            pollMs: options.ciPollMs ?? LAND_CI_POLL_MS,
            say,
            progress: (what) => turn.progress(what),
            leaseOver: () => leaseOver,
            runs: ciRuns,
          }),
        );
        pushed = await step("push", async () => {
          if (options.afterCi) {
            return await waitForMain(sh, {
              remote,
              to,
              head,
              base,
              waitMs: options.afterCiWaitMs ?? LAND_AFTER_CI_WAIT_MS,
              pollMs: options.afterCiPollMs ?? LAND_AFTER_CI_POLL_MS,
              say,
              progress: () => {
                if (leaseOver) throw leaseEnded(leaseOver);
                turn.progress("push");
              },
            });
          }
          const dispatched = await github
            .advanceMain({ number: pull!.number, head, base }, (line) => {
              if (leaseOver) throw leaseEnded(leaseOver);
              say(line);
              turn.progress("push");
            })
            .catch((error: unknown) =>
              error instanceof Error ? error : new Error(String(error)),
            );
          await fetchTarget(sh, remote, to);
          if (
            await sh.test(
              "merge-base",
              "--is-ancestor",
              head,
              `${remote}/${to}`,
            )
          )
            return true;
          if ((await sh.git("push", "rev-parse", `${remote}/${to}`)) !== base)
            return false;
          throw dispatched instanceof Error
            ? dispatched
            : new LandFailure(
                "push",
                "The landing workflow finished before main reached the verified commit.",
              );
        });
      } else {
        pushed = await step("push", () => push(sh, remote, to));
      }
      if (pushed) break;
      if (attempts >= maxAttempts) {
        throw new LandFailure(
          "push",
          `${to} moved during each of ${attempts} attempts; land again.`,
        );
      }
      say(`${to} moved on ${remote} during the gate; fetching again.`);
    }
    const commit = await sh.git("push", "rev-parse", "HEAD");
    await updateLocalRef(sh, say, { to, commit });
    const merged =
      pull && options.github
        ? await readMerged(options.github, pull, {
            waitMs: options.mergedWaitMs ?? LAND_MERGED_WAIT_MS,
            pollMs: options.mergedPollMs ?? LAND_MERGED_POLL_MS,
            log: (line) => log.write(`${line}\n`),
          })
        : true;
    if (merged) {
      await deleteRemoteBranch(sh, say, { remote, branch: pre.branch });
    } else {
      say(
        `The record PR ${pull?.url} does not show as merged on GitHub. ${pre.branch} stays on ${remote}, so the PR stays open. Report it on the ticket of the land.`,
      );
    }
    await finish("landed");
    say(`Landed ${source} into ${to} at ${commit.slice(0, 12)}.`);
    return {
      ok: true,
      attempts,
      waitMs,
      logPath,
      ...(pull ? { record: { ...pull, merged } } : {}),
    };
  } catch (error) {
    const failure =
      error instanceof LandFailure
        ? error
        : new LandFailure(current, String((error as Error).stack ?? error));
    log.write(`\n✖ ${failure.step}: ${failure.message}\n`);
    await finish(failure.step === "queue" ? "blocked" : "failed", failure.step);
    return {
      ok: false,
      step: failure.step,
      message: failure.message,
      logPath,
      exitCode: failure.exitCode,
    };
  } finally {
    for (const signal of SIGNALS) process.off(signal, onSignal);
    slot?.release();
    await new Promise((resolve) => log.end(resolve));
  }

  function sinceEnqueue(instant: Temporal.Instant): number {
    return instant.epochMilliseconds - enqueuedAt.epochMilliseconds;
  }

  async function finish(
    outcome: "landed" | "draft" | "failed" | "blocked",
    failedStep?: LandStep,
  ) {
    if (!source) return;
    const admittedAt = slot
      ? Temporal.Instant.from(slot.owner.admittedAt)
      : undefined;
    await recordLandWait(
      {
        source,
        worktree: slot?.owner.worktree ?? cwd,
        enqueuedAt: enqueuedAt.toString(),
        ...(admittedAt ? { admittedAt: admittedAt.toString() } : {}),
        waitMs: sinceEnqueue(admittedAt ?? Temporal.Now.instant()),
        outcome,
        ...(failedStep ? { step: failedStep } : {}),
        ...(attempts ? { attempts } : {}),
        ...(ciRuns.length > 0 ? { ci: ciRuns } : {}),
        finishedAt: Temporal.Now.instant().toString(),
      },
      options.waitLog ?? landWaitLog(),
    );
  }
}

function leaseEnded(reason: string): LandFailure {
  return new LandFailure(
    "lease",
    `The Lease of the Land Turn ended before the land did: ${reason}.`,
  );
}

async function preflight(
  sh: Shell,
  remote: string,
): Promise<{ head: string; branch: string }> {
  const status = await sh.git("preflight", "status", "--porcelain");
  if (status) {
    throw new LandFailure(
      "preflight",
      `The worktree has changes that are not committed:\n${status}\nCommit them, then land again.`,
    );
  }
  const branch =
    (
      await sh.run("git", ["symbolic-ref", "--short", "-q", "HEAD"])
    ).stdout.trim() || undefined;
  if (!branch) {
    throw new LandFailure(
      "preflight",
      "HEAD is detached. Land from the task branch.",
    );
  }
  if (branch === TRUNK) {
    throw new LandFailure(
      "preflight",
      `Land from a task branch, not from ${TRUNK}.`,
    );
  }
  if (isAgentBranch(`refs/heads/${branch}`)) {
    throw new LandFailure(
      "preflight",
      `${branch} is an agent branch, which stays local: the push of the record PR would be refused after the gate. Rename the branch (git branch -m <type>/<topic>, such as feat/<topic>), then land again.`,
    );
  }
  await sh.git("preflight", "remote", "get-url", remote);
  return { head: await sh.git("preflight", "rev-parse", "HEAD"), branch };
}

async function checkSubjects(
  sh: Shell,
  {
    squashTitle,
    upstream,
  }: { squashTitle: string | undefined; upstream: string },
): Promise<void> {
  if (squashTitle !== undefined) {
    if (!isConventionalSubject(squashTitle)) {
      throw new LandFailure(
        "preflight",
        `The title of the record file ${LAND_RECORD_PATH}, "${squashTitle}", is the subject of the squash commit and is not a Conventional Commits subject. Write it as ${CONVENTIONAL_FORMAT}, such as "fix(annotations): keep the excerpt image size". Then land again.`,
      );
    }
    return;
  }
  const log = await sh.git(
    "preflight",
    "log",
    "--no-merges",
    "--format=%h %s",
    `${upstream}..HEAD`,
  );
  const wrong = log
    .split("\n")
    .filter(
      (line) =>
        line && !isConventionalSubject(line.slice(line.indexOf(" ") + 1)),
    );
  if (wrong.length > 0) {
    throw new LandFailure(
      "preflight",
      `These commits do not have a Conventional Commits subject:\n${wrong.join("\n")}\nReword each subject as ${CONVENTIONAL_FORMAT}, or land with the default squash. Then land again.`,
    );
  }
}

interface LandRecord {
  title: string;
  body: string;
}

const RECORD_TITLE = regex("^# (?<title>.+)$");
const RECORD_SECTION = regex("^## (?<name>.+)$");

async function readRecord(sh: Shell): Promise<LandRecord> {
  const root = await sh.git("preflight", "rev-parse", "--show-toplevel");
  const text = await readFile(join(root, LAND_RECORD_PATH), "utf8").catch(
    () => undefined,
  );
  if (text === undefined) {
    throw new LandFailure(
      "preflight",
      `The land has no record file at ${LAND_RECORD_PATH}. Write the record of the change there: a first line "# <title>", the title of the PR, then the sections ${LAND_RECORD_SECTIONS.map((name) => `"## ${name}"`).join(", ")}. Then land again.`,
    );
  }
  const [first = "", ...rest] = text.split("\n");
  const title = RECORD_TITLE.exec(first.trim())?.groups.title.trim();
  const headings = new Set(
    rest.flatMap((line) => {
      const name = RECORD_SECTION.exec(line.trim())?.groups.name;
      return name ? [name.trim().toLowerCase()] : [];
    }),
  );
  const missing = LAND_RECORD_SECTIONS.filter(
    (name) => !headings.has(name.toLowerCase()),
  );
  const problems = [
    ...(title ? [] : ["its first line is not a `# <title>` heading"]),
    ...(missing.length > 0
      ? [`it has no ${missing.map((name) => `## ${name}`).join(", ")} section`]
      : []),
  ];
  if (!title || problems.length > 0) {
    throw new LandFailure(
      "preflight",
      `The record file ${LAND_RECORD_PATH} is not complete: ${problems.join("; ")}. Complete it, then land again.`,
    );
  }
  return { title, body: rest.join("\n").trim() };
}

async function checkGitHub(github: LandGitHub, branch: string): Promise<void> {
  try {
    await github.findOpenPullRequest({ head: branch, base: TRUNK });
  } catch (error) {
    throw new LandFailure(
      "preflight",
      `GitHub refused a read of the record PR of ${branch}: ${(error as Error).message}\nFix the gh login (gh auth status), then land again.`,
    );
  }
}

async function openRecord(
  sh: Shell,
  github: LandGitHub,
  options: {
    cwd: string;
    afterCi: boolean;
    draft: boolean;
    remote: string;
    branch: string;
    base: string;
    record: LandRecord;
    say: (line: string) => void;
  },
): Promise<RecordPullRequest> {
  const { remote, branch, base, record, draft, say } = options;
  await sh.git(
    "record",
    "push",
    "--force",
    "--porcelain",
    remote,
    `HEAD:refs/heads/${branch}`,
  );
  try {
    const open = await github.findOpenPullRequest({ head: branch, base });
    if (open) {
      if (
        sameText(open.title, record.title) &&
        sameText(open.body, record.body)
      ) {
        say(`Record PR matches the record: ${open.url}`);
      } else {
        await github.editPullRequest(open.number, record);
        say(`Record PR updated: ${open.url}`);
      }
      if (open.draft !== draft) {
        await github.setDraft(open.number, draft);
        say(
          `Record PR ${draft ? "changed to a draft" : "marked ready for review"}: ${open.url}`,
        );
      }
      return open;
    }
    const created = await github.createPullRequest({
      head: branch,
      base,
      ...record,
      draft,
    });
    say(`Record PR opened${draft ? " as a draft" : ""}: ${created.url}`);
    return created;
  } catch (error) {
    const message = (error as Error).message;
    if (options.afterCi && message.includes(INTEGRATION_REFUSAL)) {
      await writeFile(
        join(options.cwd, LAND_PR_PATH),
        `# ${record.title}\n\n${record.body}\n`,
      );
      throw new LandFailure(
        "record",
        `GitHub refused this token a write to the record PR of ${branch}: ${message}\nThe branch is pushed. Open a PR from ${branch} into ${base} with the PR tool of the host. Use the first line of ${LAND_PR_PATH}, without "# ", as its title and the rest as its body, and keep the line ${LAND_AFTER_CI_MARKER}. Then run pnpm land --after-ci again: it finds that PR, leaves it as it is, and waits for CI and ${base}.`,
      );
    }
    throw new LandFailure(
      "record",
      `The record PR of ${branch} could not be opened or updated: ${message}`,
    );
  }
}

const INTEGRATION_REFUSAL = "Resource not accessible by integration";

function sameText(a: string, b: string): boolean {
  return (
    a.replaceAll("\r\n", "\n").trim() === b.replaceAll("\r\n", "\n").trim()
  );
}

async function waitForMain(
  sh: Shell,
  options: {
    remote: string;
    to: string;
    head: string;
    base: string;
    waitMs: number;
    pollMs: number;
    say: (line: string) => void;
    progress: () => void;
  },
): Promise<boolean> {
  const { remote, to, head, base, say } = options;
  say(
    `Waiting for the landing workflow (${LAND_WORKFLOW}) to fast-forward ${to} to ${head.slice(0, 12)}.`,
  );
  const started = Temporal.Now.instant().epochMilliseconds;
  for (;;) {
    options.progress();
    await fetchTarget(sh, remote, to);
    if (await sh.test("merge-base", "--is-ancestor", head, `${remote}/${to}`))
      return true;
    if ((await sh.git("push", "rev-parse", `${remote}/${to}`)) !== base)
      return false;
    if (Temporal.Now.instant().epochMilliseconds - started >= options.waitMs) {
      throw new LandFailure(
        "push",
        `${to} did not reach ${head.slice(0, 12)} within ${formatDuration(options.waitMs)}. Read the latest run of ${LAND_WORKFLOW} in GitHub Actions.`,
      );
    }
    await delay(options.pollMs);
  }
}

async function waitForCi(
  github: LandGitHub,
  options: {
    commit: string;
    branch: string;
    waitMs: number;
    pollMs: number;
    say: (line: string) => void;
    progress: (what: string) => void;
    leaseOver: () => string | undefined;
    runs: LandCiRun[];
  },
): Promise<void> {
  const { commit, branch, say } = options;
  const name = LAND_CI_CHECK;
  const short = commit.slice(0, 12);
  const started = Temporal.Now.instant().epochMilliseconds;
  for (;;) {
    const reason = options.leaseOver();
    if (reason) throw leaseEnded(reason);
    let check: CiCheck | undefined;
    try {
      check = await github.readCheck({ commit, name, branch });
    } catch (error) {
      throw new LandFailure(
        "ci",
        `GitHub refused a read of the "${name}" check of ${short}: ${(error as Error).message}`,
      );
    }
    const waited = Temporal.Now.instant().epochMilliseconds - started;
    if (check?.status === "completed") {
      options.runs.push(ciRun(check, commit, waited));
      say(
        `CI "${name}" of ${short}: ${check.conclusion} after ${seconds(waited)}${queueNote(check)}.`,
      );
      if (check.conclusion === "success") return;
      throw new LandFailure(
        "ci",
        `The CI check "${name}" ended ${check.conclusion} on ${short}. The log of the job that failed: ${check.url}\n${TRUNK} is unchanged. Fix the failure on this branch, commit, and land again; when the failure is not in the change, run the job again from its log page, then land again.`,
      );
    } else {
      const state = check ? check.status.replace("_", " ") : "not started";
      say(`CI "${name}" of ${short}: ${state} (${seconds(waited)}).`);
      options.progress(`ci: ${state}`);
    }
    if (waited >= options.waitMs) {
      throw new LandFailure(
        "ci",
        check
          ? `The "${name}" check of ${short} did not finish within ${formatDuration(options.waitMs)}: ${check.url}\n${TRUNK} is unchanged. Land again.`
          : `GitHub shows no "${name}" check for ${short} within ${formatDuration(options.waitMs)}. ${TRUNK} is unchanged. Check that the workflow of the record PR runs (${RECORD_PR_WORKFLOW}), then land again.`,
      );
    }
    await delay(options.pollMs);
  }
}

function ciRun(check: CiCheck, commit: string, waitMs: number): LandCiRun {
  const queueMs = between(check.queuedAt, check.startedAt);
  const runMs = between(check.startedAt, check.completedAt);
  return {
    commit,
    conclusion: check.conclusion ?? "unknown",
    url: check.url,
    waitMs,
    ...(queueMs === undefined ? {} : { queueMs }),
    ...(runMs === undefined ? {} : { runMs }),
  };
}

function between(from?: string, to?: string): number | undefined {
  return from && to
    ? Temporal.Instant.from(to).epochMilliseconds -
        Temporal.Instant.from(from).epochMilliseconds
    : undefined;
}

function queueNote(check: CiCheck): string {
  const ms = between(check.queuedAt, check.startedAt);
  return ms === undefined
    ? ""
    : `; a shard waited up to ${seconds(ms)} for a runner`;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

async function readMerged(
  github: LandGitHub,
  pull: RecordPullRequest,
  options: { waitMs: number; pollMs: number; log: (line: string) => void },
): Promise<boolean> {
  const now = () => Temporal.Now.instant().epochMilliseconds;
  const deadline = now() + options.waitMs;
  for (;;) {
    const state = await github
      .pullRequestState(pull.number)
      .catch((error: unknown) => {
        options.log(`Reading ${pull.url} failed: ${(error as Error).message}`);
        return undefined;
      });
    options.log(`${pull.url}: ${state ?? "unknown"}`);
    if (state === "MERGED") return true;
    if (state === "CLOSED") return false;
    const left = deadline - now();
    if (left <= 0) return false;
    await delay(Math.min(options.pollMs, left));
  }
}

function conflictWatch(
  sh: Shell,
  log: WriteStream,
  {
    remote,
    to,
    everyMs,
    fetchTimeoutMs,
  }: { remote: string; to: string; everyMs: number; fetchTimeoutMs: number },
): () => Promise<void> {
  let checkedAt = -Infinity;
  let checked: string | undefined;
  return async () => {
    const now = Temporal.Now.instant().epochMilliseconds;
    if (now - checkedAt < everyMs) return;
    checkedAt = now;
    let conflicts: string;
    try {
      const fetched = await sh.run(
        "git",
        ["fetch", "--no-tags", "--refmap=", remote, `refs/heads/${to}`],
        fetchTimeoutMs,
      );
      if (fetched.code !== 0) {
        throw new Error(`git fetch exited ${fetched.code}`);
      }
      const sha = await sh.git("queue", "rev-parse", "FETCH_HEAD");
      if (sha === checked) return;
      checked = sha;
      const merged = await sh.run("git", [
        "merge-tree",
        "--write-tree",
        "--name-only",
        "--no-messages",
        "HEAD",
        sha,
      ]);
      if (merged.code === 0) return;
      if (merged.code !== 1) {
        throw new Error(`git merge-tree exited ${merged.code}`);
      }
      conflicts = merged.stdout.trimEnd().split("\n").slice(1).join("\n");
      const cherry = await sh.git("queue", "cherry", sha, "HEAD");
      if (cherry.split("\n").some((line) => line.startsWith("- "))) {
        log.write(
          `Conflict check deferred: ${remote}/${to} holds copies of branch commits, so the rebase in the Land Turn decides.\n`,
        );
        return;
      }
    } catch (error) {
      log.write(`Conflict check skipped: ${String(error).split("\n", 1)[0]}\n`);
      return;
    }
    throw new LandFailure(
      "rebase",
      `While the land waited for the Land Turn, the branch does not merge with ${remote}/${to} without conflicts in:\n${conflicts}\nThe branch is as it was. Run git fetch ${remote}, merge or rebase onto ${remote}/${to} yourself, resolve the conflicts, and land again.`,
    );
  };
}

async function fetchTarget(
  sh: Shell,
  remote: string,
  to: string,
): Promise<void> {
  await sh.git(
    "fetch",
    "fetch",
    "--no-tags",
    remote,
    `+refs/heads/${to}:refs/remotes/${remote}/${to}`,
  );
}

async function rebaseOnto(
  sh: Shell,
  base: string,
  original: string,
): Promise<void> {
  const rebased = await sh.run("git", ["rebase", "--no-autostash", base]);
  if (rebased.code !== 0) {
    const conflicts = (
      await sh.run("git", ["diff", "--name-only", "--diff-filter=U"])
    ).stdout.trim();
    await sh.run("git", ["rebase", "--abort"]);
    await sh.git("rebase", "reset", "--hard", original);
    throw new LandFailure(
      "rebase",
      conflicts
        ? `The branch does not rebase onto ${base} without conflicts in:\n${conflicts}\nThe branch is as it was. Merge or rebase onto ${base} yourself, resolve the conflicts, and land again.`
        : `Git refused to rebase the branch onto ${base}:\n${(rebased.stderr || rebased.stdout).trim()}\nThe branch is as it was. Clear what Git names, and land again.`,
    );
  }
  if (
    (await sh.git("rebase", "rev-parse", "HEAD")) ===
    (await sh.git("rebase", "rev-parse", base))
  ) {
    throw new LandFailure(
      "rebase",
      `The branch has no commits that ${base} lacks; there is nothing to land.`,
    );
  }
}

const INSTALL_INPUTS = new Set(["pnpm-lock.yaml", "pnpm-workspace.yaml"]);

async function changesInstallInputs(
  sh: Shell,
  before: string,
): Promise<boolean> {
  const changed = await sh.git("rebase", "diff", "--name-only", before, "HEAD");
  return changed
    .split("\n")
    .some(
      (path) =>
        INSTALL_INPUTS.has(path) ||
        path === "package.json" ||
        path.endsWith("/package.json"),
    );
}

async function push(sh: Shell, remote: string, to: string): Promise<boolean> {
  const result = await sh.run("git", [
    "push",
    "--porcelain",
    remote,
    `HEAD:refs/heads/${to}`,
  ]);
  if (result.code === 0) return true;
  const rejected = result.stdout
    .split("\n")
    .some(
      (line) =>
        line.startsWith("!") &&
        /fetch first|non-fast-forward|stale info/.test(line),
    );
  if (rejected) return false;
  throw new LandFailure(
    "push",
    `git push exited ${result.code}: ${(result.stderr || result.stdout).trim()}`,
  );
}

async function updateLocalRef(
  sh: Shell,
  say: (line: string) => void,
  { to, commit }: { to: string; commit: string },
): Promise<void> {
  const ref = `refs/heads/${to}`;
  const list = (await sh.run("git", ["worktree", "list", "--porcelain"]))
    .stdout;
  const checkedOut = list
    .split("\n\n")
    .map((entry) => entry.split("\n"))
    .find((lines) => lines.includes(`branch ${ref}`))?.[0]
    ?.slice("worktree ".length);
  const local = (
    await sh.run("git", ["rev-parse", "-q", "--verify", ref])
  ).stdout.trim();
  if (local && !(await sh.test("merge-base", "--is-ancestor", local, commit))) {
    say(
      `The local ${to} has commits that ${to} on the remote lacks; it stays at ${local.slice(0, 12)}.`,
    );
    return;
  }
  if (!checkedOut) {
    await sh.git("push", "update-ref", ref, commit, ...(local ? [local] : []));
    return;
  }
  const status = await sh.run("git", [
    "-C",
    checkedOut,
    "status",
    "--porcelain",
  ]);
  if (status.code !== 0 || status.stdout.trim()) {
    say(
      `${to} is checked out in ${checkedOut} with changes; that worktree stays as it is.`,
    );
    return;
  }
  const merged = await sh.run("git", [
    "-C",
    checkedOut,
    "merge",
    "--ff-only",
    "-q",
    commit,
  ]);
  if (merged.code !== 0) {
    say(
      `Could not fast-forward ${to} in ${checkedOut}; that worktree stays as it is.`,
    );
  }
}

async function deleteRemoteBranch(
  sh: Shell,
  say: (line: string) => void,
  { remote, branch }: { remote: string; branch: string },
): Promise<void> {
  const listed = await sh.run("git", [
    "ls-remote",
    "--exit-code",
    "--heads",
    remote,
    `refs/heads/${branch}`,
  ]);
  if (listed.code !== 0) return;
  const deleted = await sh.run("git", [
    "push",
    remote,
    "--delete",
    `refs/heads/${branch}`,
  ]);
  if (deleted.code !== 0) {
    say(`Could not delete ${branch} on ${remote}; delete it by hand.`);
  }
}
