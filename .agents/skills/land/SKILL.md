---
name: land
description: "Use when a change is done and should reach next, when a land fails, or when writing the commits a land carries."
---

## Land

A change reaches `next` only through `pnpm land`. One land at a time per machine holds the Land Turn, in the order the lands started, and in that turn it:

```text
fetch origin/next ─▶ rebase the branch onto it ─▶ pnpm verify ─▶ push HEAD to next
   ▲                                                               │ next moved
   └───────────────────────────────────────────────────────────────┘
then: move the local next, delete the task branch on origin,
      start the End-to-end Run of the new tip in the background
```

1. Commit every change on the task branch. `land` refuses a tree with uncommitted or untracked files.
2. Run `pnpm land` from the task worktree, in the background: the gate takes minutes, and the wait for the turn can take longer. Wait for it to exit.
3. Read the result:
   - **Exit 0:** landed. The last lines name the pushed commit. Close the ticket as `docs/agents/issue-tracker.md` describes, then remove the worktree with `wt remove <branch>`.
   - **Exit 1:** a step failed. The output names the step and the path of the full log; read the log.
   - **Exit 75:** the turn did not come within the wait (1 h by default, `--wait <duration>`). Report it as blocked by the land that `pnpm land status` names, not as a failure.

## A failed land

The worktree stays on its branch with a clean tree.

| Step        | State of the branch                         | Next action                                                                                  |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `preflight` | as it was                                   | Commit the changes, or switch to the task branch.                                            |
| `rebase`    | as it was                                   | `git rebase origin/next`, resolve the conflicts, run the affected tests, commit, land again. |
| `gate`      | rebased onto the fetched `origin/next`      | Fix the failure on this branch, commit, land again. The tail of the gate output is printed.  |
| `push`      | rebased; `next` moved in each attempt       | Land again.                                                                                  |
| `lease`     | as the step left it; the land took too long | Land again; when it repeats, report the step that runs past the Lease.                       |

## After the land

The End-to-end Run of the new tip runs detached, in its own checkout, under a Desktop Slot. A later run takes the newest tip. A failure opens one `needs-triage` issue in `aidenlx/zotlit-repo` with the commit range since the last passing tip and a log excerpt. The results are in `runs.jsonl` under the state directory that `pnpm land --help` prints.

## Graduate next to main

Check out the commit of `next` to graduate (`git switch --detach origin/next`) and run `pnpm land --to main`. It checks that `main` can fast-forward to that commit, runs `pnpm verify --release` (the full End-to-end Run included, so desktop Obsidian must run), and pushes it to `main`.

## Commits

The commits of the branch land on `next` as they are, after the rebase. Give each commit a subject that names the change, and a body that says why it was made and how it was checked: the tests run, the commands, the walkthrough in the running app.
