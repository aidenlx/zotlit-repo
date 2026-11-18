// The End-to-end Run after a land. Each land into `next` writes a request for
// its new tip and starts a detached runner; the land does not wait for it.
//
//   land ─▶ request.json (the newest tip; each land overwrites it)
//        └▶ runner process ─▶ waits in the End-to-end Queue (one turn)
//                              └▶ at its turn: reads the newest request
//                                   already run? ─▶ exit
//                                   else check out the tip in its own
//                                   checkout, bootstrap, run `pnpm e2e`
//                                   under a Desktop Slot, record the result
//                                   failed? ─▶ open one issue for the range
//
// Runs coalesce: a runner that waited behind another takes the newest tip, so
// a burst of lands costs one run after the current one. The commit range of a
// failure starts at the last tip that passed. A failure opens an issue and
// reverts nothing.
//
// The state lives in `landE2eDir()`:
//
//   queue/          the End-to-end Queue
//   request.json    the newest tip to run
//   state.json      the last tip run, and the last tip that passed
//   runs.jsonl      one line per run: its tip, range, outcome, and log
//   logs/           the full log of each run
//   checkout/       the runner's own worktree, detached at the tip it runs

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
  DesktopSlotBlockedError,
  MAX_LEASE_MS,
} from "#desktop-slot";
import { landStateDir } from "#land-queue";

const HOUR = 3_600_000;

/** How long a runner waits behind the run before it. */
export const LAND_E2E_WAIT_MS = 3 * HOUR;

/** The tip of `next` to run, as the land that pushed it wrote it. */
export interface LandE2eRequest {
  commit: string;
  /** The tip of `next` before the land. */
  previous: string;
  /** The primary worktree of the repository, where the checkout is made. */
  repository: string;
  /** The GitHub repository that takes the issue, as `owner/name`. */
  issueRepository: string | undefined;
  requestedAt: string;
}

/** How one run ended. `failed` names the stage that failed. */
export type LandE2eOutcome =
  | { outcome: "passed" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "blocked"; reason: string }
  | { outcome: "failed"; stage: string };

export interface LandE2eRecord {
  commit: string;
  /** `<last passed>..<commit>`, or the commit alone when none passed yet. */
  range: string;
  startedAt: string;
  finishedAt: string;
  log: string;
  /** The URL of the issue a failure opened. */
  issue?: string;
  result: LandE2eOutcome;
}

interface LandE2eState {
  lastRun?: string;
  lastPassed?: string;
}

export interface LandE2eRun {
  request: LandE2eRequest;
  /** The full log of this run. */
  logPath: string;
  /** The runner's own checkout. */
  checkout: string;
}

export interface LandE2eDeps {
  /** Check out, bootstrap, and run the End-to-end Run of the request. */
  run: (run: LandE2eRun) => Promise<LandE2eOutcome>;
  /** Open the issue for a failed run; returns its URL. */
  report: (failure: {
    run: LandE2eRun;
    range: string;
    stage: string;
  }) => Promise<string | undefined>;
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
  try {
    slot = await acquireDesktopSlot({
      admission: landE2eAdmission(dir),
      cwd: dir,
      command: "End-to-end Run after a land",
      worktree: dir,
      leaseMs: MAX_LEASE_MS,
      waitMs: options.waitMs ?? LAND_E2E_WAIT_MS,
      ...(options.pollMs ? { pollMs: options.pollMs } : {}),
      log,
      // The End-to-end Run inside keeps its own Desktop Slot Lease. A runner
      // still here past this Lease is hung, and the next runner evicts it as
      // a Desktop Queue waiter evicts an overdue holder.
      onLeaseEnd: () => {},
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
    const run: LandE2eRun = {
      request,
      logPath,
      checkout: join(dir, "checkout"),
    };
    const base = state.lastPassed ?? request.previous;
    const range = base ? `${base}..${request.commit}` : request.commit;
    log(`End-to-end Run of ${request.commit.slice(0, 12)}: log ${logPath}`);
    const result = await deps
      .run(run)
      .catch((error: unknown): LandE2eOutcome => ({
        outcome: "failed",
        stage: `runner: ${(error as Error).message}`,
      }));
    const issue =
      result.outcome === "failed"
        ? await deps.report({ run, range, stage: result.stage })
        : undefined;
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
    // A blocked run leaves the tip to the next runner.
    if (result.outcome !== "blocked") {
      await writeJsonAtomic(join(dir, "state.json"), {
        lastRun: request.commit,
        lastPassed:
          result.outcome === "passed" ? request.commit : state.lastPassed,
      } satisfies LandE2eState);
    }
    log(`End-to-end Run of ${request.commit.slice(0, 12)}: ${result.outcome}.`);
    return record;
  } finally {
    slot.release();
  }
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
