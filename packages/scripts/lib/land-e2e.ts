import type { Admission } from "#desktop-slot";
import type { E2eCase, E2eIssues } from "#e2e-report";
import { regex } from "arkregex";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";

import {
  acquireDesktopSlot,
  describeLeaseEnd,
  DesktopSlotBlockedError,
  SILENCE_LIMIT_MS,
  throttledProgress,
} from "#desktop-slot";
import {
  readFailedE2eCases,
  reportE2eFailure,
  reportE2ePass,
} from "#e2e-report";
import { landStateDir } from "#land-queue";

const HOUR = 3_600_000;

export const readLandE2eEvidence: LandE2eDeps["evidence"] = async ({
  run,
  range,
}) => {
  const { logPath, checkout, resultsDir } = run;
  const log = stripVTControlCharacters(await readFile(logPath, "utf8"));
  const args = ["log", "--oneline", "--no-decorate", "-n", "50", range];
  const { stdout: commits, stderr } = await promisify(execFile)("git", args, {
    cwd: checkout,
  }).catch((error: { stdout?: string; stderr?: string }) => ({
    stdout: error.stdout ?? "",
    stderr: error.stderr ?? "",
  }));
  await appendFile(logPath, `\n$ git ${args.join(" ")}\n${commits}${stderr}`);
  return { commits, log, cases: await readFailedE2eCases(resultsDir) };
};

export const LAND_E2E_WAIT_MS = 3 * HOUR;

export interface LandE2eRequest {
  commit: string;
  previous: string;
  repository: string;
  issueRepository: string | undefined;
  requestedAt: string;
}

export type LandE2eOutcome =
  | { outcome: "passed" }
  | { outcome: "blocked"; reason: string }
  | { outcome: "failed"; stage: string };

export interface LandE2eRecord {
  commit: string;
  range: string;
  startedAt: string;
  finishedAt: string;
  log: string;
  issues?: string[];
  result: LandE2eOutcome | { outcome: "skipped" | "not-run"; reason: string };
}

interface LandE2eState {
  lastRun?: string;
  lastPassed?: string;
  lastFailed?: string;
  lastFailedIssues?: string[];
}

export interface LandE2eRun {
  request: LandE2eRequest;
  logPath: string;
  checkout: string;
  resultsDir: string;
  progress: (what: string) => void;
  leaseEnded: AbortSignal;
}

export interface LandE2eDeps {
  run: (run: LandE2eRun) => Promise<LandE2eOutcome>;
  evidence: (failure: {
    run: LandE2eRun;
    range: string;
  }) => Promise<{ commits: string; log: string; cases: E2eCase[] }>;
  issues: E2eIssues;
}

const GITHUB_REMOTE = regex(
  "github\\.com[:/](?<repository>[^/]+/[^/]+?)(?:\\.git)?/?$",
);

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

export async function requestLandE2e(
  request: LandE2eRequest,
  dir: string = landE2eDir(),
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(join(dir, "request.json"), request);
}

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
    const checkout = join(dir, "checkout");
    const run: LandE2eRun = {
      request,
      logPath,
      checkout,
      resultsDir: join(
        checkout,
        ".scratch/e2e-results",
        basename(logPath, ".log"),
      ),
      progress: throttledProgress((what) => turn.progress(what)),
      leaseEnded: lease.signal,
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
    const issues = await reportToIssues(deps, {
      dir,
      run,
      range,
      result,
      state,
    }).catch((error: unknown) => {
      log(`End-to-end Run: the issues were not written: ${String(error)}`);
      return [];
    });
    const record: LandE2eRecord = {
      commit: request.commit,
      range,
      startedAt,
      finishedAt: Temporal.Now.instant().toString(),
      log: logPath,
      ...(issues.length > 0 ? { issues } : {}),
      result,
    };
    await appendFile(join(dir, "runs.jsonl"), `${JSON.stringify(record)}\n`);
    if (result.outcome !== "blocked") {
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
        lastFailedIssues:
          result.outcome === "failed"
            ? [...new Set([...(state.lastFailedIssues ?? []), ...issues])]
            : result.outcome === "passed"
              ? undefined
              : state.lastFailedIssues,
      } satisfies LandE2eState);
    }
    log(`End-to-end Run of ${request.commit.slice(0, 12)}: ${result.outcome}.`);
    return record;
  } finally {
    slot.release();
  }
}

async function reportToIssues(
  { evidence, issues }: LandE2eDeps,
  {
    dir,
    run,
    range,
    result,
    state,
  }: {
    dir: string;
    run: LandE2eRun;
    range: string;
    result: LandE2eOutcome;
    state: LandE2eState;
  },
): Promise<string[]> {
  const { request, logPath } = run;
  const repository = request.issueRepository;
  if (!repository) return [];
  if (result.outcome === "passed" && state.lastFailedIssues?.length) {
    return reportE2ePass(issues, repository, {
      urls: state.lastFailedIssues,
      body: `The End-to-end Run after a land passed on \`main\` at ${request.commit}, after the failure at ${state.lastFailed}. Commit range: \`${range}\`. This issue stays open until a person closes it.`,
    });
  }
  if (result.outcome !== "failed") return [];
  const { commits, log, cases } = await evidence({ run, range });
  return reportE2eFailure(issues, repository, {
    introduction: [
      `The End-to-end Run after a land failed at the ${result.stage} stage, on \`main\` at ${request.commit}.`,
      "",
      `Commit range: \`${range}\` (from the last tip that passed).`,
      "",
      "```text",
      commits.trim() || request.commit,
      "```",
      "",
    ],
    stage: result.stage,
    evidence: `The full log is on the machine that ran it: \`${relative(dir, logPath)}\` in the End-to-end state directory (\`pnpm land --help\` names it).`,
    log,
    cases,
  });
}

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
