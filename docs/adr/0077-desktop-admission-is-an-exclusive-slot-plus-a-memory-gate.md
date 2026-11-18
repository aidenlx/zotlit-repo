---
status: superseded in part by ADR-0078
---

# Desktop admission is an exclusive slot plus a memory gate, with leases

Replaces the desktop lock, `zotlit-desktop.lock` in the git common dir. Exactly one process held it at a time, and a waiter polled for it with no deadline. On 2026-10-21 a manual `pnpm desktop-lock -- sleep 14400` held it for four hours. An agent's e2e baseline run waited until its 600 s tool timeout ran out and reported itself blocked, without knowing how long the hold would last.

Two resources are scarce, and they differ in kind. The developer's one desktop Obsidian app is exclusive, and nothing can measure how much of it is in use. Every End-to-end Run opens its vault in that app, through one CLI socket, and the app-wide state is shared: the vault registry, routing to the focused window, background throttling, and window reloads. Memory, in contrast, is fungible, and the OS reports on it. A Paired Zotero needs no exclusion of its own: each one runs as `--new-instance` with its own profile, data dir, and ports.

So admission has two parts, both per user and machine-wide, under `/tmp/zotlit-desktop-<uid>/`:

```text
pnpm test / verify / e2e / a bare vitest run
  └─ Memory Gate: once per top-level invocation; nested runs skip it
       macOS: pressure level 1 · Windows/Linux: commit ≤ 1.25× physical · 30 s settle

anything that drives the desktop Obsidian
  1. join the Desktop Queue (FIFO; only the head claims)
  2. claim the Desktop Slot (one slot)
  3. pass the Memory Gate
  4. the Lease starts → run → release
  Steps 1–3 share one Admission Deadline (about 9 min by default); on expiry the waiter exits 75 and prints the holder and the queue
```

Each holder enforces its own Lease by ending its process group. When a Lease plus a grace period has passed and the holder is still there, the head waiter evicts it, after checking the pid's start time. Default Leases: `pnpm e2e` 20 min, `e2e:worker` 10 min, `measure:query` 2 h. Manual holds and `pnpm fixture open|dev` must state `--for`, capped at 60 min. A holder may extend its Lease only while nobody is waiting. A child that reuses its parent's hold lives inside the parent's Lease.

## Considered options

- **vatt's memory gate alone** (vattention/vatt-repo#1120, [#1137](https://github.com/aidenlx/zotlit/issues/1137)): it admits runs on OS memory pressure and tracks nothing after admission. That suits a fungible resource. Here, two runs would interleave inside the one Obsidian app.
- **vatt's named slot pools** (vattention/vatt-repo#1119): rename-claimed slots, liveness checked by pid and boot time, and pools claimed in sorted order. The slot shape is kept. The pools had no order, no waiter deadline, and no lease, and those three gaps caused the 2026-10-21 incident.
- **A larger N for Obsidian**: rejected here because the shared app state above seemed to make two runs steal each other's focus, throttling, and reloads. That was wrong: all three are per window. ADR 0078 adopts a pool of N.
- **Only waiters kill an overdue holder**: that kills another session's processes as routine, not as a last resort. A self-enforced Lease ends the run's own process group cleanly. Eviction by a waiter remains only as a backstop for a hung holder.
- **Unordered waiting**: a waiter whose caller has a 600 s timeout can lose every race. FIFO tickets also make the queue visible.
- **A gate per `vitest run`**: about 17 packages run tests in parallel under one `pnpm test`. A 30 s settle per package would serialize them for more than eight minutes.

## Consequences

- Exit code 75 means "blocked at admission", not a test failure. Agents report it with the holder that the message names.
- A manual hold that forgets to release ends on its own at its Lease. A long debugging walk extends its Lease, or joins the queue again.
- One-shot `obsidian-cli.ts` calls take no slot. A slot per call would deadlock behind the very run being debugged. The debugging skills tell the agent to wrap a walk in `pnpm desktop-slot run`.
- The state lives in `/tmp`, so it clears on reboot, and every clone of the repository shares it.

## Memory Gate update (2026-10-27)

The Memory Gate admits waiting runs in arrival order as soon as the OS reports
room. Each admitted run records its start for status reporting. The fixed 30 s
settle window is removed: it delayed runs while pressure was normal, and newer
runs could repeatedly win admission while an older run reached its deadline.
Dead and expired waiters are removed so the queue can advance.

Admission checks pressure before each start. Several runs can start before
the OS reports their full memory use; the gate blocks later starts when the
pressure reading rises. Desktop Slot limits and Leases keep their existing
behavior.

## Memory Gate update (2026-11-18)

Memory pressure limits how many admitted runs go in parallel. Under pressure a
run waits only while another admitted run is still running. When none is, the
pressure comes from other applications, and no wait of ours relieves it, so
the run starts and the gate prints a warning. Before this change such a run
waited until its Admission Deadline each time, and no run could start while
the developer's other applications kept the machine under pressure.

An admitted run now leaves a marker that counts until its process exits; a
reader removes the marker of a process that is gone.

## Docs walk update (2026-11-13)

A docs-walk run that captures or records takes an Exclusive Hold of every
slot, because its shots bring apps to the front and can send real input
(ADR 0078, "Docs walk update"). Other docs-walk runs take one slot. The
queue, the Memory Gate, the Admission Deadline and the Leases are the same
for both. A docs-walk run that captures or records under an outer hold of
one slot fails at once, before its walks open, and names
`pnpm desktop-slot run --exclusive`.

## Lease update (2026-11-18)

The Lease has one purpose: a hung or forgotten holder cannot block other runs
forever. A duration that a person or an agent states in advance does not
measure that, so no hold states one now.

- **An automated holder renews its Lease on progress.** Its Lease is a limit
  on silence, not on total time. Each sign of progress moves the Lease end to
  now plus the silence limit of the holder's kind. For a Vitest run, progress
  is each test file, test case, and hook that starts or ends, and each stage
  of the Paired Run setup. A script such as `measure:query` reports progress
  at its steps. A holder that wraps a child process, such as a Land Turn or
  the End-to-end Run after a land, takes each output of the child as
  progress. A healthy run is never ended. A silent run ends itself with exit
  76 and says how long it was silent and what its last progress was. The
  silence limits are constants of the tools: 12 min for `pnpm e2e`,
  `e2e:worker`, and the desktop runs of `pnpm verify --release` (above the
  longest test or hook timeout of the suite, 10 min, so Vitest reports a hung
  test first); 22 min for a docs walk (its longest test timeout is 20 min);
  12 min for `measure:query` (its longest step is one wait of up to 10 min);
  15 min for a holder that wraps a child (a waiter repeats its message every
  5 min, and the longest test file prints nothing for about 2 min). A cap of
  2 h after admission stays as the last backstop for a run that reports
  progress forever. `ZOTLIT_DESKTOP_LEASE` is gone.
- **A manual hold states no duration and yields on demand.** `pnpm desktop-slot
  run` and `pnpm fixture open|dev` take no `--for`. A manual hold keeps its
  slot while no run waits. When the head waiter cannot get a slot because
  manual holds have them, the manual hold that has held longest gets 5 min of
  notice: it prints who waits and when it ends, then ends its command's
  process group with exit 76. A manual hold that blocks the waiter directly,
  an Exclusive Hold or a hold from the waiter's worktree, gets the notice
  instead; an Exclusive Hold waiter gives notice to every manual hold. The
  notice and the 2 min eviction grace fit inside the default Admission
  Deadline of 9 min, so a waiter with that deadline is admitted. A notice
  that ends while no run waits any more ends nothing. An automated holder
  never yields.
- **`pnpm desktop-slot extend` is gone.** Progress renews an automated
  holder, and a manual hold has no end to extend.
- **The backstop stays.** The head waiter evicts a holder that is alive 2 min
  after its Lease end, which is now the end of the silence limit or of the
  notice.

Two failures caused the change. An agent that started a manual hold had to
guess `--for`: too short, and its session was killed in the middle of the
work; too long, and other runs waited behind an idle hold. A healthy End-to-end
Run of 20 min 22 s was killed at its fixed Lease of 20 min, and the runner
reported a failed run.
