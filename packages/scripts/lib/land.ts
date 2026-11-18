// One land: the only path by which a change reaches `next`, and by which
// `main` takes a stable graduation from `next`.
//
//   land into next (from a task branch, clean tree)
//     preflight ─▶ wait in the Land Queue of next ─▶ the Land Turn:
//       fetch origin/next ─▶ rebase the branch onto it ─▶ gate ─▶ push HEAD:next
//         ▲                                                       │ next moved
//         └───────────────────────────────────────────────────────┘
//       update the local next ─▶ delete the task branch on the remote
//     after the turn: request the End-to-end Run of the new tip (lib/land-e2e.ts)
//
//   land into main (from a commit of next, clean tree)
//     preflight ─▶ wait in the Land Queue of main ─▶ the Land Turn:
//       fetch ─▶ check HEAD is in next and main is behind it ─▶ release gate
//       ─▶ push HEAD:main as a fast-forward ─▶ update the local main
//
// The gate runs once, in the turn, on the tree that is pushed. On a failure
// the worktree stays on its branch with a clean tree: a rebase conflict
// restores the branch as it was, and a gate or push failure leaves it rebased
// onto the fetched `next`, which is the tree to fix.

import type { DesktopSlot } from "#desktop-slot";
import type { LandTarget } from "#land-queue";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  acquireDesktopSlot,
  describeLeaseEnd,
  DesktopSlotBlockedError,
  EXIT_ADMISSION_BLOCKED,
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
/** How many times one turn fetches and gates again after `next` moved. */
export const LAND_ATTEMPTS = 3;

/** The steps of a land, as a failure names them. */
export type LandStep =
  | "preflight"
  | "queue"
  | "fetch"
  | "rebase"
  | "check"
  | "gate"
  | "push"
  | "lease";

export interface LandOptions {
  /** The worktree to land from. */
  cwd: string;
  to: LandTarget;
  /** The quality gate, run in `cwd` on the tree that is pushed. */
  gate: readonly [string, ...string[]];
  /** @default "origin" */
  remote?: string;
  /** @default the Land Queue of `to` */
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
  pollMs?: number;
  /** @default LAND_ATTEMPTS */
  attempts?: number;
  /** Progress lines for the caller; the full output goes to the log. */
  say?: (line: string) => void;
}

export type LandResult =
  | {
      ok: true;
      /** The tip that was pushed. */
      commit: string;
      /** The tip of the target before the push. */
      previous: string;
      attempts: number;
      waitMs: number;
      logPath: string;
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

/** Land the worktree at `options.cwd` into `options.to`. */
export async function land(options: LandOptions): Promise<LandResult> {
  const { cwd, to } = options;
  const remote = options.remote ?? "origin";
  const silenceMs = options.silenceMs ?? SILENCE_LIMIT_MS.childOutput;
  const say = options.say ?? ((line: string) => console.error(line));
  const logDir = options.logDir ?? join(landStateDir(), "logs");
  await mkdir(logDir, { recursive: true });
  const stamp = Temporal.Now.instant().toString().replaceAll(":", "-");
  const logPath = join(logDir, `${stamp}-${to}-${process.pid}.log`);
  const log = createWriteStream(logPath, { flags: "a" });
  const sh = new Shell(cwd, log);
  say(`Land log: ${logPath}`);

  let slot: DesktopSlot | undefined;
  /** Why the Lease of the turn ended, once it has. */
  let leaseOver: string | undefined;
  let source = "";
  let attempts = 0;
  let current: LandStep = "preflight";
  let enqueuedAt = Temporal.Now.instant();
  const onSignal = (signal: NodeJS.Signals) => {
    sh.stop("SIGTERM");
    slot?.release();
    process.exit(
      128 + (signal === "SIGINT" ? 2 : signal === "SIGHUP" ? 1 : 15),
    );
  };

  try {
    const pre = await preflight(sh, to, remote);
    source = pre.branch ?? pre.head.slice(0, 12);
    say(`Land ${source} into ${to}: waiting for the Land Turn.`);
    for (const signal of SIGNALS) process.on(signal, onSignal);
    current = "queue";
    enqueuedAt = Temporal.Now.instant();
    try {
      slot = await acquireDesktopSlot({
        admission: landAdmission(to),
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
    const maxAttempts = to === "next" ? (options.attempts ?? LAND_ATTEMPTS) : 1;
    let previous = "";
    for (;;) {
      attempts += 1;
      previous = await step("fetch", () => fetchTarget(sh, remote, to));
      if (to === "next") {
        await step("rebase", () => rebaseOnto(sh, `${remote}/next`, pre.head));
      } else {
        await step("check", () => checkGraduation(sh, remote));
      }
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
    if (to === "next" && pre.branch) {
      await deleteRemoteBranch(sh, say, { remote, branch: pre.branch });
    }
    await finish("landed");
    say(`Landed ${source} into ${to} at ${commit.slice(0, 12)}.`);
    return { ok: true, commit, previous, attempts, waitMs, logPath };
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
        target: to,
        source,
        worktree: slot?.owner.worktree ?? cwd,
        enqueuedAt: enqueuedAt.toString(),
        ...(admittedAt ? { admittedAt: admittedAt.toString() } : {}),
        waitMs: sinceEnqueue(admittedAt ?? Temporal.Now.instant()),
        outcome,
        ...(failedStep ? { step: failedStep } : {}),
        ...(attempts ? { attempts } : {}),
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

/** The checks that need no turn: a clean tree on a branch that may land. */
async function preflight(
  sh: Shell,
  to: LandTarget,
  remote: string,
): Promise<{ head: string; branch: string | undefined }> {
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
  if (to === "next") {
    if (!branch) {
      throw new LandFailure(
        "preflight",
        "HEAD is detached. Land from the task branch.",
      );
    }
    if (branch === "next" || branch === "main") {
      throw new LandFailure(
        "preflight",
        `Land from a task branch, not from ${branch}.`,
      );
    }
  }
  await sh.git("preflight", "remote", "get-url", remote);
  return { head: await sh.git("preflight", "rev-parse", "HEAD"), branch };
}

/** Fetch the target (and `next`, for a graduation); returns the target's tip. */
async function fetchTarget(
  sh: Shell,
  remote: string,
  to: LandTarget,
): Promise<string> {
  const refs = [...new Set(["next", to])].map(
    (branch) => `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
  );
  await sh.git("fetch", "fetch", "--no-tags", remote, ...refs);
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

/** HEAD is a commit of `next`, and `main` is behind it. */
async function checkGraduation(sh: Shell, remote: string): Promise<void> {
  if (
    !(await sh.test("merge-base", "--is-ancestor", "HEAD", `${remote}/next`))
  ) {
    throw new LandFailure(
      "check",
      `HEAD is not a commit of ${remote}/next. Check out the commit of next to graduate, such as with git switch --detach ${remote}/next.`,
    );
  }
  if (
    !(await sh.test("merge-base", "--is-ancestor", `${remote}/main`, "HEAD"))
  ) {
    throw new LandFailure(
      "check",
      `${remote}/main has commits that HEAD lacks, so main cannot fast-forward to it. Bring those commits into next first.`,
    );
  }
  if (
    (await sh.git("check", "rev-parse", "HEAD")) ===
    (await sh.git("check", "rev-parse", `${remote}/main`))
  ) {
    throw new LandFailure("check", "main is at HEAD already.");
  }
}

/**
 * Push HEAD to the target as a fast-forward.
 * @returns false when the target moved since the fetch.
 */
async function push(
  sh: Shell,
  remote: string,
  to: LandTarget,
): Promise<boolean> {
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
  { to, commit }: { to: LandTarget; commit: string },
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
