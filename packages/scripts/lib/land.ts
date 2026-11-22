// One land: the only path by which a change reaches `main`, the trunk
// (ADR 0097), with a record PR on GitHub (ADR 0102).
//
//   land (from a task branch, clean tree, a record file, a GitHub login)
//     preflight ─▶ wait in the Land Queue ─▶ the Land Turn:
//       fetch origin/main ─▶ rebase the branch onto it ─▶ gate
//         ─▶ record: push the branch, open or update its record PR
//         ─▶ ci: wait for the LAND_CI_CHECK check of the PR head
//         ─▶ push HEAD:main
//         ▲          │ main moved
//         └──────────┘
//       update the local main ─▶ read the PR state ─▶ merged: delete the
//       task branch on the remote
//     after the turn: request the End-to-end Run of the new tip (lib/land-e2e.ts)
//
// A change lands with `pnpm verify --local` as its gate and a record PR on
// GitHub, whose body is the record file that the agent wrote
// (LAND_RECORD_PATH). The PR runs `pnpm verify --pr` in CI
// (.github/workflows/record-pr.yml), and `main` moves only when that check
// passes. scripts/verify.ts names the steps of each flag.
// GitHub shows the PR as merged when `main` moves to its head. The version
// commit of a release (`pnpm release`) lands with the release gate and no
// record PR.
//
// The gate runs once, in the turn, on the tree that is pushed. On a failure
// the worktree stays on its branch with a clean tree: a rebase conflict
// restores the branch as it was, and a gate or push failure leaves it rebased
// onto the fetched `main`, which is the tree to fix.

import type { DesktopSlot } from "#desktop-slot";
import type { LandCiRun } from "#land-queue";
import { regex } from "arkregex";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { SOURCE_BRANCH } from "@zotlit/config/repositories";

import {
  acquireDesktopSlot,
  describeLeaseEnd,
  DesktopSlotBlockedError,
  EXIT_ADMISSION_BLOCKED,
  formatDuration,
  SILENCE_LIMIT_MS,
  throttledProgress,
} from "#desktop-slot";
import {
  landAdmission,
  landStateDir,
  landWaitLog,
  recordLandWait,
} from "#land-queue";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long a land waits for its turn by default. */
export const LAND_WAIT_MS = HOUR;
/** How many times one turn fetches and gates again after `main` moved. */
export const LAND_ATTEMPTS = 3;

/** The branch every land pushes to. */
const TRUNK = SOURCE_BRANCH;

/**
 * The quality gate of a change, and of the version commit of a release. The
 * record PR of a change runs the rest of `pnpm verify` (LAND_CI_CHECK).
 */
export const LAND_GATES = {
  change: ["pnpm", "verify", "--local"],
  release: ["pnpm", "verify", "--release"],
} as const satisfies Record<string, readonly [string, ...string[]]>;

/** The steps of a land, as a failure names them. */
export type LandStep =
  | "preflight"
  | "queue"
  | "fetch"
  | "rebase"
  | "gate"
  | "record"
  | "ci"
  | "push"
  | "lease";

/** The record file of a land, relative to the root of the worktree. */
export const LAND_RECORD_PATH = ".scratch/land-record.md";

/** The sections of a record, each a `## <name>` heading. */
export const LAND_RECORD_SECTIONS = [
  "Summary",
  "Testing",
  "Risk",
  "How to revert",
  "Review",
  "Open points",
  "e2e",
] as const;

/**
 * The name of the CI job that a record PR runs, the job `name` in
 * .github/workflows/record-pr.yml. GitHub shows it as a check on the PR head.
 */
export const LAND_CI_CHECK = "Record PR tests";
/**
 * How long a land waits for the check of its PR head by default. It is the
 * `timeout-minutes: 40` of the job in record-pr.yml plus 5 min for the wait
 * for a runner and for GitHub to show the check, so a job that hangs ends
 * on GitHub's side first, and the land reports its failure with the link.
 * Change the two together. While one land waits, the other lands wait in the
 * Land Queue: a land that waits behind it can reach its own 1 h wait
 * (LAND_WAIT_MS) and exit 75.
 */
export const LAND_CI_WAIT_MS = 45 * MINUTE;
/**
 * How often the land reads the check by default: two GitHub API reads a
 * minute, well inside the rate limit, and each read renews the Lease of the
 * Land Turn long before its silence limit (SILENCE_LIMIT_MS.childOutput).
 */
const LAND_CI_POLL_MS = 30_000;

/** A run of a CI job, as GitHub shows it as a check of a commit. */
export interface CiCheck {
  /** The check run, which is also the id of the Actions job. */
  id: number;
  status:
    | "queued"
    | "in_progress"
    | "completed"
    | "waiting"
    | "requested"
    | "pending";
  /** `success` once the job passed; set when the status is `completed`. */
  conclusion: string | null;
  /** The page of the job and its log. */
  url: string;
  /** When the job joined the queue for a runner. */
  queuedAt?: string;
  /** When a runner took the job. */
  startedAt?: string;
  completedAt?: string;
}

export interface RecordPullRequest {
  number: number;
  url: string;
}

/** The GitHub side of a land: the record PR of its branch. */
export interface LandGitHub {
  /** The open PR from `head` into `base`, if there is one. */
  findOpenPullRequest: (query: {
    head: string;
    base: string;
  }) => Promise<RecordPullRequest | undefined>;
  createPullRequest: (pull: {
    head: string;
    base: string;
    title: string;
    body: string;
  }) => Promise<RecordPullRequest>;
  editPullRequest: (
    number: number,
    pull: { title: string; body: string },
  ) => Promise<void>;
  pullRequestState: (number: number) => Promise<"OPEN" | "CLOSED" | "MERGED">;
  /** The newest check named `name` of `commit`, if GitHub shows one. */
  readCheck: (query: {
    commit: string;
    name: string;
  }) => Promise<CiCheck | undefined>;
}

export interface LandOptions {
  /** The worktree to land from. */
  cwd: string;
  /** The quality gate, run in `cwd` on the tree that is pushed. */
  gate: readonly [string, ...string[]];
  /**
   * The GitHub client of the record PR. With it, the land needs the record
   * file at LAND_RECORD_PATH; without it, the land opens no PR.
   */
  github?: LandGitHub;
  /** @default "origin" */
  remote?: string;
  /** @default the Land Queue */
  queueDir?: string;
  /** @default `logs/` in landStateDir() */
  logDir?: string;
  /** @default landWaitLog() */
  waitLog?: string;
  /** The Admission Deadline. @default LAND_WAIT_MS */
  waitMs?: number;
  /**
   * How long the commands of the turn may print nothing before the Lease of
   * the turn ends. @default SILENCE_LIMIT_MS.childOutput
   */
  silenceMs?: number;
  /** How often the land reads the Land Queue. */
  pollMs?: number;
  /** @default LAND_ATTEMPTS */
  attempts?: number;
  /** How long the land waits for the CI check. @default LAND_CI_WAIT_MS */
  ciWaitMs?: number;
  /** How often the land reads the CI check. @default 30 s */
  ciPollMs?: number;
  /** Progress lines for the caller; the full output goes to the log. */
  say?: (line: string) => void;
}

export type LandResult =
  | {
      ok: true;
      /** The tip that was pushed. */
      commit: string;
      /** The tip of the trunk before the push. */
      previous: string;
      attempts: number;
      waitMs: number;
      logPath: string;
      /** The record PR, and whether GitHub showed it as merged. */
      record?: RecordPullRequest & { merged: boolean };
    }
  | {
      ok: false;
      step: LandStep;
      message: string;
      logPath: string;
      /** EXIT_ADMISSION_BLOCKED when the turn never came, else 1. */
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

/**
 * Runs commands in the worktree, with their output in the land log. Each
 * command leads its own process group, so the end of a Lease or a signal stops
 * the whole command, such as the gate and every Vitest worker under it. Each
 * output of a command is a sign of progress of the Land Turn.
 */
class Shell {
  #current: ChildProcess | undefined;
  readonly #cwd: string;
  readonly #log: WriteStream;
  /** Set once the Land Turn is taken. */
  progress: ((what: string) => void) | undefined;

  constructor(cwd: string, log: WriteStream) {
    this.#cwd = cwd;
    this.#log = log;
  }

  run(command: string, args: readonly string[]): Promise<RunResult> {
    this.#log.write(`\n$ ${[command, ...args].join(" ")}\n`);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.#cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      this.#current = child;
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
        if (this.#current === child) this.#current = undefined;
        if (signal) this.#log.write(`(ended by ${signal})\n`);
        resolve({ code: code ?? 128, stdout, stderr });
      });
    });
  }

  /** Stdout, trimmed; throws a LandFailure of `step` on a non-zero exit. */
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

  /** Whether `git ...args` exits 0. */
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

/** Land the worktree at `options.cwd` onto the trunk. */
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
  /** Why the Lease of the turn ended, once it has. */
  let leaseOver: string | undefined;
  let source = "";
  let attempts = 0;
  let current: LandStep = "preflight";
  /** Each CI check that the land waited for to its end. */
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
    const pre = await preflight(sh, remote);
    // A refused record, like the other preflight checks, writes no wait line.
    const record = options.github ? await readRecord(sh) : undefined;
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
    // A write at most every 5 s, and at least ten in each silence limit.
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
        // The end of the Lease stopped the command, which then failed.
        if (leaseOver) throw leaseEnded(leaseOver);
        throw error;
      }
      if (leaseOver) throw leaseEnded(leaseOver);
      return value;
    };
    const maxAttempts = options.attempts ?? LAND_ATTEMPTS;
    let previous = "";
    let pull: RecordPullRequest | undefined;
    for (;;) {
      attempts += 1;
      previous = await step("fetch", () => fetchTarget(sh, remote, to));
      await step("rebase", () => rebaseOnto(sh, `${remote}/${to}`, pre.head));
      await step("gate", async () => {
        const [command, ...args] = options.gate;
        const result = await sh.run(command, args);
        if (result.code !== 0) {
          throw new LandFailure(
            "gate",
            `${options.gate.join(" ")} exited ${result.code}.`,
          );
        }
      });
      const github = options.github;
      if (github && record) {
        pull = await step("record", () =>
          openRecord(sh, github, {
            remote,
            branch: pre.branch,
            base: to,
            record,
            say,
          }),
        );
        const head = await sh.git("ci", "rev-parse", "HEAD");
        await step("ci", () =>
          waitForCi(github, {
            commit: head,
            waitMs: options.ciWaitMs ?? LAND_CI_WAIT_MS,
            pollMs: options.ciPollMs ?? LAND_CI_POLL_MS,
            say,
            progress: (what) => turn.progress(what),
            leaseOver: () => leaseOver,
            runs: ciRuns,
          }),
        );
      }
      const pushed = await step("push", () => push(sh, remote, to));
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
    // Main has moved: from here, a GitHub error is a report, not a failure.
    const merged =
      pull && options.github
        ? await readMerged(options.github, pull, (line) =>
            log.write(`${line}\n`),
          )
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
      commit,
      previous,
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
    outcome: "landed" | "failed" | "blocked",
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

/** The checks that need no turn: a clean tree on a task branch. */
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
  await sh.git("preflight", "remote", "get-url", remote);
  return { head: await sh.git("preflight", "rev-parse", "HEAD"), branch };
}

interface LandRecord {
  title: string;
  body: string;
}

const RECORD_TITLE = regex("^# (?<title>.+)$");
const RECORD_SECTION = regex("^## (?<name>.+)$");

/**
 * The record file of the worktree. Its first line, `# <title>`, is the title
 * of the PR; the rest is the PR body, with a heading for each of
 * LAND_RECORD_SECTIONS.
 */
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

/**
 * A read through the GitHub client, before the turn: a land with a login that
 * GitHub refuses fails before the gate, not after it.
 */
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

/**
 * Push HEAD to the task branch on the remote, then open its record PR, or
 * update the PR that an earlier land of the branch opened.
 */
async function openRecord(
  sh: Shell,
  github: LandGitHub,
  options: {
    remote: string;
    branch: string;
    base: string;
    record: LandRecord;
    say: (line: string) => void;
  },
): Promise<RecordPullRequest> {
  const { remote, branch, base, record, say } = options;
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
      await github.editPullRequest(open.number, record);
      say(`Record PR updated: ${open.url}`);
      return open;
    }
    const created = await github.createPullRequest({
      head: branch,
      base,
      ...record,
    });
    say(`Record PR opened: ${created.url}`);
    return created;
  } catch (error) {
    throw new LandFailure(
      "record",
      `The record PR of ${branch} could not be opened or updated: ${(error as Error).message}`,
    );
  }
}

/**
 * Wait for the LAND_CI_CHECK check of `commit` to finish, and fail unless it
 * passed. Each read prints the state of the check and renews the Lease of the
 * Land Turn. A land again on a head whose check failed reads that failure,
 * unless someone ran the job again from its link.
 */
async function waitForCi(
  github: LandGitHub,
  options: {
    commit: string;
    waitMs: number;
    pollMs: number;
    say: (line: string) => void;
    progress: (what: string) => void;
    leaseOver: () => string | undefined;
    runs: LandCiRun[];
  },
): Promise<void> {
  const { commit, say } = options;
  const name = LAND_CI_CHECK;
  const short = commit.slice(0, 12);
  const started = Temporal.Now.instant().epochMilliseconds;
  for (;;) {
    const reason = options.leaseOver();
    if (reason) throw leaseEnded(reason);
    let check: CiCheck | undefined;
    try {
      check = await github.readCheck({ commit, name });
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
        `The CI job "${name}" ended ${check.conclusion} on ${short}. Its log: ${check.url}\n${TRUNK} is unchanged. Fix the failure on this branch, commit, and land again; when the failure is not in the change, run the job again from its log page, then land again.`,
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
          : `GitHub shows no "${name}" check for ${short} within ${formatDuration(options.waitMs)}. ${TRUNK} is unchanged. Check that the workflow of the record PR runs (.github/workflows/record-pr.yml), then land again.`,
      );
    }
    await delay(options.pollMs);
  }
}

/** The wait-log entry of a finished check. */
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

/** How long the job waited for a runner, when GitHub shows it. */
function queueNote(check: CiCheck): string {
  const ms = between(check.queuedAt, check.startedAt);
  return ms === undefined ? "" : `; the job waited ${seconds(ms)} for a runner`;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

/**
 * Whether GitHub shows `pull` as merged, read once after the push of `main`.
 * A read that fails counts as not merged.
 */
async function readMerged(
  github: LandGitHub,
  pull: RecordPullRequest,
  log: (line: string) => void,
): Promise<boolean> {
  const state = await github
    .pullRequestState(pull.number)
    .catch((error: unknown) => {
      log(`Reading ${pull.url} failed: ${(error as Error).message}`);
      return undefined;
    });
  log(`${pull.url}: ${state ?? "unknown"}`);
  return state === "MERGED";
}

/** Fetch the trunk; returns its tip. */
async function fetchTarget(
  sh: Shell,
  remote: string,
  to: string,
): Promise<string> {
  await sh.git(
    "fetch",
    "fetch",
    "--no-tags",
    remote,
    `+refs/heads/${to}:refs/remotes/${remote}/${to}`,
  );
  return await sh.git("fetch", "rev-parse", `${remote}/${to}`);
}

/**
 * Rebase HEAD onto `base`. On a conflict, abort and put the branch back at
 * `original`, so the worktree is as the caller left it.
 */
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
    // With no conflicted file, Git refused before it replayed a commit, for
    // example over an untracked file that the new base would overwrite.
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

/**
 * Push HEAD to the trunk as a fast-forward.
 * @returns false when the trunk moved since the fetch.
 */
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

/**
 * Move the local branch `to` to `commit`. Where a worktree has it checked out,
 * fast-forward that worktree when its tree is clean; otherwise leave it and
 * say so, since the land itself is done.
 */
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
