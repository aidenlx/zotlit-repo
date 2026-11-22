import type { Admission } from "#desktop-slot";
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
import { join, relative } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";

import {
  acquireDesktopSlot,
  describeLeaseEnd,
  DesktopSlotBlockedError,
  SILENCE_LIMIT_MS,
  throttledProgress,
} from "#desktop-slot";
import { landStateDir } from "#land-queue";

const HOUR = 3_600_000;

export const readLandE2eEvidence: LandE2eDeps["evidence"] = async ({
  run,
  range,
}) => {
  const { logPath, checkout } = run;
  const log = stripVTControlCharacters(await readFile(logPath, "utf8"));
  const args = ["log", "--oneline", "--no-decorate", "-n", "50", range];
  const { stdout: commits, stderr } = await promisify(execFile)("git", args, {
    cwd: checkout,
  }).catch((error: { stdout?: string; stderr?: string }) => ({
    stdout: error.stdout ?? "",
    stderr: error.stderr ?? "",
  }));
  await appendFile(logPath, `\n$ git ${args.join(" ")}\n${commits}${stderr}`);
  return { commits, log };
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
  issue?: string;
  result: LandE2eOutcome | { outcome: "skipped" | "not-run"; reason: string };
}

interface LandE2eState {
  lastRun?: string;
  lastPassed?: string;
  lastFailed?: string;
}

export const E2E_ISSUE_TITLE = "End-to-end Run fails on main";
const E2E_ISSUE_LABEL = "needs-triage";
const EXCERPT_LINES = 80;

export interface LandE2eIssue {
  number: number;
  title: string;
  url: string;
}

export interface LandE2eIssues {
  listOpen: (repository: string, title: string) => Promise<LandE2eIssue[]>;
  create: (
    repository: string,
    issue: { title: string; body: string; label: string },
  ) => Promise<string>;
  comment: (repository: string, number: number, body: string) => Promise<void>;
}

export interface LandE2eRun {
  request: LandE2eRequest;
  logPath: string;
  checkout: string;
  progress: (what: string) => void;
  leaseEnded: AbortSignal;
}

export interface LandE2eDeps {
  run: (run: LandE2eRun) => Promise<LandE2eOutcome>;
  evidence: (failure: {
    run: LandE2eRun;
    range: string;
  }) => Promise<{ commits: string; log: string }>;
  issues: LandE2eIssues;
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
    const result = await deps
      .run(run)
      .catch((error: unknown): LandE2eOutcome => ({
        outcome: "failed",
        stage: `runner: ${(error as Error).message}`,
      }));
    const issue = await reportToIssue(deps, {
      dir,
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
      } satisfies LandE2eState);
    }
    log(`End-to-end Run of ${request.commit.slice(0, 12)}: ${result.outcome}.`);
    return record;
  } finally {
    slot.release();
  }
}

async function reportToIssue(
  { evidence, issues }: LandE2eDeps,
  {
    dir,
    run,
    range,
    result,
    lastFailed,
  }: {
    dir: string;
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
  const open = await findOpenE2eIssue(issues, repository);
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
  const body = formatE2eFailure(
    log,
    [
      `The End-to-end Run after a land failed at the ${result.stage} stage, on \`main\` at ${request.commit}.`,
      "",
      `Commit range: \`${range}\` (from the last tip that passed).`,
      "",
      "```text",
      commits.trim() || request.commit,
      "```",
      "",
    ],
    {
      stage: result.stage,
      evidence: `The full log is on the machine that ran it: \`${relative(dir, logPath)}\` in the End-to-end state directory (\`pnpm land --help\` names it).`,
    },
  );
  return publishE2eFailure(issues, repository, { body, open });
}

export async function findOpenE2eIssue(
  issues: LandE2eIssues,
  repository: string,
): Promise<LandE2eIssue | undefined> {
  return (await issues.listOpen(repository, E2E_ISSUE_TITLE))
    .filter(({ title }) => title === E2E_ISSUE_TITLE)
    .toSorted((a, b) => b.number - a.number)[0];
}

export function formatE2eFailure(
  log: string,
  introduction: readonly string[],
  { stage, evidence }: { stage: string; evidence: string },
): string {
  const lines = stripVTControlCharacters(log).trimEnd().split("\n");
  const cases = failedCases(lines);
  return [
    ...introduction,
    cases.length > 0
      ? `Failed cases:\n\n${cases.map((name) => `- \`${name}\``).join("\n")}`
      : `The log names no failed case; the run failed at the ${stage} stage.`,
    "",
    `${evidence} The last ${EXCERPT_LINES} lines:`,
    "",
    "```text",
    lines.slice(-EXCERPT_LINES).join("\n"),
    "```",
  ].join("\n");
}

export async function publishE2eFailure(
  issues: LandE2eIssues,
  repository: string,
  { body, open }: { body: string; open: LandE2eIssue | undefined },
): Promise<string> {
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

const FAILED_CASE = regex(" FAIL +(?<name>\\S.*)$");

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
