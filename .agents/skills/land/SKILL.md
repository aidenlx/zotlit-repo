---
name: land
description: "Use when a change is done and should reach main, when a land fails, or when writing the commits a land carries."
---

## Land

A change reaches `main`, the one long-lived branch, only through `pnpm land`. One land at a time per machine holds the Land Turn, in the order the lands started, and in that turn it:

```text
fetch origin/main ─▶ rebase the branch onto it ─▶ pnpm verify --local
   ▲   ─▶ record: push the branch, open or update its record PR
   │   ─▶ ci: wait for the CI check of the PR head ─▶ push HEAD to main
   │                                                      │ main moved
   └──────────────────────────────────────────────────────┘
then: move the local main, read the PR state; when GitHub shows it as merged,
      delete the task branch on origin; start the End-to-end Run of the new tip
      in the background
```

1. Commit every change on the task branch. `land` refuses a tree with uncommitted or untracked files.
2. Write the record file in the task worktree (see [The record file](#the-record-file)). `land` refuses a land without it before it pushes anything.
3. Run `pnpm land` from the task worktree, in the background: the gate and the CI wait take minutes, and the wait for the turn can take longer. Wait for it to exit.
4. Read the result:
   - **Exit 0:** landed. The output names the record PR and the pushed commit. When it says that the PR does not show as merged, the task branch stays on origin and the PR stays open: report this on the ticket. Close the ticket as `docs/agents/issue-tracker.md` describes, then remove the worktree with `wt remove <branch>`.
   - **Exit 1:** a step failed. The output names the step and the path of the full log; read the log.
   - **Exit 75:** the turn did not come within the wait (1 h by default, `--wait <duration>`). Report it as blocked by the land that `pnpm land status` names, not as a failure.

## The record file

The record PR holds the record of the change, so the maintainer reads the change and its evidence on GitHub. Its title and body come from the record file, in the git-ignored scratch folder of the task worktree, so the tree stays clean. `pnpm land --help` names the path of the file, its title line, and its sections; `land` refuses a record that lacks one of them.

- Fill the sections as `implement-spec` step 7 describes, also for a land outside a spec. The Review section holds finding lines (`code-review` → Finding lines).
- Put `Closes #<n>` for each ticket of the change in the Summary. GitHub closes the tickets when the PR shows as merged.
- The repository is public, so the PR is public: write paths relative to the repository, never local absolute paths or scratch log locations.

A land of a branch that has an open record PR, such as a land again after a failure, updates that PR from the record file. Edit the record file before you land again.

## The CI wait

The local gate is `pnpm verify --local`: Format, Generated artifacts, Lint, Typecheck and Snapshot size. The tests of the affected packages and the bundle budget run in CI on the record PR (`.github/workflows/record-pr.yml`, `pnpm verify --pr`). The land holds its Land Turn while CI runs, and prints the state of the check at each read (`queued`, `in progress`, then the result and how long the job waited for a runner). It pushes `main` only when the check passes. `pnpm land --help` names the check and how long the land waits for it.

A plain `pnpm verify` runs both halves on your machine. Run it, or the tests of the package you changed, before you land: a CI failure costs a round trip of minutes.

## A failed land

The worktree stays on its branch with a clean tree.

| Step        | State of the branch                         | Next action                                                                                  |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `preflight` | as it was                                   | Commit the changes, switch to the task branch, complete the record file, or fix the `gh` login. |
| `rebase`    | as it was                                   | `git rebase origin/main`, resolve the conflicts, run the affected tests, commit, land again. |
| `gate`      | rebased onto the fetched `origin/main`      | Fix the failure on this branch, commit, land again. The tail of the gate output is printed.  |
| `record`    | rebased; pushed to origin; `main` unchanged | Read the `gh` error in the message. Fix its cause, then land again.                          |
| `ci`        | rebased; pushed to origin; `main` unchanged | Open the job link in the message and read its log. Fix the failure on this branch, run the failed tests locally, commit, land again. A land again with no new commit runs the failed check again. When no check showed, check that the workflow ran on the PR. |
| `push`      | rebased; `main` moved in each attempt       | Land again.                                                                                  |
| `lease`     | as the step left it; the step went silent   | Land again; when it repeats, report the step and the last progress that the message names.   |

## After the land

The End-to-end Run of the new tip runs detached, in its own checkout, under a Desktop Slot. A later run takes the newest tip. All failures go to one issue in `aidenlx/zotlit-repo`: the open issue whose title is exactly `End-to-end Run fails on main` (the newest one, if several are open). A failure adds a comment to it with the commit range since the last passing tip, the failed cases, and a log excerpt. When no such issue is open, the failure opens it with the `needs-triage` label. The first pass after a failure adds a comment that says so and leaves the issue open: close it when the cause is fixed, and the next failure opens a new one. When the desktop cannot paint a window (the lid closed without an external display, a sleeping display, or a locked screen) before the run or at the end of a failed run, the tip is recorded as `not-run` with the machine state, no issue opens, and the next land's run covers the newer tip. `pnpm land status` lists the last runs with their outcome; the results are in `runs.jsonl` under the state directory that `pnpm land --help` prints.

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

The commits of the branch land on `main` as they are, after the rebase. Give each commit a subject that names the change, and a body that says why it was made and how it was checked: the tests run, the commands, the walkthrough in the running app.
