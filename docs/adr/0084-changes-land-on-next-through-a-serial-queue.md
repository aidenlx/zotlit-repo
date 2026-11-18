---
status: accepted
---

# Changes land on next through a serial queue

Amends [ADR 0076](0076-checks-run-before-push-and-ci-runs-only-to-release.md): the quality gate moves from the pre-push hook into `pnpm land`, and pull requests into `next` go away. Amends [ADR 0021](0021-next-is-the-primary-branch.md): a change reaches `next` through `pnpm land`, and `main` takes a stable graduation as a fast-forward to a commit of `next` through `pnpm land --to main`.

`pnpm land` is the only path that pushes to `next`. An agent finishes its change on a task branch in its own worktree and runs `pnpm land` there. Lands on one machine wait in one first-come-first-served queue, and the land that holds the turn does all of this before the next land starts:

```text
task worktree, clean tree
  └─ pnpm land
       wait in the Land Queue of next (FIFO, one turn, Lease 1 h, wait 1 h → exit 75)
       └─ the Land Turn
            fetch origin/next
            rebase the branch onto it ── conflict? abort, branch as it was, fail
            pnpm verify on the rebased tree ── fail? push nothing, branch stays rebased
            git push origin HEAD:next ── next moved? again from the fetch (3 attempts)
            move the local next; delete the task branch on origin
       after the turn: request the End-to-end Run of the new tip, detached
```

- **One admission mechanism.** The Land Queue is an `Admission` of the Desktop Slot machinery (ADR 0077, ADR 0078): one slot, no Memory Gate, its own state directory beside the desktop state. The FIFO tickets, the takeover of a dead holder, the Lease and the Admission Deadline are the same code. Each target branch has its own queue, so a release gate of `main` does not hold up lands into `next`.
- **The gate runs once, on what is pushed.** It runs in the turn, on the rebased tree, so it catches a change that merges cleanly but fails with the newest `next`. Lands no longer run the gate in parallel, so one gate has the machine.
- **The wait is recorded.** Each land appends its wait, outcome, failed step and attempt count to `waits.jsonl` in the shared state directory.
- **The hook enforces the path.** The pre-push hook refuses a push to `next` or `main` unless it carries the token of a live Land Turn; in an agent session (`AI_AGENT`, `CLAUDE_CODE`, `CLAUDECODE`, `CODEX_SANDBOX`, `CODEX_THREAD_ID`) it refuses every other push. A person's push of a task branch runs no gate. The AI-attribution check stays in the same hook command.
- **End-to-end Run after each land.** A detached runner waits in an End-to-end Queue of its own, then runs the newest requested tip in its own checkout under a Desktop Slot. Runs coalesce: a runner that waited takes the newest tip. A failure opens one `needs-triage` issue in `aidenlx/zotlit-repo` with the commit range since the last passing tip and a log excerpt, and reverts nothing. A machine with no reachable desktop Obsidian records a skip.
- **Graduation.** `pnpm land --to main`, from a checked-out commit of `next`, checks that the commit is in `next` and that `main` fast-forwards to it, runs `pnpm verify --release`, and pushes it to `main`.

## Why

Pull requests into `next` had no checks (ADR 0076), so each was a merge step with no gate on the merged result. Many agents ran the full gate at once on one machine, and each gate ran on a branch that had not yet met the newest `next`. A serial queue in front of `next` runs one gate per change, on the tree that is pushed, and hands a failure back to the agent that made the change while its session still has the context.

## Consequences

- The tracker and source repository is `aidenlx/zotlit-repo`. Stacked pull requests go away: a large change lands as a series of task branches, one land each.
- A land blocks its caller for the gate, a few minutes; agents run it in the background. The Land Queue serializes lands on one machine only. Lands from two machines meet at the push: the later one finds `next` moved, fetches, rebases and gates again within its turn.
- `git push --no-verify` still skips the hook. The hook guards against mistakes; GitHub rulesets on `next` and `main` are the server-side backstop.
- The lockfile rule of the old hook (a push that changes `pnpm-lock.yaml` or `pnpm-workspace.yaml` runs the full gate) becomes part of `land`: `land` has no way to skip the gate.
- `pnpm release` still opens release pull requests; the publish pipeline is a later step.
- Lefthook hands stdin to one command at most, so the pre-push hook is one command that makes both the push and the attribution checks. Before this change the hook had two stdin commands, and the attribution check of pushed commits read an empty stdin.

## Considered options

- **Keep pull requests into next, with the gate in the pre-push hook.** The gate checks the branch, not the merged result, and N agents run N gates at once.
- **A queue of its own (a lock file or a daemon).** A second admission mechanism would need its own stale-holder recovery, order and deadline, which the Desktop Queue already has and tests.
- **The End-to-end Run inside the land.** It takes most of the release gate's time; in each land it would cut throughput to a few lands an hour. After the land it still finds a regression within one run, and the issue names the range.
- **Revert on an End-to-end failure.** A revert of a range can remove good changes and needs its own land; an issue hands the decision to a person or a fixing agent.
