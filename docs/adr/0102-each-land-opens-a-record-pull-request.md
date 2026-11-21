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
- **The land pushes `main`, not GitHub.** The land then pushes `main` to the PR head as a fast-forward, as before. GitHub shows the PR as merged, and its `Closes #N` lines close the tickets. No one clicks merge, and the PR is not a gate.
- **The task branch is temporary.** The land reads the PR state once after the push of `main`. When the PR shows as merged, the land deletes the task branch, and the merged PR stays as the record. When it does not, the land keeps the branch, so the PR stays open, and says so.
- **The trunk stays one branch.** `main` is still the only long-lived branch. A task branch is on the source repository only during its land, and only `pnpm land` pushes it there: the push rules of the pre-push hook are unchanged, because a land that holds its Land Turn may already push any ref.
- **Public records.** The repository is public, so each record PR is public. The record writes paths relative to the repository. A security finding that is not fixed goes to a private place, and the record shows only its count.
- **Releases.** The version commit of `pnpm release` lands through the same `land`, with the release gate and no record PR.

## Considered options

- **Keep the record in the commit messages.** The commits carry what changed and how it was checked, but not the review findings, their outcomes, or the open points, and GitHub shows no diff of the whole change with its evidence.
- **A record issue or a comment on the ticket.** It holds the text, but not the diff, and it does not connect the ticket to the commits through a merged PR.
- **Merge the PR through GitHub.** It moves the merge out of the Land Queue, which is the merge queue of this repository: a personal account has no GitHub merge queue.

## Consequences

- The source repository has pull requests again, one per land, each opened and merged by the land.
- A land needs a `gh` login that GitHub accepts. The land checks it before its turn, so a bad login fails before the gate.
- Whether GitHub marks the PR as merged when `main` moves to its head is checked by the first real land. If it does not, the land merges the PR through the API with a fast-forward-equivalent method, and this ADR and #122 are updated.
- Later tickets of #122 build on the record PR: the CI result on it before `main` moves, the `land-approved` label for the blocking paths, and the release summary of the record PRs since the last tag.
