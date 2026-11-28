# A long Codex run

A run that lasts hours, loops toward a target, or measures on a shared machine or device. The lead stays the **monitor**: Codex leads the work, and the lead keeps it running, checks its claims, and decides what it cannot.

## Add to the spec

- **Goal and stop rule.** State the outcome and its targets. Codex stops for a decision that only the lead or the user can make, and for nothing else: after each result it takes the next item.
- **`PROGRESS.md`** in the task's scratch folder, kept current, with a `State now` section at the top (what runs, what is kept, what is next) and a `Needs the lead` section. A question goes into `Needs the lead` while Codex continues with work that does not depend on it.
- **A judge Codex did not write**, for optimization work: cases, checks and held-out inputs from another author. A kept change states the work it removed, and it must hold on the held-out inputs.
- **A time limit on every external call** (a device, a server, a journey), with the outcome of a timeout recorded as a result.

## Watch the run

The exit notice can arrive hours late. Check on a fixed interval, with the harness's wake-up timer where it has one:

```sh
pgrep -fl "codex exec" ; stat -f %Sm <scratch>/PROGRESS.md <scratch>/codex-last.md
```

No process and a fresh `codex-last.md` means the run ended: read it now. A process and a stale `PROGRESS.md` means read the tail of the log.

## Before you stop a run

Read first: `git log` of the branch, `State now`, and what is in flight (a timed run, a device session). The thing you want is often done already, and a stop loses the in-flight work and the session's working state.

- A change that can wait goes into `NEXT-STOP.md`; give it with the next resume.
- Stop only when the present work is wrong or wasted without the change. Stop the process, then release every lock that the run held.

## Resume

Resume the same session with a new `RESUME-<n>.md`: what happened, what changed in the worktree, what the stop killed, the decisions, and where to continue. The spec stays as written; each note adds to it.

## When Codex stops to ask

1. **Check the claim.** "The device is locked" or "the test fails" is a claim: reproduce it before you pass it on.
2. **Decide what is yours.** A choice that a revert undoes gets a provisional decision in the resume note, recorded for the user. A product decision goes to the user with Codex's measured options.
3. **Resume at once** with the work that does not depend on the open decision.

## Report to the user

Read how a number is produced before you report it: the loop, what it cancels, where the clock starts and ends. Say what it measures and what it leaves out.
