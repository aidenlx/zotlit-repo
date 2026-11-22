#!/usr/bin/env node
// Holds the record PR workflow to the land (lib/record-pr-workflow.ts): the
// job's name, its timeout and its run line.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getWorkspaceRoot } from "#package-roots";
import { RECORD_PR_WORKFLOW, recordPrProblems } from "#record-pr-workflow";

const root = await getWorkspaceRoot(import.meta.dirname);
const problems = recordPrProblems(
  readFileSync(join(root, RECORD_PR_WORKFLOW), "utf8"),
);
if (problems.length > 0) {
  console.error(
    `${RECORD_PR_WORKFLOW} differs from the land:\n${problems.map((each) => `  - ${each}`).join("\n")}`,
  );
  process.exit(1);
}
