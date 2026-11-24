import { $ } from "zx";

import { attributionLines, isAgentIdentity } from "#ai-attribution";
import { LAND_CI_CHECK } from "#land";
import { ghLandGitHub } from "#land-github";

const {
  GITHUB_REPOSITORY: repo,
  LAND_HEAD: head,
  LAND_BASE: base,
  LAND_PULL: number,
} = process.env;
if (!repo || !head || !base || !number)
  throw new Error("Missing landing inputs.");
const git = $({ quiet: true });
const pr = JSON.parse(
  (await git`gh api ${`repos/${repo}/pulls/${Number(number)}`}`).stdout,
);
if (
  pr.state !== "open" ||
  pr.head.repo.full_name !== repo ||
  pr.base.ref !== "main" ||
  pr.head.sha !== head ||
  pr.base.sha !== base
) {
  throw new Error("The record PR must be open at the requested head and base.");
}
if ((await git`git rev-parse HEAD`).stdout.trim() !== base)
  throw new Error("The trusted checkout must match the requested base.");
await git`git fetch --no-tags origin ${`refs/pull/${pr.number}/head`}`;
if ((await git`git rev-parse FETCH_HEAD`).stdout.trim() !== head)
  throw new Error("Record PR head moved.");
await git`git merge-base --is-ancestor ${base} ${head}`;
const check = await ghLandGitHub(repo).readCheck({
  commit: head,
  name: LAND_CI_CHECK,
  branch: pr.head.ref,
});
if (check?.conclusion !== "success" || check.status !== "completed")
  throw new Error("Record PR tests must pass for this commit.");
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
}
