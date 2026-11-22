import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { E2E_PERFORMANCE_ENV } from "./performance-mode.ts";
import { E2E_RESULTS_ENV, newE2eResultsDir } from "./results-dir.ts";

const files = [
  "src/citation-index.e2e.ts",
  "src/citation-scan.e2e.ts",
  "src/query-cli.e2e.ts",
  "src/literature-notes.e2e.ts",
];
const root = await getWorkspaceRoot(import.meta.dirname);
const results = newE2eResultsDir();
const report = join(results, "results.json");
await $({
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    [E2E_RESULTS_ENV]: results,
    [E2E_PERFORMANCE_ENV]: "1",
  },
})`pnpm e2e --project=desktop ${files}`;
const result = JSON.parse(await readFile(report, "utf8")) as {
  numPassedTests: number;
  numTotalTests: number;
  success: boolean;
  testResults: unknown[];
};
if (
  !result.success ||
  result.testResults.length !== files.length ||
  result.numPassedTests !== result.numTotalTests
) {
  throw new Error(
    "The performance run requires all cases in its desktop files to execute and pass.",
  );
}
