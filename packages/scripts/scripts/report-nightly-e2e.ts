import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { githubE2eIssues } from "#e2e-issues";
import { readFailedE2eCases, reportE2eFailure } from "#e2e-report";

const {
  GITHUB_REPOSITORY: repository,
  GITHUB_SHA: commit,
  GITHUB_SERVER_URL: server,
  GITHUB_RUN_ID: run,
  RUNNER_TEMP: temp,
} = process.env;
if (!repository || !commit || !server || !run || !temp) {
  throw new Error("Report the nightly End-to-end Run from GitHub Actions.");
}

const directory = join(temp, "nightly-e2e");
await mkdir(directory, { recursive: true });
const log = await readFile(join(directory, "console.log"), "utf8");
const issues = githubE2eIssues(directory);
try {
  const urls = await reportE2eFailure(issues, repository, {
    introduction: [
      `The nightly End-to-end Run failed on \`main\` at ${commit}.`,
      "",
    ],
    stage: "End-to-end Run",
    evidence: `The [Actions run](${server}/${repository}/actions/runs/${run}) contains the log and evidence.`,
    log,
    cases: await readFailedE2eCases(join(directory, "evidence")),
  });
  console.log(urls.join("\n"));
} finally {
  await rm(join(directory, "issue-body.md"), { force: true });
}
