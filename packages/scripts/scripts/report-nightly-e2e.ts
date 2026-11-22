import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { githubE2eIssues } from "#e2e-issues";
import {
  findOpenE2eIssue,
  formatE2eFailure,
  publishE2eFailure,
} from "#land-e2e";

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
const body = formatE2eFailure(
  log,
  [`The nightly End-to-end Run failed on \`main\` at ${commit}.`, ""],
  {
    stage: "End-to-end Run",
    evidence: `The [Actions run](${server}/${repository}/actions/runs/${run}) contains the log and evidence.`,
  },
);
const issues = githubE2eIssues(directory);
try {
  const open = await findOpenE2eIssue(issues, repository);
  console.log(await publishE2eFailure(issues, repository, { body, open }));
} finally {
  await rm(join(directory, "issue-body.md"), { force: true });
}
