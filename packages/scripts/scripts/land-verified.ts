import { $ } from "zx";

import { attributionLines, isAgentIdentity } from "#ai-attribution";
import { isConventionalSubject } from "#conventional-commit";
import { LAND_CI_CHECK } from "#land";
import { ghLandGitHub } from "#land-github";

const {
  GITHUB_REPOSITORY: repo,
  LAND_HEAD: head,
  LAND_BASE: base,
  LAND_PULL: number,
  LAND_SKIP_CI: skipCi = "false",
  GITHUB_EVENT_NAME: event,
} = process.env;
if (!repo || !head || !base || !number)
  throw new Error("Missing landing inputs.");
if (skipCi !== "true" && skipCi !== "false")
  throw new Error(`LAND_SKIP_CI must be "true" or "false", not "${skipCi}".`);
if (skipCi === "true" && event !== "workflow_dispatch")
  throw new Error(
    `Only a dispatch of the landing workflow can skip the Record PR tests check, not a ${event} run.`,
  );
const git = $({ quiet: true });
const pr = JSON.parse(
  (await git`gh api ${`repos/${repo}/pulls/${Number(number)}`}`).stdout,
);
if (
  pr.state !== "open" ||
  pr.draft ||
  pr.head.repo.full_name !== repo ||
  pr.base.ref !== "main" ||
  pr.head.sha !== head ||
  pr.base.sha !== base
) {
  throw new Error(
    "The record PR must be open, ready for review, and at the requested head and base.",
  );
}
if ((await git`git rev-parse HEAD`).stdout.trim() !== base)
  throw new Error("The trusted checkout must match the requested base.");
await git`git fetch --no-tags origin ${`refs/pull/${pr.number}/head`}`;
if ((await git`git rev-parse FETCH_HEAD`).stdout.trim() !== head)
  throw new Error("Record PR head moved.");
await git`git merge-base --is-ancestor ${base} ${head}`;
if (skipCi === "false") {
  const check = await ghLandGitHub(repo).readCheck({
    commit: head,
    name: LAND_CI_CHECK,
    branch: pr.head.ref,
  });
  if (check?.conclusion !== "success" || check.status !== "completed")
    throw new Error("Record PR tests must pass for this commit.");
}
const commits = (await git`git rev-list ${`${base}..${head}`}`).stdout
  .trim()
  .split("\n");
for (const commit of commits) {
  const [author, email, committer, committerEmail, message] = (
    await git`git show -s --format=%an%x00%ae%x00%cn%x00%ce%x00%B ${commit}`
  ).stdout.split("\0");
  if (
    isAgentIdentity(author!, email!) ||
    isAgentIdentity(committer!, committerEmail!) ||
    attributionLines(message!).length
  ) {
    throw new Error(`Remove AI attribution from commit ${commit}.`);
  }
  if (!isConventionalSubject(message!)) {
    throw new Error(
      `Give commit ${commit} a Conventional Commits subject, such as "fix(scope): description".`,
    );
  }
}
