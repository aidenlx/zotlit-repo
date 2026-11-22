#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  DESKTOP_DIR_ENV,
  desktopStateDir,
  MEMORY_GATE_ENV,
} from "@zotlit/config/memory-gate";

import { DESKTOP_PAINT_ENV } from "#desktop-paint";
import {
  acquireDesktopSlotOrExit,
  ADMISSION_DEADLINE_MS,
  DESKTOP_SLOT_ENV,
  DESKTOP_WAIT_ENV,
  describeHolder,
  describeLeaseEnd,
  describeWaiters,
  EVICTION_GRACE_MS,
  evictDesktopSlot,
  EXIT_ADMISSION_BLOCKED,
  EXIT_LEASE_ENDED,
  formatDuration,
  KILL_AFTER_MS,
  MAX_LEASE_MS,
  NOTICE_MS,
  parseDuration,
  readDesktopSlotStatus,
  recordDesktopSlotGroup,
  removedLeaseFlag,
  SILENCE_LIMIT_MS,
} from "#desktop-slot";

const EXIT_USAGE = 2;

const epilogue = `Host tools share one Desktop Slot across all clones, worktrees, and sessions. A holder joins the Desktop Queue in first-in, first-out order and takes an Exclusive Hold when the slot is free. The holder then passes the Memory Gate, and its Lease starts. The End-to-end Run uses its own container and takes no Desktop Slot.

Paint Check: before it joins the queue, a holder asks macOS whether the desktop can paint a window (an awake display and an unlocked session). An automated host run (host Vitest, measure:startup, measure:query, a docs walk) does not start without one and exits ${EXIT_ADMISSION_BLOCKED}; a manual hold (run, pnpm fixture open|dev) starts with a warning. While a hold lasts, caffeinate -d -i keeps the display and the system awake.

Exit codes:
  ${EXIT_ADMISSION_BLOCKED}   the Admission Deadline passed; blocked at admission, not a failure.
       The message names every holder and the waiters ahead.
  ${EXIT_LEASE_ENDED}   the Lease ended; run ended the command's process group.
  ${EXIT_USAGE}    usage error.
  run otherwise exits with the command's code, or 128 plus the signal number.

Admission Deadline: ${formatDuration(ADMISSION_DEADLINE_MS)} by default, for the queue, a slot, and the Memory Gate together.
Lease of an automated holder: each sign of progress (a test case or hook of host Vitest, a measurement step, output of a Land Turn's gate) moves its end to now plus a silence limit: host Vitest and measure:startup ${formatDuration(SILENCE_LIMIT_MS.e2e)}; a docs walk ${formatDuration(SILENCE_LIMIT_MS.docsWalk)}; measure:query ${formatDuration(SILENCE_LIMIT_MS.measureQuery)}; a Land Turn ${formatDuration(SILENCE_LIMIT_MS.childOutput)}. A healthy run is never ended; a silent one ends with exit ${EXIT_LEASE_ENDED} and says how long it was silent and what its last progress was. No automated holder keeps a slot more than ${formatDuration(MAX_LEASE_MS)} after admission.
Lease of a manual hold (run, pnpm fixture open|dev): no end while no run waits. When the head waiter cannot get the Desktop Slot because a manual holder has it, that holder gets ${formatDuration(NOTICE_MS)} of notice: it prints who waits and when it ends, then ends its command's process group with exit ${EXIT_LEASE_ENDED}. If no run waits at the end of the notice, the hold goes on. An automated holder never yields.
A holder that outlives its Lease end by ${formatDuration(EVICTION_GRACE_MS)} is evicted by the head waiter: SIGTERM to its process group, SIGKILL after ${formatDuration(KILL_AFTER_MS)}.
Durations: 300ms, 90s, 20m, 2h.

Environment:
  ${DESKTOP_SLOT_ENV}     the holder's token; a ZotLit tool the command starts reuses the hold, inside its Lease
  ${DESKTOP_WAIT_ENV}     the Admission Deadline of an in-process holder (host Vitest, host measurements, and Run Container memory admission)
  ${DESKTOP_DIR_ENV}      the state directory (now ${desktopStateDir()})
  ${MEMORY_GATE_ENV}=off  skip the Memory Gate
  ${DESKTOP_PAINT_ENV}=off  skip the Paint Check and the display assertion`;

function usage(message: string): never {
  console.error(`desktop-slot: ${message}`);
  process.exit(EXIT_USAGE);
}

function duration(text: string): number {
  try {
    return parseDuration(text);
  } catch (error) {
    return usage((error as Error).message);
  }
}

async function run(command: string[], wait?: string) {
  if (command.length === 0) usage("name the command after --.");
  let leaseOver = false;
  const slot = await acquireDesktopSlotOrExit({
    command: command.join(" "),
    manual: true,
    waitMs: wait === undefined ? undefined : duration(wait),
    signals: false,
    onLeaseEnd: (owner) => {
      leaseOver = true;
      console.error(
        `Desktop Slot: ${describeLeaseEnd(owner, Temporal.Now.instant().epochMilliseconds)}; ending the command's process group (exit ${EXIT_LEASE_ENDED}).`,
      );
      signalGroup("SIGTERM");
      setTimeout(() => signalGroup("SIGKILL"), KILL_AFTER_MS).unref();
    },
  });

  const posix = process.platform !== "win32";
  const child = spawn(command[0]!, command.slice(1), {
    stdio: "inherit",
    detached: posix,
  });
  function signalGroup(signal: NodeJS.Signals) {
    try {
      if (posix && child.pid !== undefined) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The group is gone.
    }
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => signalGroup(signal));
  }
  child.on("error", (error) => {
    console.error(error.message);
    slot.release();
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    void (async () => {
      if (leaseOver) {
        const until = Temporal.Now.instant().add({
          milliseconds: KILL_AFTER_MS,
        });
        while (
          posix &&
          groupAlive(child.pid!) &&
          Temporal.Instant.compare(Temporal.Now.instant(), until) < 0
        ) {
          await delay(100);
        }
        signalGroup("SIGKILL");
      }
      slot.release();
      process.exit(
        leaseOver
          ? EXIT_LEASE_ENDED
          : (code ?? 128 + (signal ? constants.signals[signal] : 0)),
      );
    })();
  });
  if (posix && child.pid !== undefined) {
    await recordDesktopSlotGroup(slot.owner.token, child.pid);
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function status(json: boolean) {
  const now = Temporal.Now.instant().epochMilliseconds;
  const state = await readDesktopSlotStatus();
  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  const { slots, waiters } = state;
  for (const { index, holder } of slots) {
    console.log(
      `Slot ${index + 1}: ${holder ? `${describeHolder(holder, now)}${holder.alive ? "" : " (process gone)"}` : "free"}`,
    );
  }
  console.log(
    waiters.length > 0
      ? `Desktop Queue:\n${describeWaiters(waiters)}`
      : "Desktop Queue: empty.",
  );
  console.log(
    `Memory Gate: last admitted start ${state.lastGateStart ?? "none recorded"}.`,
  );
}

const removed = removedLeaseFlag(hideBin(process.argv));
if (removed) usage(removed);
if (hideBin(process.argv)[0] === "extend") {
  usage(
    `extend is gone: no Lease needs it. An automated holder renews its Lease on each sign of progress, and a manual hold has no end until a run waits for the slot. To give the slot back sooner, end the command, or run pnpm desktop-slot evict <token|pid>.`,
  );
}

await yargs(hideBin(process.argv))
  .scriptName("desktop-slot")
  .usage("pnpm desktop-slot <command>")
  .command(
    "run",
    `hold a Desktop Slot around a command, as a manual hold that yields with ${formatDuration(NOTICE_MS)} of notice when a run waits: run [--wait <dur>] -- <command...>`,
    (y) =>
      y
        .option("wait", {
          type: "string",
          describe: `the Admission Deadline (default ${formatDuration(ADMISSION_DEADLINE_MS)})`,
        })
        .option("exclusive", {
          type: "boolean",
          default: false,
          describe:
            "compatibility option; every Desktop Slot hold is exclusive",
        }),
    async (argv) => {
      const command = (argv["--"] as unknown[] | undefined) ?? [];
      await run(command.map(String), argv.wait);
    },
  )
  .command(
    "status",
    "show the Desktop Slot with its holder and worktree; for an automated holder its last progress, silence limit, and Lease end; for a manual hold whether it is on notice; then the Desktop Queue and the Memory Gate's last start",
    (y) =>
      y.option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON",
      }),
    async (argv) => {
      await status(argv.json);
    },
  )
  .command(
    "evict <holder>",
    "end the holder named by its token or pid, as an overdue holder is evicted",
    (y) => y.positional("holder", { type: "string", demandOption: true }),
    async (argv) => {
      try {
        const owner = await evictDesktopSlot({ target: argv.holder });
        console.log(
          `Desktop Slot: evicted pid ${owner.pid} (${owner.command}).`,
        );
      } catch (error) {
        console.error((error as Error).message);
        process.exit(1);
      }
    },
  )
  .demandCommand(1)
  .parserConfiguration({ "populate--": true })
  .epilogue(epilogue)
  .strict()
  .version(false)
  .wrap(null)
  .fail((message, error) => {
    if (error) throw error;
    usage(message);
  })
  .parseAsync();
