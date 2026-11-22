import { parse } from "yaml";

import { verifyHalf } from "#gate-halves";
import { GATE_SHARD_FLAG } from "#gate-shards";
import {
  LAND_CI_CHECK,
  LAND_CI_JOB_TIMEOUT_MINUTES,
  LAND_CI_WAIT_MS,
} from "#land";

export const RECORD_PR_WORKFLOW = ".github/workflows/record-pr.yml";

const MINUTE = 60_000;
const CHECK_MARGIN_MS = 5 * MINUTE;

const SHARD_RUN = `${verifyHalf("pr").join(" ")} ${GATE_SHARD_FLAG}=\${{ matrix.shard }}/\${{ strategy.job-total }}`;

interface WorkflowJob {
  name?: string;
  needs?: string | string[];
  if?: string;
  strategy?: { matrix?: { shard?: number[] } };
  "timeout-minutes"?: number;
  steps?: { env?: Record<string, string>; run?: string }[];
}

export function recordPrProblems(text: string): string[] {
  const workflow = parse(text) as { jobs?: Record<string, WorkflowJob> };
  const jobs = Object.entries(workflow.jobs ?? {});
  const gate = jobs.find(([, each]) => each.name === LAND_CI_CHECK)?.[1];
  const shards = jobs.filter(([, each]) => each !== gate);
  const [shard] = shards;
  if (!gate || !shard || shards.length !== 1) {
    return [
      `it must have one job that runs the shards, and one named "${LAND_CI_CHECK}" (LAND_CI_CHECK in lib/land.ts); it has ${jobs.map(([id, each]) => `"${each.name ?? id}"`).join(", ") || "none"}`,
    ];
  }
  const [shardId, job] = shard;
  const problems: string[] = [];
  const result = `\${{ needs.${shardId}.result }}`;
  const steps = gate.steps ?? [];
  if (
    gate.needs !== shardId ||
    gate.if !== "always()" ||
    steps.length !== 1 ||
    steps[0]?.env?.RESULT !== result ||
    steps[0].run?.trim() !== 'test "$RESULT" = success'
  ) {
    problems.push(
      `"${LAND_CI_CHECK}" must need "${shardId}", run \`if: always()\`, and have one step that fails unless ${result} is success`,
    );
  }
  const indexes = job.strategy?.matrix?.shard ?? [];
  if (indexes.length === 0 || indexes.some((index, at) => index !== at + 1)) {
    problems.push(
      `its shards must count from 1 without a gap; they are ${indexes.join(", ") || "not set"}`,
    );
  }
  const timeouts = [job["timeout-minutes"], gate["timeout-minutes"]];
  const timeout = timeouts.reduce<number>(
    (sum, each) => sum + (each ?? Number.NaN),
    0,
  );
  if (timeout !== LAND_CI_JOB_TIMEOUT_MINUTES) {
    problems.push(
      `its jobs' timeout-minutes are ${timeouts.map((each) => each ?? "not set").join(" + ")}, which do not add up to ${LAND_CI_JOB_TIMEOUT_MINUTES} (LAND_CI_JOB_TIMEOUT_MINUTES in lib/land.ts)`,
    );
  }
  if (
    LAND_CI_WAIT_MS - LAND_CI_JOB_TIMEOUT_MINUTES * MINUTE <
    CHECK_MARGIN_MS
  ) {
    problems.push(
      "LAND_CI_WAIT_MS in lib/land.ts must be at least 5 min longer than the jobs' timeouts",
    );
  }
  const runs = (job.steps ?? []).flatMap((step) =>
    step.run?.includes("pnpm verify") ? [step.run.trim()] : [],
  );
  if (runs.length !== 1 || runs[0] !== SHARD_RUN) {
    problems.push(
      `each shard must run \`${SHARD_RUN}\` once (lib/gate-shards.ts); it runs ${runs.map((each) => `\`${each}\``).join(", ") || "no pnpm verify"}`,
    );
  }
  return problems;
}
