---
status: accepted
---

# Each land opens a record pull request

Supersedes in part [ADR 0097](0097-main-is-the-one-trunk.md) (no other branch is pushed to `aidenlx/zotlit-repo`) and [ADR 0096](0096-releases-land-without-pull-requests-and-publish-across-two-repositories.md) (the source repository has no pull requests). Decided in spec [#122](https://github.com/aidenlx/zotlit-repo/issues/122) (Q3), built in [#123](https://github.com/aidenlx/zotlit-repo/issues/123).

## Context

ZotLit has one human maintainer, and agents write most of the code. A change reaches `main` only through `pnpm land`, and the pre-push hook lets an agent session push nothing itself. The record of a change stays in the agent session and in `.scratch/`: the review findings and their outcomes, the fix rounds, the architecture choices, and the e2e evidence. So the maintainer cannot see on GitHub what happened between the spec and the commits on `main`.

ADR 0097 kept one branch on the source repository, and ADR 0096 removed pull requests. Both rules served the trunk model: one long-lived branch, and no merge path beside `pnpm land`. They do not need the source repository to have no task branches and no pull requests at all.

## Decision

- **Record PR.** In its Land Turn, after the rebase and the gate, `pnpm land` pushes the rebased task branch to `aidenlx/zotlit-repo` and opens a pull request from it into `main`, or updates the PR that is open from an earlier land of the branch. The title and body come from the record file that the agent wrote in the git-ignored scratch folder of the worktree (`pnpm land --help` names the path and the sections). The land refuses a record without its sections, before it pushes anything.
- **The land pushes `main`, not GitHub.** The land then pushes `main` to the PR head as a fast-forward, as before. GitHub shows the PR as merged, and its `Closes #N` lines close the tickets. No one merges the PR by hand; its CI check gates the push of `main`.
- **The task branch is temporary.** The land polls the PR state for up to 30 seconds after the push of `main`, since GitHub can show the PR as open immediately after the push. When the PR shows as merged, the land deletes the task branch, and the merged PR stays as the record. When it does not, the land keeps the branch, so the PR stays open, and says so.
- **The trunk stays one branch.** `main` is still the only long-lived branch. An agent session pushes a task branch only through `pnpm land`, and the land deletes the branch once its record PR shows as merged. A person may push a task branch to share it, as before. The push rules of the pre-push hook are unchanged: a land that holds its Land Turn may already push any ref.
- **Public records.** The repository is public, so each record PR is public. The record writes paths relative to the repository. A security finding that is not fixed goes to a private place, and the record shows only its count.
- **Releases.** The version commit of `pnpm release` lands through the same `land`, with the release gate and no record PR.

## Considered options

- **Keep the record in the commit messages.** The commits carry what changed and how it was checked, but not the review findings, their outcomes, or the open points, and GitHub shows no diff of the whole change with its evidence.
- **A record issue or a comment on the ticket.** It holds the text, but not the diff, and it does not connect the ticket to the commits through a merged PR.
- **Merge the PR through GitHub.** It moves the merge out of the Land Queue, which is the merge queue of this repository: a personal account has no GitHub merge queue.

## Consequences

- The source repository has pull requests again, one per land, each opened and merged by the land.
- A land needs a `gh` login that GitHub accepts. The land checks it before its turn, so a bad login fails before the gate.
- Open point, answered by the first real land: whether GitHub marks the PR as merged when `main` moves to its head. Until then, a land whose PR does not show as merged keeps the branch and says so.
- The CI result on the record PR gates `main`: the land waits for its check before it pushes (#129).
- Deferred work builds on the record PR: the `land-approved` label for the blocking paths, and the release summary of the record PRs since the last tag (#127).

## Gate and GitHub contracts

`packages/scripts/lib/gate-halves.ts` assigns every verify step to its half. Land and the workflow consume that table. The record workflow lint check compares its shards, its gate job, their timeouts and the run command with the land contract. An agent-namespaced branch fails preflight before any wait record or push. Agent-only documentation changes run Format in the local half.

Land matches the record PR head repository as well as its branch name, since GitHub head filters can return a fork with the same branch name. It accepts a result only from the workflow run for that repository and branch, and reads the jobs of that run once it is complete: a rerun keeps the gate job of the earlier attempt until its shards end. The wait record carries the head, the gate's result, the longest time that a shard waited for a runner, and the link of the failed shard. The default poll reads every 30 seconds and costs one API call, and one more on completion. The deadline includes the workflow limit and five minutes for scheduling and publication.

The tests run in three shards as parallel jobs, and the one job that Land waits for, `Record PR tests`, passes only when each of them passed. A package's `test` task joins a shard through its Turborepo task tag, `ci-shard-1` or `ci-shard-2`. The last shard takes every task without one of those tags, the root test tasks and the bundle budget, so a new package runs without a tag. The tags balance the measured test times of the eight longest packages.

A newer PR head replaces its former CI run. A failed check leaves the record branch visible for inspection. After `main` advances, GitHub failures become part of the report. Land reads the PR state every two seconds for up to 30 seconds and deletes the temporary branch after GitHub confirms the merge. A closed PR ends the wait. A failed read leaves the PR unconfirmed and the land can try again within the deadline.
