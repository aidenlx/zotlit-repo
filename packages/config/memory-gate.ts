import { regex } from "arkregex";
import { Clock, Config, Effect, Schema } from "effect";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DESKTOP_DIR_ENV = "ZOTLIT_DESKTOP_DIR";
export const MEMORY_GATE_ENV = "ZOTLIT_MEMORY_GATE";
export const MEMORY_GATE_ADMITTED_ENV = "ZOTLIT_MEMORY_GATE_ADMITTED";

export const DESKTOP_WAIT_ENV = "ZOTLIT_DESKTOP_WAIT";
export const EXIT_ADMISSION_BLOCKED = 75;
export const ADMISSION_DEADLINE_MS = 9 * 60_000;

const MAX_COMMIT = 1.25;
const MAX_CGROUP_USAGE = 0.9;
const STALE_LOCK_MS = 10_000;
const LAST_START = "last-start";
const MEMORY_QUEUE = "memory-queue";
const MEMORY_RUNNING = "memory-running";

interface MemoryWaiter {
  token: string;
  pid: number;
  deadline: number;
  path?: string;
}

export function desktopStateDir(): string {
  const override = process.env[DESKTOP_DIR_ENV];
  if (override) return override;
  return defaultDesktopStateDir();
}

function defaultDesktopStateDir(): string {
  return process.platform === "win32"
    ? join(tmpdir(), "zotlit-desktop")
    : `/tmp/zotlit-desktop-${process.getuid?.()}`;
}

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, min: 60_000, h: 3_600_000 };
const DURATION = regex("^(?<count>\\d+(?:\\.\\d+)?)(?<unit>ms|s|min|m|h)$");

export function parseDuration(text: string): number {
  const match = DURATION.exec(text.trim());
  if (!match) {
    throw new Error(
      `"${text}" is not a duration; write it as 300ms, 90s, 20m, or 2h.`,
    );
  }
  const { count, unit } = match.groups;
  return Math.round(Number(count) * UNIT_MS[unit]);
}

export function admissionWaitMs(): number {
  const wait = process.env[DESKTOP_WAIT_ENV];
  return wait ? parseDuration(wait) : ADMISSION_DEADLINE_MS;
}

export function macosVerdict(level: number): string | undefined {
  if (level === 1) return undefined;
  return `macOS memory pressure is ${level === 2 ? "warning" : level === 4 ? "critical" : `level ${level}`}`;
}

function commitVerdict(committed: number, physical: number) {
  const ratio = committed / physical;
  return ratio <= MAX_COMMIT
    ? undefined
    : `memory committed at ${ratio.toFixed(2)}x physical, above ${MAX_COMMIT}x`;
}

export function windowsVerdict(os: {
  TotalVisibleMemorySize: number;
  TotalVirtualMemorySize: number;
  FreeVirtualMemory: number;
}): string | undefined {
  return commitVerdict(
    os.TotalVirtualMemorySize - os.FreeVirtualMemory,
    os.TotalVisibleMemorySize,
  );
}

export function linuxVerdict(meminfo: string): string | undefined {
  const sizes = new Map(
    meminfo.split("\n").map((line) => {
      const [name = "", size = ""] = line.split(":");
      return [name, Number.parseInt(size.trim(), 10)] as const;
    }),
  );
  const kib = (name: string) => sizes.get(name) || 0;
  const total = kib("MemTotal");
  return commitVerdict(
    total - kib("MemAvailable") + kib("SwapTotal") - kib("SwapFree"),
    total,
  );
}

export function linuxCgroupVerdict(
  limitText: string,
  usageText: string,
): { reason?: string } | undefined {
  const limit = Number(limitText.trim());
  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  const ratio = Number(usageText.trim()) / limit;
  return ratio > MAX_CGROUP_USAGE
    ? {
        reason: `cgroup memory use is ${Math.round(ratio * 100)}% of its limit`,
      }
    : {};
}

function readCgroupMemory(file: string): string {
  try {
    return readFileSync(join("/sys/fs/cgroup", file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

class MemoryGateIoError extends Schema.TaggedError<
  MemoryGateIoError,
  { readonly brand: unique symbol }
>()("MemoryGateIoError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

function io<A>(operation: string, body: () => A) {
  return Effect.try({
    try: body,
    catch: (cause) => new MemoryGateIoError({ operation, cause }),
  });
}

function run(command: string, args: string[]) {
  return Effect.callback<string, MemoryGateIoError>((resume, signal) => {
    execFile(command, args, { encoding: "utf8", signal }, (cause, stdout) => {
      resume(
        cause
          ? Effect.fail(new MemoryGateIoError({ operation: command, cause }))
          : Effect.succeed(stdout),
      );
    });
  });
}

const memoryVerdict = Effect.fnUntraced(function* () {
  if (process.platform === "darwin")
    return macosVerdict(
      Number(
        yield* run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
      ),
    );
  if (process.platform === "win32") {
    const output = yield* run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,TotalVirtualMemorySize,FreeVirtualMemory | ConvertTo-Json",
    ]);
    return yield* io("read Windows memory", () =>
      windowsVerdict(JSON.parse(output)),
    );
  }
  return yield* io("read Linux memory", () => {
    const cgroup = linuxCgroupVerdict(
      readCgroupMemory("memory.max"),
      readCgroupMemory("memory.current"),
    );
    return cgroup
      ? cgroup.reason
      : linuxVerdict(readFileSync("/proc/meminfo", "utf8"));
  });
});

export function lastGateStart(
  dir: string = desktopStateDir(),
): Temporal.Instant | undefined {
  try {
    return Temporal.Instant.from(
      readFileSync(join(dir, LAST_START), "utf8").trim(),
    );
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function recordAdmittedRun(dir: string, pid: number = process.pid) {
  const running = join(dir, MEMORY_RUNNING);
  mkdirSync(running, { recursive: true });
  const marker = join(running, String(pid));
  writeFileSync(marker, "");
  if (pid === process.pid)
    process.once("exit", () => rmSync(marker, { force: true }));
}

function otherAdmittedRuns(dir: string): number {
  const running = join(dir, MEMORY_RUNNING);
  let count = 0;
  for (const name of readdirSync(running, { encoding: "utf8" })) {
    const pid = Number(name);
    if (pid === process.pid) continue;
    if (isAlive(pid)) count++;
    else rmSync(join(running, name), { force: true });
  }
  return count;
}

function queueVerdict(dir: string, waiter: MemoryWaiter, now: number) {
  const queue = join(dir, MEMORY_QUEUE);
  mkdirSync(queue, { recursive: true });
  if (!waiter.path) {
    const sequence = join(dir, `${MEMORY_QUEUE}.seq`);
    const last =
      Number(readFileSync(sequence, { encoding: "utf8", flag: "a+" })) || 0;
    const seq = last + 1;
    writeFileSync(`${sequence}.tmp`, String(seq));
    renameSync(`${sequence}.tmp`, sequence);
    waiter.path = join(queue, `${seq}-${waiter.token}.json`);
    const draft = `${waiter.path}.tmp`;
    writeFileSync(draft, JSON.stringify(waiter));
    renameSync(draft, waiter.path);
  }
  const tickets = readdirSync(queue)
    .filter((name) => name.endsWith(".json"))
    .toSorted((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
  for (const name of tickets) {
    const path = join(queue, name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const ticket = JSON.parse(text) as MemoryWaiter;
    if (ticket.token === waiter.token) break;
    if (!isAlive(ticket.pid) || now >= ticket.deadline) {
      rmSync(path, { force: true });
      continue;
    }
    return `waiting behind pid ${ticket.pid} at the Memory Gate`;
  }
  return undefined;
}

interface StartVerdict {
  wait?: string;
  warning?: string;
}

const tryStart = Effect.fnUntraced(function* (
  dir: string,
  waiter: MemoryWaiter,
) {
  const lock = join(dir, `${LAST_START}.lock`);
  const now = yield* Clock.currentTimeMillis;
  return yield* Effect.acquireUseRelease(
    io("claim start lock", () => {
      try {
        mkdirSync(lock);
        return true;
      } catch {
        const changed = statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
        if (changed !== undefined && now - changed > STALE_LOCK_MS)
          rmSync(lock, { recursive: true, force: true });
        return false;
      }
    }),
    Effect.fnUntraced(function* (claimed): Effect.fn.Return<
      StartVerdict,
      MemoryGateIoError
    > {
      if (!claimed) return { wait: "another run is starting" };
      const queued = yield* io("read memory queue", () =>
        queueVerdict(dir, waiter, now),
      );
      if (queued) return { wait: queued };
      const pressure = yield* memoryVerdict();
      if (pressure) {
        const running = yield* io("read admitted runs", () => {
          mkdirSync(join(dir, MEMORY_RUNNING), { recursive: true });
          return otherAdmittedRuns(dir);
        });
        if (running > 0)
          return {
            wait: `${pressure}, and ${running === 1 ? "1 admitted run is" : `${running} admitted runs are`} still running`,
          };
      }
      const started = yield* Clock.currentTimeMillis;
      yield* io("record admitted start", () => {
        writeFileSync(
          join(dir, LAST_START),
          Temporal.Instant.fromEpochMilliseconds(started).toString(),
        );
        recordAdmittedRun(dir);
        rmSync(waiter.path!, { force: true });
      });
      return pressure
        ? {
            warning: `${pressure}, with no other admitted run to wait for; this run starts`,
          }
        : {};
    }),
    (claimed) =>
      Effect.sync(() => {
        if (claimed) rmSync(lock, { recursive: true, force: true });
      }),
  );
});

export class MemoryGateClosedError extends Error {
  readonly _tag = "MemoryGateClosedError";
  readonly reason: string;
  constructor(reason: string) {
    super(`Memory Gate: still closed at the Admission Deadline: ${reason}.`);
    this.reason = reason;
  }
}

export interface MemoryGateOptions {
  dir?: string;
  deadline?: number;
  pollMs?: number;
  log?: (message: string) => void;
}

export const passMemoryGate = Effect.fnUntraced(function* (
  options: MemoryGateOptions = {},
) {
  const gate = yield* Config.String(MEMORY_GATE_ENV).pipe(
    Config.withDefault(""),
  );
  if (gate === "off") return false;
  const admitted = yield* Config.String(MEMORY_GATE_ADMITTED_ENV).pipe(
    Config.withDefault(""),
  );
  if (admitted) return false;
  const configuredDir = yield* Config.String(DESKTOP_DIR_ENV).pipe(
    Config.withDefault(""),
  );
  const dir = options.dir ?? (configuredDir || defaultDesktopStateDir());
  const log = options.log ?? ((message: string) => console.error(message));
  const waitText = yield* Config.String(DESKTOP_WAIT_ENV).pipe(
    Config.withDefault(""),
  );
  const deadline =
    options.deadline ??
    (yield* Clock.currentTimeMillis) +
      (waitText ? parseDuration(waitText) : ADMISSION_DEADLINE_MS);
  return yield* Effect.acquireUseRelease(
    io("create memory waiter", () => {
      mkdirSync(dir, { recursive: true });
      const waiter: MemoryWaiter = {
        token: randomUUID(),
        pid: process.pid,
        deadline,
      };
      return waiter;
    }),
    Effect.fnUntraced(function* (waiter) {
      let reported: string | undefined;
      let wait: string | undefined;
      for (;;) {
        if ((yield* Clock.currentTimeMillis) >= deadline)
          return yield* Effect.fail(
            new MemoryGateClosedError(wait ?? "Admission Deadline passed"),
          );
        const verdict = yield* tryStart(dir, waiter);
        wait = verdict.wait;
        if (!wait) {
          if (verdict.warning) log(`Memory Gate: warning: ${verdict.warning}.`);
          return true;
        }
        const kind = wait.replace(/[\d.]+x physical|\d+ admitted runs?/, "");
        if (kind !== reported) log(`Memory Gate: waiting: ${wait}`);
        reported = kind;
        const left = deadline - (yield* Clock.currentTimeMillis);
        yield* Effect.sleep(Math.min(options.pollMs ?? 100, Math.max(0, left)));
      }
    }),
    (waiter) =>
      Effect.sync(() => {
        if (waiter.path) rmSync(waiter.path, { force: true });
      }),
  );
});

export const passMemoryGateOrExit = (options: MemoryGateOptions = {}) =>
  passMemoryGate(options).pipe(
    Effect.catchTag("MemoryGateClosedError", (error) =>
      Effect.sync(() => {
        console.error(
          `${error.message}\nReport this as blocked by the Memory Gate, not as a test failure. Exit ${EXIT_ADMISSION_BLOCKED}.`,
        );
        process.exit(EXIT_ADMISSION_BLOCKED);
      }),
    ),
  );
