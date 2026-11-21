# Fixture

The generated, disposable test environment for ZotLit — Zotero data, a Zotero
profile, and an Obsidian vault built from one committed spec — and the
vocabulary around building and consuming it.

## Language

**The Fixture**:
The one generated test environment: a Zotero data directory, a Zotero profile,
and an Obsidian vault, all derived from the Fixture Spec and disposable.
_Avoid_: acceptance fixture, standard fixture, test fixture

**Fixture Spec**:
The committed, reviewable description of the Fixture's semantic content — the
single source of truth every build reproduces.
_Avoid_: fixture data, seed data

**Fixture Vault**:
The generated Obsidian vault whose Literature Notes reference only items that
exist in the Fixture's Zotero data.
_Avoid_: zt-vault, test vault

**Development Vault**:
The per-worktree Obsidian vault seeded from the Fixture Vault for manual
development and Paired Runs.
_Avoid_: dev vault, test vault

**Host Vault**:
An open Obsidian vault that provides the application access needed to prepare
a Development Vault.

**Scope Case**:
A named, saved Library Scope state (all, available, partial, unavailable).

**Vault Case**:
A named, saved Fixture Vault state beside the Library Scope — settings file,
notes, Profiles, and template files (configured, fresh, upgrader).
_Avoid_: vault preset, vault scenario

**End-to-end Run**:
The plugin running in a real Obsidian window, reading the Fixture's Zotero
data directory from disk.
_Avoid_: acceptance run (for the automated flavor), e2e test (for the manual flavor)

**Paired Zotero**:
A real Zotero 10 instance — the live counterpart of the Fixture Vault during
development.
_Avoid_: test Zotero, dev Zotero, fixture instance

**Paired Run**:
A session with Paired Zotero and a vault open together on the same Fixture: a
Development Vault for manual work, or a vault the End-to-end Run opens and
disposes.
_Avoid_: smoke run, manual End-to-end Run

**Stress Build**:
An on-demand Fixture build scaled to a large synthetic item count for
performance testing.
_Avoid_: perf fixture, large fixture

## Desktop admission

**Desktop Slot**:
One of a few places to drive the developer's one desktop Obsidian app, shared
across every clone, worktree, and session of the user on this machine. Each
holder drives its own vault, and a worktree holds at most one slot at a time. A
Paired Zotero joins a hold only when the hold opens a vault in that app;
Zotero-only work takes no slot.
_Avoid_: desktop lock, desktop mutex

**Exclusive Hold**:
A hold of every Desktop Slot at once, for work that needs the whole app to
itself, such as timing a query or capturing the screen.
_Avoid_: global lock, full lock

**Desktop Queue**:
The ordered line of waiters for a Desktop Slot; the waiter at its head is the
only one that may take a slot when one frees.
_Avoid_: lock waiters, wait list

**Lease**:
What keeps a hung or forgotten holder from keeping its Desktop Slot forever.
An automated holder's Lease is a silence limit: each sign of progress moves its
end to now plus that limit, under a cap on total time. A manual hold's Lease
has no end until a run waits for its slot; it then ends after a notice. A
holder whose Lease ends loses the slot.
_Avoid_: timeout, hold limit, duration

**Silence Limit**:
How long an automated holder may go without a sign of progress, such as a test
case that starts or a line of a child command's output, before its Lease ends.
Each kind of holder has one, longer than the longest quiet step of its healthy
runs.
_Avoid_: idle timeout, heartbeat timeout

**Notice**:
The period a manual hold keeps its Desktop Slot after a waiter that needs the
slot asks for it; the hold prints who waits and when it ends, then ends.
_Avoid_: preemption warning, grace period

**Paint Check**:
The admission check that the desktop can paint a window now: one display is
awake and the user's session is not locked. A run that needs a painted window
does not start without it, and is blocked at admission, not failed.
_Avoid_: display check, screen check

**Admission Deadline**:
How long a waiter will wait, at the Desktop Queue and the Memory Gate combined,
before giving up and reporting who is ahead of it.
_Avoid_: lock timeout, wait timeout

**Memory Gate**:
The machine-wide check that admits a heavy run (a test invocation or an
End-to-end Run) in arrival order while the OS reports that memory can grow. Under memory pressure a run waits only while another admitted run is still running; with none running it starts with a warning. An admitted run counts as running until its process exits.
_Avoid_: memory lock, memory slot

## Landing

**Trunk**:
`main`, the one long-lived branch of the source repository. Every change and
every Version Commit lands on it. An agent session pushes a task branch to
the source repository only through a land, which deletes it once its Record
PR shows as merged; a person may push one to share it.
_Avoid_: next, primary branch, stable branch

**Land**:
The one way a change reaches the Trunk: rebase the task branch onto the newest
`main`, pass the local quality gate on the rebased tree, open or update the
Record PR, wait for its CI check, and push the tree to `main` as a
fast-forward. GitHub then shows the
Record PR as merged; no one merges it.
_Avoid_: merge, PR merge, graduation

**Record PR**:
The pull request that a land opens from the record file of the task branch,
so that the maintainer reads the change and its evidence on GitHub. It is a
record, not a review gate: the land pushes `main` to its head.
_Avoid_: review PR, merge request

**Land Queue**:
The machine-wide, first-come-first-served line of lands onto the Trunk. It is
a Desktop Queue with one slot and no Memory Gate, so a land that dies leaves a
turn the next land takes over.
_Avoid_: merge queue, land lock

**Land Turn**:
The one slot of a Land Queue. Its holder alone fetches, rebases, gates, and
pushes, and the pre-push hook lets only a push from the Land Turn reach
`main`.
_Avoid_: land lock, push lock

**End-to-end Queue**:
The line of End-to-end Runs after lands. Each land asks for a run of its new
`main` tip; a run that waited takes the newest tip, so runs coalesce.
_Avoid_: post-merge CI

## Releasing

**Version Commit**:
The commit that `pnpm release` makes and lands: the new app versions, the
lockfile, and for a stable plugin release the root `manifest.json` and
`versions.json`. It reaches the Trunk through the Land Queue, a beta and a
stable release alike; its version picks the line.
_Avoid_: release PR, release branch

**Stable Hotfix**:
A stable patch release built from a local branch cut from the latest stable
release tag, for when the Trunk holds work that must not ship. Its Version
Commit stays off the Trunk: `pnpm release:publish` publishes it from the
machine, and the release tag carries its commits to the source repository.
The fix itself lands on the Trunk separately.
_Avoid_: hotfix land, hotfix branch on the remote

**Publish**:
What `release.yml` does for a product whose version the Trunk gained:
the steps of `pnpm release:publish`, which end with the release tag in the
source repository. Each step skips what an earlier publish of the same
version finished.
_Avoid_: deploy, cut a release

**Shell Commit**:
The commit of a generated shell on the line's branch of the publish
repository (`beta` or `main`), pushed with the version tag in one atomic
push. The tag starts the publish repository's release workflow.
_Avoid_: release commit, publish commit
