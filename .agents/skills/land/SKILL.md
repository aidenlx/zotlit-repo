---
name: land
description: "Use when a change is done and should reach main, when a land fails, or when writing the commits a land carries."
---

## Land

A change reaches `main`, the one long-lived branch, only through `pnpm land`. One land at a time per machine holds the Land Turn, in the order the lands started, and in that turn it:

```text
fetch origin/main ─▶ rebase the branch onto it ─▶ pnpm verify
   ▲   ─▶ record: push the branch, open or update its record PR ─▶ push HEAD to main
   │                                                                  │ main moved
   └──────────────────────────────────────────────────────────────────┘
then: move the local main, read the PR state; when GitHub shows it as merged,
      delete the task branch on origin; start the End-to-end Run of the new tip
      in the background
```

1. Commit every change on the task branch. `land` refuses a tree with uncommitted or untracked files.
2. Write the record file at `.scratch/land-record.md` in the task worktree (see [The record file](#the-record-file)). `land` refuses a land without it before it pushes anything.
3. Run `pnpm land` from the task worktree, in the background: the gate takes minutes, and the wait for the turn can take longer. Wait for it to exit.
4. Read the result:
   - **Exit 0:** landed. The output names the record PR and the pushed commit. When it says that the PR does not show as merged, the task branch stays on origin and the PR stays open: report this on the ticket. Close the ticket as `docs/agents/issue-tracker.md` describes, then remove the worktree with `wt remove <branch>`.
   - **Exit 1:** a step failed. The output names the step and the path of the full log; read the log.
   - **Exit 75:** the turn did not come within the wait (1 h by default, `--wait <duration>`). Report it as blocked by the land that `pnpm land status` names, not as a failure.

## The record file

The record PR holds the record of the change, so the maintainer reads the change and its evidence on GitHub. Its body is the record file, `.scratch/land-record.md` at the root of the task worktree. The folder is git-ignored, so the tree stays clean.

- The first line is `# <title>`: the title of the PR.
- The rest is the PR body. It has these `##` sections: Summary, Testing, Risk, How to revert, Review, Open points, e2e. `land` refuses a record without one of them, or without the title line.
- Put `Closes #<n>` for each ticket of the change in the Summary. GitHub closes the tickets when the PR shows as merged.
- The repository is public, so the PR is public: write paths relative to the repository, never local absolute paths or scratch log locations.

A land of a branch that has an open record PR, such as a land again after a failure, updates that PR from the record file. Edit the record file before you land again.

## A failed land

The worktree stays on its branch with a clean tree.

| Step        | State of the branch                         | Next action                                                                                  |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `preflight` | as it was                                   | Commit the changes, switch to the task branch, or write or complete the record file.         |
| `rebase`    | as it was                                   | `git rebase origin/main`, resolve the conflicts, run the affected tests, commit, land again. |
| `gate`      | rebased onto the fetched `origin/main`      | Fix the failure on this branch, commit, land again. The tail of the gate output is printed.  |
| `record`    | rebased; pushed to origin; `main` unchanged | Read the `gh` error in the message, such as an expired login. Fix it, then land again.      |
| `push`      | rebased; `main` moved in each attempt       | Land again.                                                                                  |
| `lease`     | as the step left it; the step went silent   | Land again; when it repeats, report the step and the last progress that the message names.   |

## After the land

The End-to-end Run of the new tip runs detached, in its own checkout, under a Desktop Slot. A later run takes the newest tip. All failures go to one issue in `aidenlx/zotlit-repo`: the open issue whose title is exactly `End-to-end Run fails on main` (the newest one, if several are open). A failure adds a comment to it with the commit range since the last passing tip, the failed cases, and a log excerpt. When no such issue is open, the failure opens it with the `needs-triage` label. The first pass after a failure adds a comment that says so and leaves the issue open: close it when the cause is fixed, and the next failure opens a new one. When the desktop cannot paint a window (the lid closed without an external display, a sleeping display, or a locked screen) before the run or at the end of a failed run, the tip is recorded as `not-run` with the machine state, no issue opens, and the next land's run covers the newer tip. `pnpm land status` lists the last runs with their outcome; the results are in `runs.jsonl` under the state directory that `pnpm land --help` prints.

## Releases

`pnpm release` lands the version commit of a release, beta or stable, through the same queue onto `main`, with the release gate; the maintainer runs it. See `CONTRIBUTING.md` "Releasing".

## Commits

The commits of the branch land on `main` as they are, after the rebase. Give each commit a subject that names the change, and a body that says why it was made and how it was checked: the tests run, the commands, the walkthrough in the running app.
