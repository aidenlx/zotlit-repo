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

import {
  cannotPaintMessage,
  cannotPaintWarning,
  holdDisplayAwake,
  readDesktopPaint,
} from "#desktop-paint";

export { paintAfterFailure } from "#desktop-paint";
export {
  ADMISSION_DEADLINE_MS,
  DESKTOP_WAIT_ENV,
  EXIT_ADMISSION_BLOCKED,
  parseDuration,
} from "@zotlit/config/memory-gate";

export const DESKTOP_SLOT_ENV = "ZOTLIT_DESKTOP_SLOT";

export interface Admission {
  dir: () => string;
  tokenEnv: string;
  memoryGate: boolean;
  display: boolean;
  slotName: string;
  queueName: string;
}

export const EXIT_LEASE_ENDED = 76;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const SILENCE_LIMIT_MS = {
  e2e: 12 * MINUTE,
  docsWalk: 22 * MINUTE,
  measureQuery: 12 * MINUTE,
  childOutput: 15 * MINUTE,
} as const;
export const DESKTOP_ADMISSION: Admission = {
  dir: desktopStateDir,
  tokenEnv: DESKTOP_SLOT_ENV,
  memoryGate: true,
  display: true,
  slotName: "Desktop Slot",
  queueName: "Desktop Queue",
};

export const NOTICE_MS = 5 * MINUTE;
export const MAX_LEASE_MS = 2 * HOUR;
export const EVICTION_GRACE_MS = 2 * MINUTE;
export const KILL_AFTER_MS = 10 * SECOND;

const OWNER_FILE = "owner.json";
const QUEUE = "queue";
const QUEUE_SEQ = "queue.seq";
const ORPHAN_MS = 10 * SECOND;
const STALE_TAKEOVER_MS = 30 * SECOND;
const STALE_QUEUE_LOCK_MS = 10 * SECOND;
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export function formatDuration(ms: number): string {
  if (ms >= 2 * HOUR && ms % HOUR === 0) return `${ms / HOUR} h`;
  if (ms % MINUTE === 0) return `${ms / MINUTE} min`;
  if (ms % SECOND === 0) return `${ms / SECOND} s`;
  return `${ms} ms`;
}

export function removedLeaseFlag(args: readonly string[]): string | undefined {
  const own = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
  if (!own.some((arg) => arg === "--for" || arg.startsWith("--for="))) {
    return undefined;
  }
  return `--for is gone: a manual hold states no duration. It keeps its Desktop Slot until its command exits. When a run waits for the slot, the hold gets ${formatDuration(NOTICE_MS)} of notice and then ends with exit ${EXIT_LEASE_ENDED}. Run the command again without --for.`;
}

export interface QueueTicket {
  seq: number;
  token: string;
  pid: number;
  processStart?: string;
  command: string;
  worktree: string;
  enqueuedAt: string;
  deadline: string;
  exclusive?: boolean;
}

export interface SlotOwner extends Omit<QueueTicket, "seq"> {
  slots: number[];
  admittedAt: string;
  leaseEndsAt?: string;
  silenceMs?: number;
  progress?: { at: string; what: string };
  notice?: HoldNotice;
  pgid?: number;
  pgidStart?: string;
  manual?: boolean;
}

interface HoldNotice {
  startedAt: string;
  endsAt: string;
  waiter: string;
}

export class DesktopSlotBlockedError extends Error {
  readonly exitCode = EXIT_ADMISSION_BLOCKED;
}

export class DesktopCannotPaintError extends DesktopSlotBlockedError {}

type HoldKind =
  | {
      silenceMs: number;
      manual?: false;
    }
  | {
      manual: true;
      silenceMs?: never;
    };

export type DesktopSlotOptions = HoldKind & {
  admission?: Admission;
  dir?: string;
  cwd?: string;
  command?: string;
  worktree?: string;
  waitMs?: number;
  pollMs?: number;
  remindMs?: number;
  graceMs?: number;
  killAfterMs?: number;
  now?: () => number;
  log?: (message: string) => void;
  signals?: boolean;
  onLeaseEnd?: (owner: SlotOwner) => void;
};

export interface DesktopSlot extends Disposable {
  readonly dir: string;
  readonly owner: SlotOwner;
  readonly reused: boolean;
  release(): void;
  progress(what: string): void;
}

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
    if (holder) {
      if (admission.display && !holder.exclusive) {
        throw new DesktopSlotBlockedError(
          `Desktop Slot: pid ${holder.pid} (${holder.command}) has a hold from the old Desktop Slot pool. End that command and start it again with the current pnpm desktop-slot run.`,
        );
      }
      return reusedSlot(watch, holder);
    }
  }

  if (admission.display) {
    const paint = await readDesktopPaint();
    if (paint.state === "cannot paint") {
      if (!options.manual) {
        throw new DesktopCannotPaintError(cannotPaintMessage(paint.machine));
      }
      log(cannotPaintWarning(paint.machine));
    }
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
    ...(admission.display ? { exclusive: true } : {}),
  });
  const { seq: _seq, ...record } = ticket;
  const dropTicket = () => rmSync(ticketPath(dir, ticket), { force: true });

  let reported: { key: string; at: number } | undefined;
  const evicting = new Map<string, { at: number; killed: boolean }>();
  let owner: SlotOwner | undefined;
  try {
    for (;;) {
      const waiters = await liveTickets(dir, ticket.token);
      const position = waiters.findIndex((each) => each.token === ticket.token);
      if (position === -1) {
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
          slots.taken,
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
        for (const holder of alive) {
          if (!holder.manual || holder.notice) continue;
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
      await delay(Math.min(pollMs, deadline - now()));
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
    display: admission.display,
  });
}

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
  kind: "automated" | "manual";
  alive: boolean;
  overdue: boolean;
};

export interface DesktopSlotStatus {
  slots: { index: number; holder?: HolderStatus }[];
  holders: HolderStatus[];
  waiters: QueueTicket[];
  lastGateStart?: string;
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
  const count = Math.max(1, ...[...taken].map((index) => index + 1));
  return {
    slots: Array.from({ length: count }, (_, index) => ({
      index,
      holder: holders.find((holder) => holder.slots.includes(index)),
    })),
    holders,
    waiters: await liveTickets(dir, undefined, false),
    lastGateStart: lastGateStart(dir)?.toString(),
  };
}

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
      `Desktop Slot: ${options.target} names no holder${holders.length > 0 ? ` (${holders.map((holder) => `pid ${holder.pid}, token ${holder.token}`).join("; ")})` : "; the slot is free"}.`,
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
  await endOrphanGroup(owner, { ownPgid: self.pgid, killAfterMs, log });
  await takeOver(dir, owner);
  return owner;
}

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
  const exclusive = owner.exclusive ? ", an Exclusive Hold" : "";
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

export function reportDesktopProgress(what: string): void {
  const token = process.env[DESKTOP_SLOT_ENV];
  if (token) renewDesktopSlot(token, what);
}

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

function describeHolders(holders: readonly SlotOwner[], now: number): string {
  return holders
    .map((holder) => `  - ${describeHolder(holder, now)}`)
    .join("\n");
}

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
  const held = heldBy(holders) ?? "the slot is free for the head of the queue.";
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
  gate?: string;
}): string {
  const by =
    heldBy(holders) ??
    (gate
      ? `this run held a slot, but the Memory Gate stayed closed: ${gate}.`
      : "the slot changed hands as the deadline passed.");
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

function slotIndices(names: readonly string[]): number[] {
  return names
    .filter((name) => name.startsWith("slot-"))
    .map((name) => Number(name.slice("slot-".length)))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .toSorted((a, b) => a - b);
}

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

async function writeAtomic(path: string, text: string): Promise<void> {
  const draft = `${path}.${randomUUID()}.draft`;
  await writeFile(draft, text);
  await rename(draft, path);
}

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

export async function holdDesktopMutex(
  name: string,
  options: { dir?: string; staleMs?: number } = {},
): Promise<Disposable> {
  const dir = options.dir ?? desktopStateDir();
  await mkdir(dir, { recursive: true });
  return await mutex(join(dir, name), options.staleMs ?? 30 * SECOND, 20);
}

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

async function tryClaim(
  dir: string,
  owner: Omit<SlotOwner, "slots">,
  taken: ReadonlySet<number>,
): Promise<SlotOwner | undefined> {
  if (taken.size > 0) return undefined;
  try {
    await mkdir(slotPath(dir, 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  const claimed = { ...owner, slots: [0] };
  await writeOwner(dir, claimed);
  return claimed;
}

async function writeOwner(dir: string, owner: SlotOwner): Promise<void> {
  for (const index of owner.slots) {
    await writeAtomic(ownerPath(dir, index), JSON.stringify(owner));
  }
}

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
  holders: SlotOwner[];
  orphans: number[];
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

const PS_LINE = regex("^\\s*(?<pgid>\\d+)\\s+(?<start>.+?)\\s*$");

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

export interface ProcessRecord {
  pid: number;
  processStart?: string;
}

export async function processRecord(
  pid: number = process.pid,
): Promise<ProcessRecord> {
  const { start } = await processInfo(pid);
  return start === undefined ? { pid } : { pid, processStart: start };
}

export async function isHolderAlive(record: ProcessRecord): Promise<boolean> {
  if (!isAlive(record.pid)) return false;
  if (record.processStart === undefined) return true;
  const { start } = await processInfo(record.pid);
  return start === undefined || start === record.processStart;
}

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

async function takeOver(dir: string, seen: SlotOwner): Promise<void> {
  for (const index of seen.slots) await takeOverSlot(dir, index, seen.token);
}

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
    display,
  }: {
    signals: boolean;
    gateAdmitted: boolean;
    tokenEnv: string;
    display: boolean;
  },
): DesktopSlot {
  const { dir } = watch;
  let released = false;
  const stopLease = watchLease(watch, owner, { reused: false });
  const awake = display ? holdDisplayAwake() : undefined;
  const onSignal = (signal: NodeJS.Signals) => {
    release();
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  function release() {
    if (released) return;
    released = true;
    stopLease();
    awake?.release();
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
