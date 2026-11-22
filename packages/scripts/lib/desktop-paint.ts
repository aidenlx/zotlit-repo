import { execFile, spawn } from "node:child_process";

import { EXIT_ADMISSION_BLOCKED } from "@zotlit/config/memory-gate";

export const DESKTOP_PAINT_ENV = "ZOTLIT_DESKTOP_PAINT";

interface DisplayReading {
  name: string;
  online: boolean;
  asleep: boolean;
}

interface DesktopReading {
  displays: DisplayReading[];
  locked: boolean;
}

export type DesktopPaint =
  | { state: "paints" }
  | { state: "cannot paint"; machine: string }
  | { state: "unknown"; why: string };

const REMEDY =
  "Open the lid or connect a display, wake the display, and unlock the session";

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

export function cannotPaintMessage(machine: string): string {
  return `Desktop: this run needs a window that macOS paints, and macOS cannot paint one now: ${machine}. ${REMEDY}, then run the command again. Nothing was tested. Report this as blocked at admission, not as a test failure. Exit ${EXIT_ADMISSION_BLOCKED}.`;
}

export async function exitUnlessDesktopPaints(): Promise<void> {
  const paint = await readDesktopPaint();
  if (paint.state !== "cannot paint") return;
  console.error(cannotPaintMessage(paint.machine));
  process.exit(EXIT_ADMISSION_BLOCKED);
}

export function cannotPaintWarning(machine: string): string {
  return `Desktop: warning: macOS cannot paint a window now: ${machine}. Obsidian draws nothing until then. ${REMEDY} if this session needs a window.`;
}

export async function paintAfterFailure(): Promise<string | undefined> {
  const paint = await readDesktopPaint();
  if (paint.state !== "cannot paint") return undefined;
  return `Desktop: at the end of this failed run macOS cannot paint a window: ${paint.machine}. Cases that need a painted window fail for that reason, not for the code. ${REMEDY}, then run it again.`;
}

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
  child.on("error", () => {});
  child.unref();
  return {
    release: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}
