// Desktop admission (ADR 0077, ADR 0078): the Desktop Queue, the pool of N
// Desktop Slots, and the Lease of each holder.
//
// The state lives per user and machine-wide, shared by every clone, in
// `desktopStateDir()`:
//
//   queue/<seq>-<token>.json   one ticket per waiter, in FIFO order
//   queue.seq, queue.lock/     the last sequence number and its mutex
//   slot-<i>/owner.json        the holder of slot i; mkdir of `slot-<i>` is the
//                              atomic claim. An Exclusive Hold has every slot.
//   slot-<i>.takeover/         one waiter at a time removes a dead holder
//   last-start                 the Memory Gate's last admitted start
//
// A holder joins the queue and claims a slot at the head, when one is free and
// no holder from its own worktree has one; an Exclusive Hold claims when every
// slot is free. No waiter overtakes the head. The holder then passes the Memory
// Gate, and only then starts its Lease. One Admission Deadline covers all three
// waits.
//
// The Lease keeps a hung or forgotten holder from blocking other runs forever:
//
//   automated holder   each sign of progress moves the Lease end to now plus
//                      the silence limit of its kind, up to MAX_LEASE_MS
//                      from admission; at the end it exits EXIT_LEASE_ENDED
//   manual hold        no end while no run waits; when the head waiter
//                      cannot claim because manual holds have the slots, the
//                      one that has held longest gets NOTICE_MS of notice,
//                      and at its end the hold ends with EXIT_LEASE_ENDED
//
// The head waiter evicts a holder that outlives its Lease end by the grace
// period.
//
// The same machinery admits other machine-wide serial work through an
// `Admission` of its own: its state directory, slot count, token variable and
// names, and whether a holder passes the Memory Gate. The Land Queue
// (lib/land-queue.ts) is one such admission, with one slot and no gate.

import { regex } from "arkregex";
import { Effect } from "effect";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import {
  admissionWaitMs,
  desktopStateDir,
  EXIT_ADMISSION_BLOCKED,
  lastGateStart,
  MEMORY_GATE_ADMITTED_ENV,
  MemoryGateClosedError,
  passMemoryGate,
} from "@zotlit/config/memory-gate";

export {
  ADMISSION_DEADLINE_MS,
  DESKTOP_WAIT_ENV,
  EXIT_ADMISSION_BLOCKED,
  parseDuration,
} from "@zotlit/config/memory-gate";

/** Holds the holder's token; a child process that inherits it reuses the hold. */
export const DESKTOP_SLOT_ENV = "ZOTLIT_DESKTOP_SLOT";
/** How many Desktop Slots the pool has, as a positive integer. */
export const DESKTOP_SLOTS_ENV = "ZOTLIT_DESKTOP_SLOTS";
export const DEFAULT_DESKTOP_SLOTS = 2;

/**
 * One kind of admission: where its queue and slots live, how many slots it
 * has, and what its holders are called. Desktop admission is
 * {@link DESKTOP_ADMISSION}.
 */
export interface Admission {
  /** The state directory, read at each call so tests can move it. */
  dir: () => string;
  /** The number of slots, read at each call. */
  slots: () => number;
  /** Holds the holder's token; a child process that inherits it reuses the hold. */
  tokenEnv: string;
  /** Whether a holder passes the Memory Gate before its Lease starts. */
  memoryGate: boolean;
  /** The name of one slot in messages, such as "Desktop Slot". */
  slotName: string;
  /** The name of the queue in messages, such as "Desktop Queue". */
  queueName: string;
}

/** The holder's Lease ended before its work did. */
export const EXIT_LEASE_ENDED = 76;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * The silence limit of each kind of automated holder: how long it may go
 * without a sign of progress before its Lease ends. Each limit is longer than
 * the longest quiet step of a healthy run of that kind.
 */
export const SILENCE_LIMIT_MS = {
  /**
   * `pnpm e2e`, `e2e:worker`, and the desktop runs of `pnpm verify --release`.
   * Each test case and hook that starts or ends is progress. The longest
   * timeout of a test or hook in the suite is 10 min, so Vitest reports a hung
   * test as a failure before the Lease ends; the limit ends a hung harness.
   */
  e2e: 12 * MINUTE,
  /** A docs walk: its longest test timeout is 20 min. */
  docsWalk: 22 * MINUTE,
  /**
   * `measure:query`: its longest single step is one wait of up to 10 min for
   * the search index or the Citation Index of a Stress Build.
   */
  measureQuery: 12 * MINUTE,
  /**
   * A holder that wraps child processes, such as the gate of a Land Turn or
   * the End-to-end Run after a land: each output of the child is progress.
   * A waiter in the Desktop Queue repeats its message every 5 min, and the
   * longest test file of the End-to-end Run prints nothing for about 2 min.
   */
  childOutput: 15 * MINUTE,
} as const;
/** The Desktop Slots that drive the desktop Obsidian app (ADR 0077, ADR 0078). */
export const DESKTOP_ADMISSION: Admission = {
  dir: desktopStateDir,
  slots: desktopSlotCount,
  tokenEnv: DESKTOP_SLOT_ENV,
  memoryGate: true,
  slotName: "Desktop Slot",
  queueName: "Desktop Queue",
};

/**
 * How long a manual hold keeps its slot after a waiter gives it notice. With
 * EVICTION_GRACE_MS and KILL_AFTER_MS it fits inside the default Admission
 * Deadline, so a waiter with that deadline is admitted.
 */
export const NOTICE_MS = 5 * MINUTE;
/** No automated holder keeps its slot longer than this after admission. */
export const MAX_LEASE_MS = 2 * HOUR;
/** How long past its Lease a live holder keeps the slot before eviction. */
export const EVICTION_GRACE_MS = 2 * MINUTE;
/** How long a holder has between SIGTERM and SIGKILL. */
export const KILL_AFTER_MS = 10 * SECOND;

const OWNER_FILE = "owner.json";
const QUEUE = "queue";
const QUEUE_SEQ = "queue.seq";
/** A slot directory without an owner record this long is an abandoned claim. */
const ORPHAN_MS = 10 * SECOND;
/** A takeover mutex this old belongs to a waiter that died during takeover. */
const STALE_TAKEOVER_MS = 30 * SECOND;
/** A queue mutex this old belongs to a waiter that died while it enqueued. */
const STALE_QUEUE_LOCK_MS = 10 * SECOND;
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * The number of Desktop Slots: DESKTOP_SLOTS_ENV, else DEFAULT_DESKTOP_SLOTS.
 * @throws {Error} when DESKTOP_SLOTS_ENV is not a positive integer.
 */
export function desktopSlotCount(): number {
  const text = process.env[DESKTOP_SLOTS_ENV];
  if (!text) return DEFAULT_DESKTOP_SLOTS;
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`${DESKTOP_SLOTS_ENV}=${text} is not a positive integer.`);
  }
  return count;
}

export function formatDuration(ms: number): string {
  if (ms >= 2 * HOUR && ms % HOUR === 0) return `${ms / HOUR} h`;
  if (ms % MINUTE === 0) return `${ms / MINUTE} min`;
  if (ms % SECOND === 0) return `${ms / SECOND} s`;
  return `${ms} ms`;
}

/**
 * The message for a manual hold that states `--for`, which a manual hold no
 * longer takes; undefined when the arguments before `--` have none.
 */
export function removedLeaseFlag(args: readonly string[]): string | undefined {
  const own = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
  if (!own.some((arg) => arg === "--for" || arg.startsWith("--for="))) {
    return undefined;
  }
  return `--for is gone: a manual hold states no duration. It keeps its Desktop Slot until its command exits. When a run waits for the slot, the hold gets ${formatDuration(NOTICE_MS)} of notice and then ends with exit ${EXIT_LEASE_ENDED}. Run the command again without --for.`;
}

/** A waiter in the Desktop Queue. */
export interface QueueTicket {
  seq: number;
  token: string;
  pid: number;
  /** When the process `pid` started, as `ps` reports it; tells a reused pid apart. */
  processStart?: string;
  command: string;
  /** The git toplevel of the waiter's working directory. */
  worktree: string;
  enqueuedAt: string;
  /** The waiter's Admission Deadline. */
  deadline: string;
  /** An Exclusive Hold: it claims every slot at once. */
  exclusive?: boolean;
}

/** The holder of one Desktop Slot, or of all of them for an Exclusive Hold. */
export interface SlotOwner extends Omit<QueueTicket, "seq"> {
  /** The indices of the slots this hold has. */
  slots: number[];
  admittedAt: string;
  /**
   * The Lease end: the last progress plus the silence limit (capped at
   * MAX_LEASE_MS from admission), or the end of a manual hold's notice.
   * Absent for a manual hold that has no notice: it has no end.
   */
  leaseEndsAt?: string;
  /** The silence limit of an automated holder; absent for a manual hold. */
  silenceMs?: number;
  /** The last sign of progress. */
  progress?: { at: string; what: string };
  /** The notice a waiter gave this manual hold. */
  notice?: HoldNotice;
  /**
   * The process group eviction signals. Absent when the holder shares its
   * group with its caller; eviction then signals the pid alone.
   */
  pgid?: number;
  /**
   * When the group's leader `pgid` started, as `ps` reports it. The group of a
   * dead holder is ended only while its leader still has this start.
   */
  pgidStart?: string;
  /** A manual hold: it yields on notice when a run waits. */
  manual?: boolean;
}

/** The notice of a manual hold: who waits, and when the hold ends. */
interface HoldNotice {
  startedAt: string;
  endsAt: string;
  /** The waiter, as `pid <pid> (<command>) in <worktree>`. */
  waiter: string;
}

/** The Admission Deadline passed; the message names the holder and the queue. */
export class DesktopSlotBlockedError extends Error {
  readonly exitCode = EXIT_ADMISSION_BLOCKED;
}

/** An automated holder states its silence limit; a manual hold states none. */
type HoldKind =
  | {
      /** The silence limit, from SILENCE_LIMIT_MS. */
      silenceMs: number;
      manual?: false;
    }
  | {
      /** A manual hold: no end until a waiter gives it notice. */
      manual: true;
      silenceMs?: never;
    };

export type DesktopSlotOptions = HoldKind & {
  /** The admission this hold joins. @default DESKTOP_ADMISSION */
  admission?: Admission;
  /** @default the admission's own directory */
  dir?: string;
  /** Its git toplevel is the holder's worktree. */
  cwd?: string;
  /** What the holder runs, shown to waiters. */
  command?: string;
  /** @default the git toplevel of `cwd`, else `cwd` */
  worktree?: string;
  /** Hold every slot: an Exclusive Hold, for work that needs the whole app. */
  exclusive?: boolean;
  /** The Admission Deadline, from now. @default DESKTOP_WAIT_ENV, else 9 min */
  waitMs?: number;
  /** How often a waiter polls the queue, and a holder its record. @default 2000 */
  pollMs?: number;
  /** How often a waiter repeats who holds the slot. @default 5 min */
  remindMs?: number;
  /** @default EVICTION_GRACE_MS */
  graceMs?: number;
  /** @default KILL_AFTER_MS */
  killAfterMs?: number;
  /** Epoch milliseconds; tests move it to pass a Lease or a deadline. */
  now?: () => number;
  log?: (message: string) => void;
  /** Release on SIGINT, SIGTERM, and SIGHUP. Turn off when the caller handles signals. */
  signals?: boolean;
  /**
   * Runs when the Lease ends while this process still holds (or reuses) the
   * slot. The default logs the reason and exits with EXIT_LEASE_ENDED.
   */
  onLeaseEnd?: (owner: SlotOwner) => void;
};

export interface DesktopSlot extends Disposable {
  readonly dir: string;
  readonly owner: SlotOwner;
  /** True when an ancestor process holds the slot and this process reuses it. */
  readonly reused: boolean;
  /** Idempotent. A reused hold stays with its holder. */
  release(): void;
  /** Record a sign of progress; it renews the Lease of an automated holder. */
  progress(what: string): void;
}

/** Wait in the Desktop Queue until this process holds a Desktop Slot. */
export async function acquireDesktopSlot(
  options: DesktopSlotOptions,
): Promise<DesktopSlot> {
  const admission = options.admission ?? DESKTOP_ADMISSION;
  const { slotName, queueName } = admission;
  const dir = options.dir ?? admission.dir();
  const now = options.now ?? epochMs;
  const log = options.log ?? ((message: string) => console.error(message));
  const pollMs = options.pollMs ?? 2000;
  const remindMs = options.remindMs ?? 5 * MINUTE;
  const graceMs = options.graceMs ?? EVICTION_GRACE_MS;
  const killAfterMs = options.killAfterMs ?? KILL_AFTER_MS;
  const silenceMs = options.manual
    ? undefined
    : Math.min(options.silenceMs, MAX_LEASE_MS);
  const waitMs = options.waitMs ?? admissionWaitMs();
  const cwd = options.cwd ?? process.cwd();
  const count = admission.slots();
  const watch: LeaseWatch = {
    dir,
    now,
    pollMs,
    log,
    slotName,
    onEnd: options.onLeaseEnd ?? leaseEnded(log, slotName, now),
  };

  const inherited = process.env[admission.tokenEnv];
  if (inherited) {
    const holder = await findLiveHolder(inherited, { dir, now });
    if (holder) return reusedSlot(watch, holder);
  }

  await mkdir(join(dir, QUEUE), { recursive: true });
  const self = await processInfo(process.pid);
  const start = now();
  const deadline = start + waitMs;
  let ticket = await enqueue(dir, {
    token: randomUUID(),
    pid: process.pid,
    processStart: self.start,
    command: options.command ?? process.argv.slice(1).join(" "),
    worktree: options.worktree ?? (await gitToplevel(cwd)),
    enqueuedAt: isoOf(start),
    deadline: isoOf(deadline),
    ...(options.exclusive ? { exclusive: true } : {}),
  });
  const { seq: _seq, ...record } = ticket;
  const dropTicket = () => rmSync(ticketPath(dir, ticket), { force: true });

  let reported: { key: string; at: number } | undefined;
  /** The overdue holders this waiter signalled, by token. */
  const evicting = new Map<string, { at: number; killed: boolean }>();
  let owner: SlotOwner | undefined;
  try {
    for (;;) {
      const waiters = await liveTickets(dir, ticket.token);
      const position = waiters.findIndex((each) => each.token === ticket.token);
      if (position === -1) {
        // Another waiter reaped it, or someone removed it.
        await mkdir(join(dir, QUEUE), { recursive: true });
        ticket = await enqueue(dir, record);
        log(
          `${slotName}: this waiter's ticket was removed; joining the back of the ${queueName}.`,
        );
        continue;
      }
      const slots = await readSlots(dir);
      const { holders } = slots;
      if (position === 0) {
        // Until the Memory Gate admits this run, its Lease has not started:
        // the gate wait ends by the deadline, so this end is an upper bound.
        const claimed = await tryClaim(
          dir,
          {
            ...record,
            admittedAt: isoOf(now()),
            ...(silenceMs === undefined
              ? { manual: true }
              : { silenceMs, leaseEndsAt: isoOf(deadline + silenceMs) }),
            ...(self.pgid === process.pid
              ? { pgid: self.pgid, pgidStart: self.start }
              : {}),
          },
          { slots, count },
        );
        if (claimed) {
          owner = claimed;
          break;
        }
        let cleared = false;
        const alive: SlotOwner[] = [];
        for (const holder of holders) {
          if (!(await isHolderAlive(holder))) {
            log(
              `${slotName}: pid ${holder.pid} (${holder.command}) is gone; taking over ${holder.slots.map((index) => slotPath(dir, index)).join(", ")}.`,
            );
            await endOrphanGroup(holder, {
              ownPgid: self.pgid,
              killAfterMs,
              log,
            });
            await takeOver(dir, holder);
            cleared = true;
            continue;
          }
          alive.push(holder);
          if (now() > epochOf(holder.leaseEndsAt) + graceMs) {
            const signalled = evicting.get(holder.token);
            if (!signalled) {
              log(
                `${slotName}: the Lease of pid ${holder.pid} (${holder.command}) ended at ${holder.leaseEndsAt}, and the holder is still running ${formatDuration(graceMs)} later; evicting pid ${holder.pid}.`,
              );
              await signalHolder(holder, "SIGTERM", self.pgid);
              evicting.set(holder.token, { at: now(), killed: false });
            } else if (
              !signalled.killed &&
              now() - signalled.at >= killAfterMs
            ) {
              await signalHolder(holder, "SIGKILL", self.pgid);
              signalled.killed = true;
            }
          }
        }
        for (const index of slots.orphans) {
          if ((await age(slotPath(dir, index))) > ORPHAN_MS) {
            await takeOverSlot(dir, index, undefined);
            cleared = true;
          }
        }
        if (cleared) continue;
        let noticed = false;
        for (const holder of noticeTargets(record, alive)) {
          const notice: HoldNotice = {
            startedAt: isoOf(now()),
            endsAt: isoOf(now() + NOTICE_MS),
            waiter: `pid ${record.pid} (${record.command}) in ${record.worktree}`,
          };
          const given = updateOwnerSync(dir, holder.token, (current) =>
            current.notice
              ? undefined
              : { ...current, notice, leaseEndsAt: notice.endsAt },
          );
          if (given) {
            noticed = true;
            log(
              `${slotName}: gave the manual hold of pid ${holder.pid} (${holder.command}) ${formatDuration(NOTICE_MS)} of notice; it ends at ${notice.endsAt}, and then this run can take its slot.`,
            );
          }
        }
        // Read the holders again, so the next message names the notice.
        if (noticed) continue;
      }
      if (now() >= deadline) {
        throw new DesktopSlotBlockedError(
          blockedMessage({
            admission,
            waitMs,
            deadline,
            holders,
            ahead: waiters.slice(0, position),
          }),
        );
      }
      const key = `${holders.map((holder) => holder.token).join()}:${position}`;
      if (reported?.key !== key || now() - reported.at >= remindMs) {
        log(
          waitingMessage({ admission, position, waiters, holders, deadline }),
        );
        reported = { key, at: now() };
      }
      await delay(pollMs);
    }
  } finally {
    dropTicket();
  }

  let gateAdmitted = false;
  try {
    if (admission.memoryGate) {
      gateAdmitted = await Effect.runPromise(
        passMemoryGate({
          dir,
          deadline: epochMs() + (deadline - now()),
          pollMs: Math.max(pollMs, 100),
          log,
        }),
      );
    }
  } catch (error) {
    releaseIfHeld(dir, owner.token);
    if (!(error instanceof MemoryGateClosedError)) throw error;
    throw new DesktopSlotBlockedError(
      blockedMessage({
        admission,
        waitMs,
        deadline,
        holders: [],
        ahead: [],
        gate: error.reason,
      }),
    );
  }
  // The Lease starts once the run is admitted.
  const admittedAt = now();
  const claimed = owner;
  owner =
    updateOwnerSync(dir, claimed.token, (current) => ({
      ...current,
      admittedAt: isoOf(admittedAt),
      progress: { at: isoOf(admittedAt), what: "admitted" },
      ...(silenceMs === undefined
        ? {}
        : { leaseEndsAt: isoOf(admittedAt + silenceMs) }),
    })) ?? claimed;
  return heldSlot(watch, owner, {
    signals: options.signals ?? true,
    gateAdmitted,
    tokenEnv: admission.tokenEnv,
  });
}

/**
 * The holder whose token is `token`, while it runs and its Lease lasts;
 * undefined otherwise.
 */
export async function findLiveHolder(
  token: string,
  options: { dir: string; now?: () => number },
): Promise<SlotOwner | undefined> {
  const now = options.now ?? epochMs;
  const holder = await findHolder(options.dir, token);
  return holder &&
    now() < epochOf(holder.leaseEndsAt) &&
    (await isHolderAlive(holder))
    ? holder
    : undefined;
}

/**
 * {@link acquireDesktopSlot} for an in-process holder: at the Admission
 * Deadline it prints the block and exits with EXIT_ADMISSION_BLOCKED.
 */
export async function acquireDesktopSlotOrExit(
  options: DesktopSlotOptions,
): Promise<DesktopSlot> {
  try {
    return await acquireDesktopSlot(options);
  } catch (error) {
    if (!(error instanceof DesktopSlotBlockedError)) throw error;
    console.error(error.message);
    process.exit(EXIT_ADMISSION_BLOCKED);
  }
}

export type HolderStatus = SlotOwner & {
  /** An automated holder renews its Lease on progress; a manual hold yields on notice. */
  kind: "automated" | "manual";
  alive: boolean;
  overdue: boolean;
};

export interface DesktopSlotStatus {
  /** Every Desktop Slot in order; a free slot has no holder. */
  slots: { index: number; holder?: HolderStatus }[];
  /** One entry per hold, in slot order. */
  holders: HolderStatus[];
  /** Live waiters, head first. */
  waiters: QueueTicket[];
  /** When the Memory Gate last admitted a run. */
  lastGateStart?: string;
  /** Why DESKTOP_SLOTS_ENV could not be read; the slots on disk are listed. */
  slotCountError?: string;
}

export async function readDesktopSlotStatus(
  options: { admission?: Admission; dir?: string; now?: () => number } = {},
): Promise<DesktopSlotStatus> {
  const admission = options.admission ?? DESKTOP_ADMISSION;
  const dir = options.dir ?? admission.dir();
  const now = options.now ?? epochMs;
  const { holders: owners, taken } = await readSlots(dir);
  const holders: HolderStatus[] = [];
  for (const owner of owners) {
    holders.push({
      ...owner,
      kind: owner.manual ? "manual" : "automated",
      alive: await isHolderAlive(owner),
      overdue: now() > epochOf(owner.leaseEndsAt),
    });
  }
  let configured = 0;
  let slotCountError: string | undefined;
  try {
    configured = admission.slots();
  } catch (error) {
    slotCountError = (error as Error).message;
  }
  const count = Math.max(configured, ...[...taken].map((i) => i + 1));
  return {
    slots: Array.from({ length: count }, (_, index) => ({
      index,
      holder: holders.find((holder) => holder.slots.includes(index)),
    })),
    holders,
    waiters: await liveTickets(dir, undefined, false),
    lastGateStart: lastGateStart(dir)?.toString(),
    ...(slotCountError ? { slotCountError } : {}),
  };
}

/**
 * End the holder that `target` (its token or pid) names, by the same path as
 * a waiter's eviction: SIGTERM, then SIGKILL, then takeover.
 *
 * @throws {Error} when `target` does not name a current holder.
 */
export async function evictDesktopSlot(options: {
  target: string;
  dir?: string;
  killAfterMs?: number;
  log?: (message: string) => void;
}): Promise<SlotOwner> {
  const dir = options.dir ?? desktopStateDir();
  const log = options.log ?? ((message: string) => console.error(message));
  const killAfterMs = options.killAfterMs ?? KILL_AFTER_MS;
  const { holders } = await readSlots(dir);
  const owner = holders.find(
    (holder) =>
      holder.token === options.target || String(holder.pid) === options.target,
  );
  if (!owner) {
    throw new Error(
      `Desktop Slot: ${options.target} names no holder${holders.length > 0 ? ` (${holders.map((holder) => `pid ${holder.pid}, token ${holder.token}`).join("; ")})` : "; every slot is free"}.`,
    );
  }
  const self = await processInfo(process.pid);
  const holds = async () =>
    Boolean(await findHolder(dir, owner.token)) && (await isHolderAlive(owner));
  log(`Desktop Slot: evicting ${describeHolder(owner, epochMs())}.`);
  for (const [signal, waitMs] of [
    ["SIGTERM", killAfterMs],
    ["SIGKILL", 5 * SECOND],
  ] as const) {
    if (!(await holds())) break;
    await signalHolder(owner, signal, self.pgid);
    const until = epochMs() + waitMs;
    while (epochMs() < until && (await holds())) await delay(100);
  }
  // A holder that was already gone may have left its command running.
  await endOrphanGroup(owner, { ownPgid: self.pgid, killAfterMs, log });
  await takeOver(dir, owner);
  return owner;
}

/**
 * Record `pgid` as the process group eviction signals, when `token` still
 * holds the slot.
 */
export async function recordDesktopSlotGroup(
  token: string,
  pgid: number,
  dir: string = desktopStateDir(),
): Promise<void> {
  const { start } = await processInfo(pgid);
  updateOwnerSync(dir, token, (owner) => ({
    ...owner,
    pgid,
    ...(start === undefined ? {} : { pgidStart: start }),
  }));
}

export function describeHolder(owner: SlotOwner, now: number): string {
  const overdue = now > epochOf(owner.leaseEndsAt) ? " (overdue)" : "";
  const exclusive = owner.exclusive ? ", an Exclusive Hold of every slot" : "";
  const progress = owner.progress
    ? `last progress ${owner.progress.at} (${owner.progress.what})`
    : "no progress yet";
  const lease = owner.manual
    ? owner.notice
      ? `manual hold, ${progress}, on notice for ${owner.notice.waiter}: ends ${owner.notice.endsAt}${overdue}`
      : `manual hold, ${progress}, yields when a run waits`
    : `automated, ${progress}, silence limit ${formatDuration(owner.silenceMs ?? 0)}, Lease ends ${owner.leaseEndsAt ?? "after admission"}${overdue}`;
  return `pid ${owner.pid} (${owner.command}) in ${owner.worktree}${exclusive}, admitted ${owner.admittedAt}, ${lease}`;
}

/** Why the Lease of `owner` has ended, for the holder's own message. */
export function describeLeaseEnd(owner: SlotOwner, now: number): string {
  if (owner.manual) {
    return `the notice for ${owner.notice?.waiter ?? "a waiter"} ended at ${owner.leaseEndsAt}`;
  }
  const admittedAt = epochOf(owner.admittedAt);
  if (now >= admittedAt + MAX_LEASE_MS) {
    return `the run reached the cap of ${formatDuration(MAX_LEASE_MS)} on total time, counted from admission at ${owner.admittedAt}`;
  }
  const last = owner.progress ? epochOf(owner.progress.at) : admittedAt;
  return `the run made no progress for ${formatDuration(roundToSecond(now - last))}, longer than its silence limit of ${formatDuration(owner.silenceMs ?? 0)}; the last progress was ${owner.progress ? `"${owner.progress.what}" at ${owner.progress.at}` : `admission at ${owner.admittedAt}`}`;
}

function roundToSecond(ms: number): number {
  return Math.max(0, Math.round(ms / SECOND) * SECOND);
}

/**
 * Record `what` as the last progress of the hold that `token` names. For an
 * automated holder it moves the Lease end to now plus its silence limit,
 * capped at MAX_LEASE_MS from admission. It is synchronous, so it fits an
 * output handler or an exit path.
 * @returns the updated record, or undefined when `token` holds no slot.
 */
function renewDesktopSlot(
  token: string,
  what: string,
  options: { dir?: string; now?: () => number } = {},
): SlotOwner | undefined {
  const dir = options.dir ?? desktopStateDir();
  const at = (options.now ?? epochMs)();
  return updateOwnerSync(dir, token, (owner) => ({
    ...owner,
    progress: { at: isoOf(at), what },
    ...(owner.manual || owner.silenceMs === undefined
      ? {}
      : {
          leaseEndsAt: isoOf(
            Math.min(
              at + owner.silenceMs,
              epochOf(owner.admittedAt) + MAX_LEASE_MS,
            ),
          ),
        }),
  }));
}

/**
 * Record progress for the Desktop Slot that this process holds or reuses,
 * named by DESKTOP_SLOT_ENV; nothing when it holds none.
 */
export function reportDesktopProgress(what: string): void {
  const token = process.env[DESKTOP_SLOT_ENV];
  if (token) renewDesktopSlot(token, what);
}

/**
 * Wrap `progress` so that a stream of output records it at most once per
 * `intervalMs`: each chunk of a child's output is a sign of progress.
 */
export function throttledProgress(
  progress: (what: string) => void,
  intervalMs = 5 * SECOND,
): (what: string) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (what) => {
    const at = epochMs();
    if (at - last < intervalMs) return;
    last = at;
    progress(what);
  };
}

/**
 * The manual holds the head waiter gives notice, so that it can claim: each
 * manual hold that blocks it, or for a waiter that one free slot admits, the
 * manual hold that has held longest. None while one of them is on notice
 * already, and none while an automated holder alone blocks.
 */
function noticeTargets(
  waiter: Omit<QueueTicket, "seq">,
  holders: readonly SlotOwner[],
): SlotOwner[] {
  const blockers = waiter.exclusive
    ? holders
    : holders.filter(
        (holder) => holder.exclusive || holder.worktree === waiter.worktree,
      );
  if (waiter.exclusive || blockers.length > 0) {
    return blockers.filter((holder) => holder.manual && !holder.notice);
  }
  // Every slot is taken: one release admits the waiter.
  if (holders.some((holder) => holder.notice)) return [];
  const longest = holders
    .filter((holder) => holder.manual)
    .toSorted((a, b) => epochOf(a.admittedAt) - epochOf(b.admittedAt))[0];
  return longest ? [longest] : [];
}

function describeHolders(holders: readonly SlotOwner[], now: number): string {
  return holders
    .map((holder) => `  - ${describeHolder(holder, now)}`)
    .join("\n");
}

/** Who holds the slots, for a waiter's message; undefined when no one does. */
function heldBy(holders: readonly SlotOwner[]): string | undefined {
  return holders.length > 0
    ? `slots held by:\n${describeHolders(holders, epochMs())}`
    : undefined;
}

export function describeWaiters(waiters: readonly QueueTicket[]): string {
  return waiters
    .map(
      (ticket, index) =>
        `  ${index + 1}. pid ${ticket.pid} (${ticket.command}) in ${ticket.worktree}${ticket.exclusive ? ", for an Exclusive Hold" : ""}, waiting since ${ticket.enqueuedAt}, deadline ${ticket.deadline}`,
    )
    .join("\n");
}

function waitingMessage({
  admission,
  position,
  waiters,
  holders,
  deadline,
}: {
  admission: Admission;
  position: number;
  waiters: readonly QueueTicket[];
  holders: readonly SlotOwner[];
  deadline: number;
}): string {
  const place = `position ${position + 1} of ${waiters.length} in the ${admission.queueName}`;
  const held =
    heldBy(holders) ?? "every slot is free for the head of the queue.";
  return `${admission.slotName}: waiting at ${place}, Admission Deadline ${isoOf(deadline)}; ${held}`;
}

function blockedMessage({
  admission: { slotName, queueName },
  waitMs,
  deadline,
  holders,
  ahead,
  gate,
}: {
  admission: Admission;
  waitMs: number;
  deadline: number;
  holders: readonly SlotOwner[];
  ahead: readonly QueueTicket[];
  /** Why the Memory Gate stayed closed, for a run that held a slot. */
  gate?: string;
}): string {
  const by =
    heldBy(holders) ??
    (gate
      ? `this run held a slot, but the Memory Gate stayed closed: ${gate}.`
      : "the slots changed hands as the deadline passed.");
  const named = holders
    .map((holder) => `pid ${holder.pid} (${holder.command})`)
    .join(", ");
  return [
    `${slotName}: not admitted within ${formatDuration(waitMs)} (Admission Deadline ${isoOf(deadline)}); ${by}`,
    ahead.length > 0
      ? `Ahead in the ${queueName}:\n${describeWaiters(ahead)}`
      : `No one was ahead in the ${queueName}.`,
    `Report this as blocked by the ${slotName}${named ? `, held by ${named}` : ""}, not as a test failure. Exit ${EXIT_ADMISSION_BLOCKED}.`,
  ].join("\n");
}

function epochMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

function isoOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString();
}

/** A record's instant in epoch ms; a record without one never ends. */
function epochOf(iso: string | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  try {
    return Temporal.Instant.from(iso).epochMilliseconds;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function slotPath(dir: string, index: number): string {
  return join(dir, `slot-${index}`);
}

function ownerPath(dir: string, index: number): string {
  return join(slotPath(dir, index), OWNER_FILE);
}

/** The slot indices among the names in the state dir, ascending. */
function slotIndices(names: readonly string[]): number[] {
  return names
    .filter((name) => name.startsWith("slot-"))
    .map((name) => Number(name.slice("slot-".length)))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .toSorted((a, b) => a - b);
}

/** The git toplevel of `cwd`: the worktree a holder records; else `cwd`. */
async function gitToplevel(cwd: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd },
    );
    return stdout.trim();
  } catch {
    return cwd;
  }
}

function ticketPath(dir: string, ticket: QueueTicket): string {
  return join(
    dir,
    QUEUE,
    `${String(ticket.seq).padStart(12, "0")}-${ticket.token}.json`,
  );
}

/** Write `text` so that a reader sees it whole or not at all. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const draft = `${path}.${randomUUID()}.draft`;
  await writeFile(draft, text);
  await rename(draft, path);
}

/**
 * Take the next sequence number under a short mutex, so two waiters that
 * enqueue at once keep a strict order.
 */
async function enqueue(
  dir: string,
  record: Omit<QueueTicket, "seq">,
): Promise<QueueTicket> {
  using _mutex = await mutex(join(dir, `${QUEUE}.lock`));
  const seqPath = join(dir, QUEUE_SEQ);
  const last = Number(await readFile(seqPath, "utf8").catch(() => "0")) || 0;
  const ticket = { ...record, seq: last + 1 };
  await writeAtomic(seqPath, String(ticket.seq));
  await writeAtomic(ticketPath(dir, ticket), JSON.stringify(ticket));
  return ticket;
}

/**
 * Take the mkdir mutex at `path`, breaking one older than `staleMs`. The
 * holder's token inside it keeps a holder whose mutex was broken as stale from
 * removing the next holder's on dispose.
 */
async function mutex(
  path: string,
  staleMs = STALE_QUEUE_LOCK_MS,
  pollMs = 5,
): Promise<Disposable> {
  const tokenPath = join(path, "token");
  const token = randomUUID();
  for (;;) {
    try {
      await mkdir(path);
      await writeFile(tokenPath, token);
      return {
        [Symbol.dispose]: () => {
          try {
            if (readFileSync(tokenPath, "utf8") !== token) return;
          } catch {
            return;
          }
          rmSync(path, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await age(path)) > staleMs) {
        await rm(path, { recursive: true, force: true });
      }
      await delay(pollMs);
    }
  }
}

/**
 * Hold the machine-wide mutex `name` in the desktop state dir until disposed.
 * A mutex older than `staleMs` belongs to a holder that died, and is broken.
 */
export async function holdDesktopMutex(
  name: string,
  options: { dir?: string; staleMs?: number } = {},
): Promise<Disposable> {
  const dir = options.dir ?? desktopStateDir();
  await mkdir(dir, { recursive: true });
  return await mutex(join(dir, name), options.staleMs ?? 30 * SECOND, 20);
}

/**
 * The live tickets, head first. Unless `reap` is off, a ticket whose waiter
 * is gone is removed; `self` is alive without a check.
 */
async function liveTickets(
  dir: string,
  self?: string,
  reap = true,
): Promise<QueueTicket[]> {
  const names = await readdir(join(dir, QUEUE)).catch(() => []);
  const tickets: QueueTicket[] = [];
  for (const name of names.filter((each) => each.endsWith(".json"))) {
    const path = join(dir, QUEUE, name);
    const ticket = parseRecord<QueueTicket>(
      await readFile(path, "utf8").catch(() => ""),
    );
    if (!ticket) continue;
    if (ticket.token !== self && !(await isHolderAlive(ticket))) {
      if (reap) await rm(path, { force: true });
      continue;
    }
    tickets.push(ticket);
  }
  return tickets.toSorted((a, b) => a.seq - b.seq);
}

/**
 * Claim a slot for `owner` when one is free and no holder from its worktree
 * has one, or every slot for an Exclusive Hold when all are free.
 * @returns the owner with its slots, or undefined when it must wait.
 */
async function tryClaim(
  dir: string,
  owner: Omit<SlotOwner, "slots">,
  { slots: { holders, taken }, count }: { slots: SlotState; count: number },
): Promise<SlotOwner | undefined> {
  const all = Array.from({ length: count }, (_, index) => index);
  let wanted: number[];
  // Every slot on disk counts, also one past this process's count: another
  // process may see more slots.
  if (owner.exclusive) {
    if (taken.size > 0) return undefined;
    wanted = all;
  } else {
    if (
      holders.some(
        (holder) => holder.exclusive || holder.worktree === owner.worktree,
      )
    ) {
      return undefined;
    }
    const free = all.find((index) => !taken.has(index));
    if (free === undefined) return undefined;
    wanted = [free];
  }
  const slots: number[] = [];
  try {
    for (const index of wanted) {
      await mkdir(slotPath(dir, index));
      slots.push(index);
    }
  } catch (error) {
    for (const index of slots) {
      await rm(slotPath(dir, index), { recursive: true, force: true });
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  const claimed = { ...owner, slots };
  await writeOwner(dir, claimed);
  return claimed;
}

/** Write the record of `owner` into each of its slots. */
async function writeOwner(dir: string, owner: SlotOwner): Promise<void> {
  for (const index of owner.slots) {
    await writeAtomic(ownerPath(dir, index), JSON.stringify(owner));
  }
}

/**
 * Replace the record of the hold that `token` names by `update(record)`, in
 * each of its slots, while that slot still names `token`. An update that
 * returns undefined writes nothing.
 * @returns the written record, or undefined when nothing was written.
 */
function updateOwnerSync(
  dir: string,
  token: string,
  update: (owner: SlotOwner) => SlotOwner | undefined,
): SlotOwner | undefined {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const slots = slotIndices(names).filter(
    (index) => readOwnerSync(dir, index)?.token === token,
  );
  const current =
    slots[0] === undefined ? undefined : readOwnerSync(dir, slots[0]);
  if (!current) return undefined;
  const next = update({ ...current, slots });
  if (!next) return undefined;
  let written = false;
  for (const index of slots) {
    // The slot may have been released since it was read.
    if (readOwnerSync(dir, index)?.token !== token) continue;
    const path = ownerPath(dir, index);
    const draft = `${path}.${randomUUID()}.draft`;
    try {
      writeFileSync(draft, JSON.stringify(next));
      renameSync(draft, path);
      written = true;
    } catch (error) {
      rmSync(draft, { force: true });
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return written ? next : undefined;
}

function parseRecord<T extends { token: string; pid: number }>(
  text: string,
): T | undefined {
  try {
    const record = JSON.parse(text) as Partial<T>;
    if (typeof record.token !== "string" || typeof record.pid !== "number") {
      return undefined;
    }
    return record as T;
  } catch {
    return undefined;
  }
}

interface SlotState {
  /** One entry per hold, in slot order, with the slots it has. */
  holders: SlotOwner[];
  /** Slots claimed without an owner record yet. */
  orphans: number[];
  /** Every slot index with a claim. */
  taken: Set<number>;
}

async function readSlots(dir: string): Promise<SlotState> {
  const names = await readdir(dir).catch(() => []);
  const byToken = new Map<string, SlotOwner>();
  const orphans: number[] = [];
  const taken = new Set<number>();
  for (const index of slotIndices(names)) {
    taken.add(index);
    const owner = parseRecord<SlotOwner>(
      await readFile(ownerPath(dir, index), "utf8").catch(() => ""),
    );
    if (!owner) {
      orphans.push(index);
      continue;
    }
    const known = byToken.get(owner.token);
    if (known) known.slots.push(index);
    else byToken.set(owner.token, { ...owner, slots: [index] });
  }
  return { holders: [...byToken.values()], orphans, taken };
}

async function findHolder(
  dir: string,
  token: string,
): Promise<SlotOwner | undefined> {
  return (await readSlots(dir)).holders.find(
    (holder) => holder.token === token,
  );
}

function readOwnerSync(dir: string, index: number): SlotOwner | undefined {
  try {
    return parseRecord<SlotOwner>(readFileSync(ownerPath(dir, index), "utf8"));
  } catch {
    return undefined;
  }
}

/** Milliseconds since the path last changed; 0 when it is gone. */
async function age(path: string): Promise<number> {
  try {
    return epochMs() - (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `ps -o pgid= -o lstart=`: the group, then a start such as `Wed Oct 21 21:49:58 2026`. */
const PS_LINE = regex("^\\s*(?<pgid>\\d+)\\s+(?<start>.+?)\\s*$");

/**
 * When `pid` started and its process group, as `ps` reports them; empty when
 * `ps` cannot tell (no `ps`, no process).
 */
async function processInfo(
  pid: number,
): Promise<{ start?: string; pgid?: number }> {
  try {
    const { stdout } = await promisify(execFile)(
      "ps",
      ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)],
      { env: { ...process.env, LC_ALL: "C" } },
    );
    const match = PS_LINE.exec(stdout);
    return match
      ? { pgid: Number(match.groups.pgid), start: match.groups.start }
      : {};
  } catch {
    return {};
  }
}

/** The process runs, and its pid was not given to a new process. */
async function isHolderAlive(record: {
  pid: number;
  processStart?: string;
}): Promise<boolean> {
  if (!isAlive(record.pid)) return false;
  if (record.processStart === undefined) return true;
  const { start } = await processInfo(record.pid);
  return start === undefined || start === record.processStart;
}

/**
 * Signal a holder's process group (or its pid alone), after checking that its
 * pid still names the holder's process. A process never signals itself or its
 * own group.
 */
async function signalHolder(
  holder: SlotOwner,
  signal: NodeJS.Signals,
  ownPgid: number | undefined,
): Promise<void> {
  if (holder.pid === process.pid || !(await isHolderAlive(holder))) return;
  const targets =
    holder.pgid !== undefined && holder.pgid !== ownPgid
      ? [-holder.pgid, holder.pid]
      : [holder.pid];
  for (const target of targets) {
    try {
      process.kill(target, signal);
    } catch {
      // Gone already.
    }
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

/**
 * End the process group of a dead holder, which keeps driving the desktop when
 * the holder was killed and its command lives on: SIGTERM, then SIGKILL after
 * `killAfterMs`. A group whose leader's start differs from the record, or
 * cannot be read, is never signalled.
 */
async function endOrphanGroup(
  holder: SlotOwner,
  {
    ownPgid,
    killAfterMs,
    log,
  }: {
    ownPgid: number | undefined;
    killAfterMs: number;
    log: (message: string) => void;
  },
): Promise<void> {
  const { pgid, pgidStart } = holder;
  if (pgid === undefined || pgidStart === undefined || pgid === ownPgid) return;
  const { start } = await processInfo(pgid);
  if (start === undefined || start !== pgidStart) return;
  log(
    `Desktop Slot: the process group ${pgid} of pid ${holder.pid} (${holder.command}) is still running; ending it.`,
  );
  for (const [signal, waitMs] of [
    ["SIGTERM", killAfterMs],
    ["SIGKILL", 0],
  ] as const) {
    if (!groupAlive(pgid)) return;
    try {
      process.kill(-pgid, signal);
    } catch {
      return;
    }
    const until = epochMs() + waitMs;
    while (epochMs() < until && groupAlive(pgid)) await delay(100);
  }
}

/** Remove every slot of `seen`, a holder that is gone or was evicted. */
async function takeOver(dir: string, seen: SlotOwner): Promise<void> {
  for (const index of seen.slots) await takeOverSlot(dir, index, seen.token);
}

/**
 * Remove slot `index` while its holder is still `token` (or, when undefined,
 * while it is an orphan claim). A takeover mutex lets one waiter at a time
 * re-check and remove it, so a waiter never removes a slot that another waiter
 * has just claimed.
 */
async function takeOverSlot(
  dir: string,
  index: number,
  token: string | undefined,
): Promise<void> {
  const path = slotPath(dir, index);
  const lock = `${path}.takeover`;
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await age(lock)) > STALE_TAKEOVER_MS) {
      await rm(lock, { recursive: true, force: true });
    }
    return;
  }
  try {
    const current = parseRecord<SlotOwner>(
      await readFile(ownerPath(dir, index), "utf8").catch(() => ""),
    );
    const unchanged = token
      ? current?.token === token
      : !current && (await age(path)) > ORPHAN_MS;
    if (unchanged) await rm(path, { recursive: true, force: true });
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

function releaseIfHeld(dir: string, token: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const index of slotIndices(names)) {
    if (readOwnerSync(dir, index)?.token === token) {
      rmSync(slotPath(dir, index), { recursive: true, force: true });
    }
  }
}

interface LeaseWatch {
  dir: string;
  now: () => number;
  pollMs: number;
  log: (message: string) => void;
  slotName: string;
  onEnd: (owner: SlotOwner) => void;
}

/**
 * Poll the record of `owner` until the hold is gone. Print a notice when a
 * waiter gives one, and call `onEnd` once when the Lease ends. A notice ends
 * the hold only while a run still waits; with none left the hold goes on with
 * no end. The timer never keeps the process alive.
 *
 * A reused hold follows only an automated holder's Lease: the holder of a
 * manual hold prints its notice and ends its command's process group itself.
 */
function watchLease(
  { dir, now, pollMs, log, slotName, onEnd }: LeaseWatch,
  owner: SlotOwner,
  { reused }: { reused: boolean },
): () => void {
  let announced: string | undefined;
  let busy = false;
  const stop = () => clearInterval(timer);
  const check = async () => {
    const current = readOwnerSync(dir, owner.slots[0]!);
    if (current?.token !== owner.token) return stop();
    if (current.manual && reused) return;
    const { notice } = current;
    if (notice && announced !== notice.endsAt) {
      announced = notice.endsAt;
      log(
        `${slotName}: ${notice.waiter} waits for a slot. This manual hold ends at ${notice.endsAt}, in ${formatDuration(roundToSecond(epochOf(notice.endsAt) - now()))}; save your work. It then ends its command's process group with exit ${EXIT_LEASE_ENDED}.`,
      );
    }
    if (now() < epochOf(current.leaseEndsAt)) return;
    if (notice && (await liveTickets(dir, undefined, false)).length === 0) {
      const { notice: _gone, leaseEndsAt: _end, ...rest } = current;
      if (updateOwnerSync(dir, owner.token, () => ({ ...rest }))) {
        announced = undefined;
        log(
          `${slotName}: no run waits any more, so this manual hold goes on; it yields again when a run waits.`,
        );
      }
      return;
    }
    stop();
    onEnd(current);
  };
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void check().finally(() => {
      busy = false;
    });
  }, pollMs);
  timer.unref();
  return stop;
}

function leaseEnded(
  log: (message: string) => void,
  slotName: string,
  now: () => number,
) {
  return (owner: SlotOwner) => {
    log(
      `${slotName}: the Lease of pid ${owner.pid} (${owner.command}) ended: ${describeLeaseEnd(owner, now())}. Ending this run with exit ${EXIT_LEASE_ENDED}.`,
    );
    process.exit(EXIT_LEASE_ENDED);
  };
}

/** A child reuses its holder's slot, inside the holder's Lease. */
function reusedSlot(watch: LeaseWatch, owner: SlotOwner): DesktopSlot {
  const stop = watchLease(watch, owner, { reused: true });
  return {
    dir: watch.dir,
    owner,
    reused: true,
    release: stop,
    progress: (what) => {
      renewDesktopSlot(owner.token, what, watch);
    },
    [Symbol.dispose]: stop,
  };
}

function heldSlot(
  watch: LeaseWatch,
  owner: SlotOwner,
  {
    signals,
    gateAdmitted,
    tokenEnv,
  }: { signals: boolean; gateAdmitted: boolean; tokenEnv: string },
): DesktopSlot {
  const { dir } = watch;
  let released = false;
  const stopLease = watchLease(watch, owner, { reused: false });
  const onSignal = (signal: NodeJS.Signals) => {
    release();
    // Keep the default exit for a signal no one else handles.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  function release() {
    if (released) return;
    released = true;
    stopLease();
    process.off("exit", release);
    for (const signal of SIGNALS) process.off(signal, onSignal);
    if (process.env[tokenEnv] === owner.token) delete process.env[tokenEnv];
    if (gateAdmitted) delete process.env[MEMORY_GATE_ADMITTED_ENV];
    releaseIfHeld(dir, owner.token);
  }
  process.on("exit", release);
  if (signals) {
    for (const signal of SIGNALS) process.on(signal, onSignal);
  }
  process.env[tokenEnv] = owner.token;
  // What this holder starts was admitted with it.
  if (gateAdmitted) process.env[MEMORY_GATE_ADMITTED_ENV] = "1";
  return {
    dir,
    owner,
    reused: false,
    release,
    progress: (what) => {
      if (!released) renewDesktopSlot(owner.token, what, watch);
    },
    [Symbol.dispose]: release,
  };
}
