import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { E2E_RESULTS_ENV, newE2eResultsDir } from "./results-dir.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const results = newE2eResultsDir();
const report = join(results, "results.json");
await $({
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, [E2E_RESULTS_ENV]: results },
})`pnpm e2e --project=desktop citation-index`;
const result = JSON.parse(await readFile(report, "utf8")) as {
  numPassedTests: number;
  numPendingTests: number;
  success: boolean;
};
if (
  !result.success ||
  result.numPassedTests < 4 ||
  result.numPendingTests !== 0
) {
  throw new Error(
    "Worker responsiveness requires all four desktop regression cases to execute and pass.",
  );
}
