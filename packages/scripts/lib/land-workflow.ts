import { parse } from "yaml";

import { LAND_AFTER_CI_MARKER } from "#land";

interface WorkflowStep {
  env?: Record<string, string>;
  run?: string;
}

export function landWorkflowProblems(text: string): string[] {
  const workflow = parse(text) as {
    jobs?: Record<string, { steps?: WorkflowStep[] }>;
  };
  const steps = Object.values(workflow.jobs ?? {}).flatMap(
    (job) => job.steps ?? [],
  );
  const pick = steps.filter((step) => step.env?.MARKER !== undefined);
  const marker = pick[0]?.env?.MARKER;
  if (
    pick.length === 1 &&
    marker === LAND_AFTER_CI_MARKER &&
    pick[0]?.run?.includes('*"$MARKER"*')
  ) {
    return [];
  }
  return [
    `one step must set env MARKER to "${LAND_AFTER_CI_MARKER}" (LAND_AFTER_CI_MARKER in lib/land.ts) and match the record PR body against *"$MARKER"*; ${pick.length === 0 ? "no step sets MARKER" : `the steps set ${pick.map((step) => `"${step.env?.MARKER}"`).join(", ")}`}`,
  ];
}
