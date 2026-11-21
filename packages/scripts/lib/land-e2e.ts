// The End-to-end Run after a land. Each land onto `main` writes a request for
// its new tip and starts a detached runner; the land does not wait for it.
//
//   land ─▶ request.json (the newest tip; each land overwrites it)
//        └▶ runner process ─▶ waits in the End-to-end Queue (one turn)
//                              └▶ at its turn: reads the newest request
//                                   already run? ─▶ exit
//                                   desktop cannot paint? ─▶ record "not-run"
//                                   else check out the tip in its own
//                                   checkout, bootstrap, run `pnpm e2e`
//                                   under a Desktop Slot, record the result
//                                   failed? ─▶ comment on the open issue of
//                                              failures, or open one
//                                   passed after a failure? ─▶ comment so
//
// Runs coalesce: a runner that waited behind another takes the newest tip, so
// a burst of lands costs one run after the current one. The commit range of a
// failure starts at the last tip that passed. A failure reverts nothing.
//
// Failures share one issue: the open issue whose title is E2E_ISSUE_TITLE. A
// failure adds a comment to it, or opens it with the `needs-triage` label when
// none is open. The first pass after a failure adds a comment and leaves the
// issue open; a person closes it.
//
// A run needs a painted desktop window (lib/desktop-paint.ts). When the
// desktop cannot paint, before the run or at the end of a run that failed, the
// tip is recorded as "not-run" with the machine state: nothing was tested, so
// no issue opens, and the next land's run covers the newer tip.
//
// The state lives in `landE2eDir()`:
//
//   queue/          the End-to-end Queue
//   request.json    the newest tip to run
//   state.json      the last tip run, and the last tip that passed
//   runs.jsonl      one line per run: its tip, range, outcome, and log
//   logs/           the full log of each run
//   checkout/       the runner's own worktree, detached at the tip it runs

import type { DesktopPaint } from "#desktop-paint";
import type { Admission } from "#desktop-slot";
import { regex } from "arkregex";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  acquireDesktopSlot,
  describeLeaseEnd,
  DesktopSlotBlockedError,
  SILENCE_LIMIT_MS,
  throttledProgress,
} from "#desktop-slot";
import { landStateDir } from "#land-queue";

const HOUR = 3_600_000;

/** How long a runner waits behind the run before it. */
export const LAND_E2E_WAIT_MS = 3 * HOUR;

/** The tip of `main` to run, as the land that pushed it wrote it. */
export interface LandE2eRequest {
  commit: string;
  /** The tip of `main` before the land. */
  previous: string;
  /** The primary worktree of the repository, where the checkout is made. */
  repository: string;
  /** The GitHub repository that takes the issue, as `owner/name`. */
  issueRepository: string | undefined;
  requestedAt: string;
}

/**
 * How one run ended. `failed` names the stage that failed. `not-run` says
 * why the desktop could not paint a window, so nothing was tested.
 */
export type LandE2eOutcome =
  | { outcome: "passed" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "blocked"; reason: string }
  | { outcome: "not-run"; reason: string }
  | { outcome: "failed"; stage: string };

export interface LandE2eRecord {
  commit: string;
  /** `<last passed>..<commit>`, or the commit alone when none passed yet. */
  range: string;
  startedAt: string;
  finishedAt: string;
  log: string;
  /** The URL of the issue that a failure, or a pass after one, wrote to. */
  issue?: string;
  result: LandE2eOutcome;
}

interface LandE2eState {
  lastRun?: string;
  lastPassed?: string;
  /** The last tip that failed, until a tip passes. */
  lastFailed?: string;
}

/** The title of the one open issue of End-to-end Run failures. */
export const E2E_ISSUE_TITLE = "End-to-end Run fails on main";
const E2E_ISSUE_LABEL = "needs-triage";
const EXCERPT_LINES = 80;

export interface LandE2eIssue {
  number: number;
  title: string;
  url: string;
}

/** The issues of a GitHub repository, given as `owner/name`. */
export interface LandE2eIssues {
  /** The open issues whose title holds `title`; it may return near matches. */
  listOpen: (repository: string, title: string) => Promise<LandE2eIssue[]>;
  /** Open an issue; returns its URL. */
  create: (
    repository: string,
    issue: { title: string; body: string; label: string },
  ) => Promise<string>;
  comment: (repository: string, number: number, body: string) => Promise<void>;
}

export interface LandE2eRun {
  request: LandE2eRequest;
  /** The full log of this run. */
  logPath: string;
  /** The runner's own checkout. */
  checkout: string;
  /** Record a sign of progress, such as output of a command; it renews the turn. */
  progress: (what: string) => void;
  /**
   * Aborts when the Lease of the End-to-end Turn ends; its reason says why.
   * The run then stops its command.
   */
  leaseEnded: AbortSignal;
}

export interface LandE2eDeps {
  /** Check out, bootstrap, and run the End-to-end Run of the request. */
  run: (run: LandE2eRun) => Promise<LandE2eOutcome>;
  /** Whether the desktop can paint a window now (`readDesktopPaint`). */
  paint: () => Promise<DesktopPaint>;
  /** The one-line commits of the range, and the text of the run's log. */
  evidence: (failure: {
    run: LandE2eRun;
    range: string;
  }) => Promise<{ commits: string; log: string }>;
  /** The issues that take failures and the pass after them. */
  issues: LandE2eIssues;
}

const GITHUB_REMOTE = regex(
  "github\\.com[:/](?<repository>[^/]+/[^/]+?)(?:\\.git)?/?$",
);

/** `owner/name` of a GitHub remote URL; undefined for another host. */
export function githubRepository(url: string): string | undefined {
  return GITHUB_REMOTE.exec(url.trim())?.groups.repository;
}

export function landE2eDir(): string {
  return join(landStateDir(), "e2e");
}

function landE2eAdmission(dir: string): Admission {
  return {
    dir: () => join(dir, "queue"),
    slots: () => 1,
    tokenEnv: "ZOTLIT_LAND_E2E_TURN",
    memoryGate: false,
    display: false,
    slotName: "End-to-end Turn",
    queueName: "End-to-end Queue",
  };
}

/** Make `request` the newest tip to run; a waiting runner takes it. */
export async function requestLandE2e(
  request: LandE2eRequest,
  dir: string = landE2eDir(),
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(join(dir, "request.json"), request);
}

/**
 * Wait for the End-to-end Turn, then run the newest requested tip unless it
 * has run already.
 * @returns the record of the run, or undefined when there was nothing to run.
 */
export async function runLandE2e(
  deps: LandE2eDeps,
  options: {
    dir?: string;
    waitMs?: number;
    pollMs?: number;
    log?: (line: string) => void;
  } = {},
): Promise<LandE2eRecord | undefined> {
  const dir = options.dir ?? landE2eDir();
  const log = options.log ?? ((line: string) => console.error(line));
  let slot;
  const lease = new AbortController();
  try {
    slot = await acquireDesktopSlot({
      admission: landE2eAdmission(dir),
      cwd: dir,
      command: "End-to-end Run after a land",
      worktree: dir,
      silenceMs: SILENCE_LIMIT_MS.childOutput,
      waitMs: options.waitMs ?? LAND_E2E_WAIT_MS,
      ...(options.pollMs ? { pollMs: options.pollMs } : {}),
      log,
      // The run stops its command and records the failure. A runner still
      // here past the grace is hung, and the next runner evicts it as a
      // Desktop Queue waiter evicts an overdue holder.
      onLeaseEnd: (owner) => {
        const reason = describeLeaseEnd(
          owner,
          Temporal.Now.instant().epochMilliseconds,
        );
        log(`End-to-end Turn: the Lease ended: ${reason}.`);
        lease.abort(reason);
      },
    });
  } catch (error) {
    if (!(error instanceof DesktopSlotBlockedError)) throw error;
    log(error.message);
    return undefined;
  }
  try {
    const request = await readJson<LandE2eRequest>(join(dir, "request.json"));
    const state = (await readJson<LandE2eState>(join(dir, "state.json"))) ?? {};
    if (!request || request.commit === state.lastRun) return undefined;

    const startedAt = Temporal.Now.instant().toString();
    const logPath = join(
      dir,
      "logs",
      `${startedAt.replaceAll(":", "-")}-${request.commit.slice(0, 12)}.log`,
    );
    await mkdir(join(dir, "logs"), { recursive: true });
    const turn = slot;
    const run: LandE2eRun = {
      request,
      logPath,
      checkout: join(dir, "checkout"),
      progress: throttledProgress((what) => turn.progress(what)),
      leaseEnded: lease.signal,
    };
    const base = state.lastPassed ?? request.previous;
    const range = base ? `${base}..${request.commit}` : request.commit;
    log(`End-to-end Run of ${request.commit.slice(0, 12)}: log ${logPath}`);
    const result = await runUnlessDesktopIsDark(deps, run);
    const issue = await reportToIssue(deps, {
      run,
      range,
      result,
      lastFailed: state.lastFailed,
    }).catch((error: unknown) => {
      log(`End-to-end Run: the issue was not written: ${String(error)}`);
      return undefined;
    });
    const record: LandE2eRecord = {
      commit: request.commit,
      range,
      startedAt,
      finishedAt: Temporal.Now.instant().toString(),
      log: logPath,
      ...(issue ? { issue } : {}),
      result,
    };
    await appendFile(join(dir, "runs.jsonl"), `${JSON.stringify(record)}\n`);
    // A blocked run and a run that did not run leave the tip to the next
    // runner.
    if (result.outcome !== "blocked" && result.outcome !== "not-run") {
      await writeJsonAtomic(join(dir, "state.json"), {
        lastRun: request.commit,
        lastPassed:
          result.outcome === "passed" ? request.commit : state.lastPassed,
        lastFailed:
          result.outcome === "failed"
            ? request.commit
            : result.outcome === "passed"
              ? undefined
              : state.lastFailed,
      } satisfies LandE2eState);
    }
    log(
      `End-to-end Run of ${request.commit.slice(0, 12)}: ${result.outcome}${result.outcome === "not-run" ? `: ${result.reason}` : ""}.`,
    );
    return record;
  } finally {
    slot.release();
  }
}

/**
 * Run the request unless the desktop cannot paint. A run that failed or was
 * blocked while the desktop cannot paint at its end did not test the code:
 * it is recorded as not run, and its log keeps the test output.
 */
async function runUnlessDesktopIsDark(
  deps: LandE2eDeps,
  run: LandE2eRun,
): Promise<LandE2eOutcome> {
  const before = await deps.paint();
  if (before.state === "cannot paint") {
    return {
      outcome: "not-run",
      reason: `the desktop cannot paint a window: ${before.machine}`,
    };
  }
  const result = await deps
    .run(run)
    .catch((error: unknown): LandE2eOutcome => ({
      outcome: "failed",
      stage: `runner: ${(error as Error).message}`,
    }));
  if (result.outcome !== "failed" && result.outcome !== "blocked") {
    return result;
  }
  const after = await deps.paint();
  return after.state === "cannot paint"
    ? {
        outcome: "not-run",
        reason: `the desktop stopped painting during the run: ${after.machine}`,
      }
    : result;
}

/**
 * Write a failure, or the first pass after one, to the open issue of
 * End-to-end Run failures. A failure opens that issue when none is open.
 * @returns the URL of the issue written to.
 */
async function reportToIssue(
  { evidence, issues }: LandE2eDeps,
  {
    run,
    range,
    result,
    lastFailed,
  }: {
    run: LandE2eRun;
    range: string;
    result: LandE2eOutcome;
    lastFailed: string | undefined;
  },
): Promise<string | undefined> {
  const { request, logPath } = run;
  const repository = request.issueRepository;
  if (!repository) return undefined;
  if (
    result.outcome !== "failed" &&
    !(result.outcome === "passed" && lastFailed)
  )
    return undefined;
  // The newest open issue whose title is the title exactly.
  const open = (await issues.listOpen(repository, E2E_ISSUE_TITLE))
    .filter(({ title }) => title === E2E_ISSUE_TITLE)
    .toSorted((a, b) => b.number - a.number)[0];
  if (result.outcome !== "failed") {
    if (!open) return undefined;
    await issues.comment(
      repository,
      open.number,
      `The End-to-end Run after a land passed on \`main\` at ${request.commit}, after the failure at ${lastFailed}. Commit range: \`${range}\`. This issue stays open until a person closes it.`,
    );
    return open.url;
  }
  const { commits, log } = await evidence({ run, range });
  const lines = log.trimEnd().split("\n");
  const cases = failedCases(lines);
  const body = [
    `The End-to-end Run after a land failed at the ${result.stage} stage, on \`main\` at ${request.commit}.`,
    "",
    `Commit range: \`${range}\` (from the last tip that passed).`,
    "",
    "```text",
    commits.trim() || request.commit,
    "```",
    "",
    cases.length > 0
      ? `Failed cases:\n\n${cases.map((name) => `- \`${name}\``).join("\n")}`
      : `The log names no failed case; the run failed at the ${result.stage} stage.`,
    "",
    `The full log is on the machine that ran it: \`${logPath}\`. The last ${EXCERPT_LINES} lines:`,
    "",
    "```text",
    lines.slice(-EXCERPT_LINES).join("\n"),
    "```",
  ].join("\n");
  if (open) {
    await issues.comment(repository, open.number, body);
    return open.url;
  }
  return issues.create(repository, {
    title: E2E_ISSUE_TITLE,
    body,
    label: E2E_ISSUE_LABEL,
  });
}

// Vitest names a failed case as ` FAIL  |project| file > suite > case`.
const FAILED_CASE = regex(" FAIL +(?<name>\\S.*)$");

/** The failed cases that a Vitest log names, each once, in log order. */
function failedCases(lines: readonly string[]): string[] {
  return [
    ...new Set(
      lines.flatMap((line) => {
        const name = FAILED_CASE.exec(line)?.groups.name.trim();
        return name ? [name] : [];
      }),
    ),
  ];
}

/** The last `limit` records of `runs.jsonl`, oldest first. */
export async function readLandE2eRecords(
  limit: number,
  dir: string = landE2eDir(),
): Promise<LandE2eRecord[]> {
  const text = await readFile(join(dir, "runs.jsonl"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => JSON.parse(line) as LandE2eRecord);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const draft = `${path}.${randomUUID()}.draft`;
  await writeFile(draft, JSON.stringify(value));
  await rename(draft, path);
}
