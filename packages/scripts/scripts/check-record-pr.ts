#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LAND_WORKFLOW, RECORD_PR_WORKFLOW } from "#land";
import { landWorkflowProblems } from "#land-workflow";
import { getWorkspaceRoot } from "#package-roots";
import { recordPrProblems } from "#record-pr-workflow";

const root = await getWorkspaceRoot(import.meta.dirname);
const read = (path: string) => readFileSync(join(root, path), "utf8");
const reports = [
  [RECORD_PR_WORKFLOW, recordPrProblems(read(RECORD_PR_WORKFLOW))],
  [LAND_WORKFLOW, landWorkflowProblems(read(LAND_WORKFLOW))],
] as const;
for (const [path, problems] of reports) {
  if (problems.length > 0) {
    console.error(
      `${path} differs from the land:\n${problems.map((each) => `  - ${each}`).join("\n")}`,
    );
  }
}
if (reports.some(([, problems]) => problems.length > 0)) process.exit(1);
