// Whether the desktop can paint a window now: one display is awake and the
// user's session is not locked. Without both, desktop Obsidian draws nothing,
// and the End-to-end Run cases that read a painted PDF page fail with no fault
// in the code. Desktop admission (lib/desktop-slot.ts) asks before a run
// starts, and a run that fails asks again, so its result names the cause.
//
// macOS answers from two commands with stable, structured output:
//
//   system_profiler SPDisplaysDataType -json   each display, with
//                                              `spdisplays_online` and
//                                              `spdisplays_asleep`
//   ioreg -n Root -d1 -a | plutil -extract IOConsoleUsers json
//                                              each console session, with
//                                              `CGSSessionScreenIsLocked`
//
// Other platforms answer "unknown", and the run goes on.
//
// While a desktop run holds its admission, a `caffeinate -d -i -w <pid>`
// assertion keeps the display and the system awake, so an idle timer cannot
// put the display to sleep in the middle of the run. No assertion opens a lid
// or unlocks a session; those stay with the person at the machine.

import { execFile, spawn } from "node:child_process";

import { EXIT_ADMISSION_BLOCKED } from "@zotlit/config/memory-gate";

/** `off` skips the probe and the display assertion. */
export const DESKTOP_PAINT_ENV = "ZOTLIT_DESKTOP_PAINT";

/** What macOS reports about one display. */
interface DisplayReading {
  name: string;
  online: boolean;
  asleep: boolean;
}

/** What the probe reads from the system. */
interface DesktopReading {
  displays: DisplayReading[];
  /** The screen of this user's session is locked. */
  locked: boolean;
}

export type DesktopPaint =
  | { state: "paints" }
  /** `machine` says what keeps the desktop from painting. */
  | { state: "cannot paint"; machine: string }
  /** No answer on this platform, or the probe failed; the run goes on. */
  | { state: "unknown"; why: string };

/** What a person or an agent does so that the desktop paints again. */
const REMEDY =
  "Open the lid or connect a display, wake the display, and unlock the session";

/**
 * The displays in the output of `system_profiler SPDisplaysDataType -json`.
 * @throws {Error} when the text is not that JSON.
 */
export function parseDisplays(json: string): DisplayReading[] {
  const report = JSON.parse(json) as {
    SPDisplaysDataType?: {
      spdisplays_ndrvs?: {
        _name?: string;
        spdisplays_online?: string;
        spdisplays_asleep?: string;
      }[];
    }[];
  };
  if (!Array.isArray(report.SPDisplaysDataType)) {
    throw new Error("system_profiler printed no SPDisplaysDataType list");
  }
  return report.SPDisplaysDataType.flatMap((gpu) =>
    (gpu.spdisplays_ndrvs ?? []).map((display) => ({
      name: display._name ?? "a display",
      online: display.spdisplays_online !== "spdisplays_no",
      asleep: display.spdisplays_asleep === "spdisplays_yes",
    })),
  );
}

/**
 * Whether the session of user `uid` has a locked screen, from the
 * `IOConsoleUsers` list as JSON. A session that is not listed is not locked.
 * @throws {Error} when the text is not a JSON list.
 */
export function parseLocked(json: string, uid: number): boolean {
  const sessions = JSON.parse(json) as {
    kCGSSessionUserIDKey?: number;
    CGSSessionScreenIsLocked?: boolean;
  }[];
  if (!Array.isArray(sessions)) {
    throw new Error("ioreg printed no IOConsoleUsers list");
  }
  return sessions.some(
    (session) =>
      session.kCGSSessionUserIDKey === uid &&
      session.CGSSessionScreenIsLocked === true,
  );
}

export function paintVerdict({
  displays,
  locked,
}: DesktopReading): DesktopPaint {
  const problems: string[] = [];
  if (!displays.some((display) => display.online && !display.asleep)) {
    problems.push(
      displays.length === 0
        ? "macOS reports no display"
        : `no display is awake (${displays.map((display) => `${display.name}: ${display.online ? "asleep" : "offline"}`).join(", ")})`,
    );
  }
  if (locked) problems.push("the screen is locked");
  return problems.length === 0
    ? { state: "paints" }
    : { state: "cannot paint", machine: problems.join(", and ") };
}

function run(command: string, args: string[], input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`${command}: ${error.message}`, { cause: error }));
        } else resolve(stdout);
      },
    );
    child.stdin?.end(input);
  });
}

/** Ask the system whether the desktop can paint a window now. */
export async function readDesktopPaint(): Promise<DesktopPaint> {
  if (process.env[DESKTOP_PAINT_ENV] === "off") {
    return { state: "unknown", why: `${DESKTOP_PAINT_ENV}=off` };
  }
  if (process.platform !== "darwin") {
    return { state: "unknown", why: `no probe on ${process.platform}` };
  }
  try {
    const [displays, registry] = await Promise.all([
      run("system_profiler", ["SPDisplaysDataType", "-json"]),
      run("ioreg", ["-n", "Root", "-d1", "-a"]),
    ]);
    const sessions = await run(
      "plutil",
      ["-extract", "IOConsoleUsers", "json", "-o", "-", "-"],
      registry,
    );
    return paintVerdict({
      displays: parseDisplays(displays),
      locked: parseLocked(sessions, process.getuid?.() ?? -1),
    });
  } catch (error) {
    return {
      state: "unknown",
      why: `the probe failed: ${(error as Error).message}`,
    };
  }
}

/** The refusal of a run that needs a painted window, before it starts. */
export function cannotPaintMessage(machine: string): string {
  return `Desktop: this run needs a window that macOS paints, and macOS cannot paint one now: ${machine}. ${REMEDY}, then run the command again. Nothing was tested. Report this as blocked at admission, not as a test failure. Exit ${EXIT_ADMISSION_BLOCKED}.`;
}

/**
 * For a tool whose desktop run starts late, such as `pnpm verify --release`:
 * when the desktop cannot paint, print the refusal and exit
 * EXIT_ADMISSION_BLOCKED before the long work starts.
 */
export async function exitUnlessDesktopPaints(): Promise<void> {
  const paint = await readDesktopPaint();
  if (paint.state !== "cannot paint") return;
  console.error(cannotPaintMessage(paint.machine));
  process.exit(EXIT_ADMISSION_BLOCKED);
}

/** The warning of a manual hold, which may not need a painted window. */
export function cannotPaintWarning(machine: string): string {
  return `Desktop: warning: macOS cannot paint a window now: ${machine}. Obsidian draws nothing until then. ${REMEDY} if this session needs a window.`;
}

/**
 * The line a failed run prints when the desktop cannot paint at its end;
 * undefined while it paints or the answer is unknown.
 */
export async function paintAfterFailure(): Promise<string | undefined> {
  const paint = await readDesktopPaint();
  if (paint.state !== "cannot paint") return undefined;
  return `Desktop: at the end of this failed run macOS cannot paint a window: ${paint.machine}. Cases that need a painted window fail for that reason, not for the code. ${REMEDY}, then run it again.`;
}

/**
 * Keep the display and the system awake until `release` or the exit of this
 * process: `caffeinate -d -i -w <pid>`, on macOS only. The `-w` makes the
 * assertion end with this process, also when it is killed.
 */
export function holdDisplayAwake(): { release: () => void } {
  if (
    process.platform !== "darwin" ||
    process.env[DESKTOP_PAINT_ENV] === "off"
  ) {
    return { release: () => {} };
  }
  const child = spawn("caffeinate", ["-d", "-i", "-w", String(process.pid)], {
    stdio: "ignore",
  });
  // No caffeinate: the run goes on without the assertion.
  child.on("error", () => {});
  child.unref();
  return {
    release: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}
