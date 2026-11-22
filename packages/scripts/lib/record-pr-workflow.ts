// The contract between the record PR workflow (.github/workflows/record-pr.yml)
// and the land: the land finds the check by the job's name, waits for it a
// fixed time after the job's timeout, and counts on the job to run the PR half
// of `pnpm verify`. `pnpm lint` (scripts/check-record-pr.ts) holds the
// workflow to these constants, so a rename fails the lint of the land's gate,
// not a land after its 45 min wait.
import { parse } from "yaml";

import { verifyHalf } from "#gate-halves";
import {
  LAND_CI_CHECK,
  LAND_CI_JOB_TIMEOUT_MINUTES,
  LAND_CI_WAIT_MS,
} from "#land";

/** The path of the workflow, relative to the repository root. */
export const RECORD_PR_WORKFLOW = ".github/workflows/record-pr.yml";

const MINUTE = 60_000;
/** The time a runner and GitHub's check need around the job's own run. */
const CHECK_MARGIN_MS = 5 * MINUTE;

interface WorkflowJob {
  name?: string;
  "timeout-minutes"?: number;
  steps?: { run?: string }[];
}

/** What in the workflow text `text` differs from the land; empty when none. */
export function recordPrProblems(text: string): string[] {
  const workflow = parse(text) as { jobs?: Record<string, WorkflowJob> };
  const jobs = Object.values(workflow.jobs ?? {});
  const job = jobs.find((each) => each.name === LAND_CI_CHECK);
  if (!job || jobs.length !== 1) {
    return [
      `it must have one job, named "${LAND_CI_CHECK}" (LAND_CI_CHECK in lib/land.ts); it has ${jobs.map((each) => `"${each.name ?? "(no name)"}"`).join(", ") || "none"}`,
    ];
  }
  const problems: string[] = [];
  const timeout = job["timeout-minutes"];
  if (timeout !== LAND_CI_JOB_TIMEOUT_MINUTES) {
    problems.push(
      `its job's timeout-minutes is ${timeout ?? "not set"}, not ${LAND_CI_JOB_TIMEOUT_MINUTES} (LAND_CI_JOB_TIMEOUT_MINUTES in lib/land.ts)`,
    );
  }
  if (
    LAND_CI_WAIT_MS - LAND_CI_JOB_TIMEOUT_MINUTES * MINUTE <
    CHECK_MARGIN_MS
  ) {
    problems.push(
      "LAND_CI_WAIT_MS in lib/land.ts must be at least 5 min longer than the job's timeout",
    );
  }
  const expected = verifyHalf("pr").join(" ");
  const runs = (job.steps ?? []).flatMap((step) =>
    step.run?.includes("pnpm verify") ? [step.run.trim()] : [],
  );
  if (runs.length !== 1 || runs[0] !== expected) {
    problems.push(
      `its job must run \`${expected}\` once (lib/gate-halves.ts); it runs ${runs.map((each) => `\`${each}\``).join(", ") || "no pnpm verify"}`,
    );
  }
  return problems;
}
