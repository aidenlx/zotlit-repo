#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  NIGHTLY_E2E_NOTIFY_WORKFLOW,
  nightlyE2eNotifyReport,
} from "#nightly-e2e-notify";
import { getWorkspaceRoot } from "#package-roots";

const root = await getWorkspaceRoot(import.meta.dirname);
const problems = await nightlyE2eNotifyReport(
  readFileSync(join(root, NIGHTLY_E2E_NOTIFY_WORKFLOW), "utf8"),
);
if (problems.length > 0) {
  console.error(
    `${NIGHTLY_E2E_NOTIFY_WORKFLOW} cannot notify Grok Bot:\n${problems.map((each) => `  - ${each}`).join("\n")}`,
  );
  process.exit(1);
}
