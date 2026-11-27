---
name: land
description: "Use when a change is done and should reach main or wait for review in a draft record PR, when a land fails, when writing the commits or the record file a land carries, or when checking the record PRs before a release."
---

## Land

A change reaches `main`, the one long-lived branch, only through `pnpm land`. One land at a time per machine holds the Land Turn, in the order the lands started, and in that turn it:

```text
fetch origin/main ─▶ rebase ─▶ squash by default ─▶ install ─▶ pnpm verify --local
   ▲   ─▶ record: push the branch, open or update its record PR
   │   ─▶ ci: wait for record PR CI ─▶ landing App fast-forwards main to the checked commit
   │                                                      │ main moved
   └──────────────────────────────────────────────────────┘
install: pnpm install --frozen-lockfile --prefer-offline, only when the rebase
         changed pnpm-lock.yaml, pnpm-workspace.yaml, or a package.json
then: move the local main, read the PR state; when GitHub shows it as merged,
      delete the task branch on origin
```

1. Commit every change on the task branch. `land` refuses a tree with uncommitted or untracked files.
2. Write the record file in the task worktree (see [The record file](#the-record-file)). `land` refuses a land without it before it pushes anything.
3. Use `pnpm land` to make one commit with the record title and body. Use `pnpm land --no-squash` when the task calls for separate commits. Use `pnpm land --draft` when the maintainer asks to review the change before it lands, or says not to land it; a later `pnpm land` finishes it. Run the chosen command from the task worktree, in the background: the gate and the CI wait take minutes, and the wait for the turn can take longer. While it waits, the land checks the branch against each new `origin/main` and exits at `rebase` on a conflict. Wait for it to exit.
4. Read the result in the last lines of the output. A failed or blocked land names its cause and the next action there.
   - **After `pnpm land` lands:** The output names the record PR and the pushed commit. When it says that the PR does not show as merged, the task branch stays on origin and the PR stays open: report this on the ticket. Close the ticket as `docs/agents/issue-tracker.md` describes, then review the task worktree for retirement.
   - **After `pnpm land --draft`:** the draft record PR is open and `main` is unchanged. Keep the task worktree and the ticket open, and give the PR URL in the handoff.

## Retire the task worktree

After a successful land, review the linked worktree used for that task. Confirm its current HEAD matches the landed commit. Run `git status --short --untracked-files=all` and `git ls-files --others --ignored --exclude-standard --directory`. Inspect ignored directories that can hold original work, especially `.scratch/`, fixture vaults, and the nested `video/` checkout. Preserve any deliverables and evidence the task still needs.

When only reproducible files remain and the task has finished using the checkout, run `wt remove <branch>` from the primary worktree. Confirm the path is gone from `git worktree list`. In the handoff, report the worktree removed or give the retained path and the specific work or files that still need it.

## The record file

The record PR holds the record of the change, so the maintainer reads the change and its evidence on GitHub. Its title and body come from the record file, in the git-ignored scratch folder of the task worktree, so the tree stays clean. `pnpm land --help` names the path of the file, its title line, and its sections; `land` refuses a record that lacks one of them. A default land uses the title as the subject of the squash commit, so `land` refuses a title that is not a Conventional Commits subject. Write it with the `pr` skill, which gives the format of each section. Each section holds:

- **Summary:** what the change does for its users.
- **Testing:** the suites and commands that ran, with their results.
- **Risk** and **How to revert:** what can break for a user, and the commits or steps that undo it.
- **Review:** the finding lines of every review round, each with its outcome (`code-review` → Finding lines).
- **Open points:** a `- [ ] ` checklist item for each open point.
- **e2e:** the e2e files that ran, and their result.

In every record:

- Put `Closes #<n>` for each ticket of the change in the Summary. GitHub closes the tickets when the PR shows as merged.
- The repository is public, so the PR is public: write paths relative to the repository, never local absolute paths or scratch log locations.

A land of a branch that has an open record PR, such as a land again after a failure, updates that PR from the record file. Edit the record file before you land again.

## The CI wait

The local gate is `pnpm verify --local`: Format, Generated artifacts, Lint, Typecheck and Snapshot size. The tests of the affected packages and the bundle budget run in CI on the record PR (`.github/workflows/record-pr.yml`, `pnpm verify --pr` in parallel shards). The land holds its Land Turn while CI runs, and prints the state of the check at each read (`queued`, `in progress`, then the result and the longest time a shard waited for a runner). After CI passes, the land dispatches the landing workflow on `main`. The workflow checks the open record PR, its head and base, the successful CI check, and each incoming commit against the attribution policy and for a Conventional Commits subject. The landing App then fast-forwards `main` to that head. `pnpm land --help` names the check and how long the land waits for it.

In a cloud session whose GitHub token can push branches but cannot dispatch workflows (`Resource not accessible by integration`), such as a Cursor cloud agent, use `pnpm land --after-ci`. Name the branch by change type, as for any land. Keep the commit author and committer as the repository owner's identity.

1. Run `pnpm land --after-ci`. It pushes the branch and opens the record PR with a marker at the end of its body. When the record PR CI passes, the landing workflow runs on `main` for that marked PR, with the same checks and the same fast-forward, and the land waits for `main` to reach the head.
2. When the token also cannot open or edit a PR, such as `gh` in a Cursor cloud VM, the land exits 1 at `record` after the push and writes the title and body of the record PR to `.scratch/land-pr.md`. Open the PR from the branch into `main` with the PR tool of the host. In Cursor, that is `ManagePullRequest` with `skip_branch_prefix_check`. Use the first line of the file, without `# `, as the title and the rest, with its marker line, as the body.
3. Run `pnpm land --after-ci` again. It finds the open PR, leaves a PR whose title and body match the record as it is, and waits for CI and `main`. A PR that differs needs an edit, which such a token cannot do: open it again from the file.

After `main` moves, `pnpm site:release --pick <record PR>` works from the same session.

`pnpm land --no-verify` leaves out the local gate, so only the CI half checks the change before `main` moves. Use it when the user asks for it and the change holds no code, such as a vendored skill or an agent guide: the commit hooks have already formatted and linted those files. In the Testing section of the record, say that the gate did not run.

`pnpm land --no-ci` lands without the CI check of the record PR: the land does not wait for it, and the landing workflow does not require it. The check still starts on the PR, but `main` moves without its result. Use it only when the user asks for it, with or without `--no-verify`. `--after-ci` lands only on a passed check, so it cannot go with `--no-ci`. In the Testing section of the record, say which checks did not run.

A plain `pnpm verify` runs both halves on your machine. Run it, or the tests of the package you changed, before you land: a CI failure costs a round trip of minutes.

## A failed land

The worktree stays on its branch with a clean tree. The error that `pnpm land` prints names the failed step, the state of the branch in its `note` lines, and the next action in its `help` line. Do the action that the `help` line names.

## The full End-to-end Run

The nightly workflow (`.github/workflows/nightly-e2e.yml`) runs the full End-to-end Run on `main` each night and on dispatch, and `pnpm verify --release` runs it before a release. Before you land a change to shared startup or lifecycle behavior, run `pnpm e2e` yourself (root `AGENTS.md`, Testing).

Each case that fails in the nightly has one open issue in `aidenlx/zotlit-repo`: a failure opens it with the `needs-triage` label, and a repeat adds a comment. The issue keeps its case when you rename it, so keep the HTML comment at the end of its body. A run with no failed case (a run that ended early), or with more failed cases than `MAX_CASE_ISSUES` in `packages/scripts/lib/e2e-report.ts`, goes to the open issue whose title is exactly `End-to-end Run fails on main` (the newest one, if several are open), with a log excerpt. Close an issue when its cause is fixed; the next failure opens a new one. To find the change that caused a failure, compare the tip that the report names with the tip of the last nightly that passed.

## Releases

`pnpm release` lands the version commit of a release, beta or stable, through the same queue onto `main`, with the release gate; the maintainer runs it. See `CONTRIBUTING.md` "Releasing".

Before a release, the maintainer reads the record PRs merged since the last release tag of the product, and their unchecked open points. Give `--match` the tag pattern of the product from `CONTRIBUTING.md` "Releasing" (`'[0-9]*'`, `'zt-*'`, `'reader-*'`, `'resources-*'`):

```sh
since=$(git log -1 --format=%cI "$(git describe --tags --abbrev=0 --match '[0-9]*' origin/main)")
gh pr list --state merged --base main --limit 200 --search "merged:>$since" \
  --json url,title,body --jq '.[] | select(.body | test("(?m)^## Open points\\r?$"))
    | "\(.url) \(.title)",
      (.body | capture("(?ms)^## Open points\\r?\\n(?<s>.*?)(^## |\\z)").s
        | split("\n")[] | select(test("^\\s*- \\[ \\]")) | "  \(.)")'
```

## Commits

Every commit that reaches `main` has a [Conventional Commits](https://www.conventionalcommits.org/) subject: `<type>(<scope>): <description>`. The type is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. The scope and a `!` before the colon are optional. Write a revert as `revert: <subject of the reverted commit>`.

For a default land, the record title is the subject of the squash commit; write the reason and checks in the record. For `--no-squash`, give each commit such a subject and a body that records the reason and checks. `land` checks the subjects before it waits for the Land Turn, and the landing workflow checks them again.
