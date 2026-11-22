import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DESKTOP_DIR_ENV,
  EXIT_ADMISSION_BLOCKED,
  MEMORY_GATE_ADMITTED_ENV,
  MEMORY_GATE_ENV,
} from "@zotlit/config/memory-gate";

import type { DesktopState } from "./__fixtures__/desktop-states.ts";
import { DESKTOP_STATES } from "./__fixtures__/desktop-states.ts";
import {
  DESKTOP_PAINT_ENV,
  paintVerdict,
  parseDisplays,
  parseLocked,
  readDesktopPaint,
} from "./desktop-paint.ts";
import { DESKTOP_SLOT_ENV, DESKTOP_SLOTS_ENV } from "./desktop-slot.ts";

const desktopOnly = describe.skipIf(process.env.GITHUB_ACTIONS === "true");

const UID = 501;

describe("the paint verdict", () => {
  it.each<[DesktopState, string | undefined]>([
    ["normal", undefined],
    [
      "lid closed",
      "no display is awake (Color LCD: asleep), and the screen is locked",
    ],
    ["display asleep", "no display is awake (Color LCD: asleep)"],
    ["screen locked", "the screen is locked"],
    ["external display only", undefined],
    ["another user locked", undefined],
  ])("reads %s", (state, machine) => {
    const { displays, sessions } = DESKTOP_STATES[state](UID);
    expect(
      paintVerdict({
        displays: parseDisplays(displays),
        locked: parseLocked(sessions, UID),
      }),
    ).toEqual(
      machine === undefined
        ? { state: "paints" }
        : { state: "cannot paint", machine },
    );
  });
});

describe("the probe on another platform", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  afterEach(() => {
    Object.defineProperty(process, "platform", platform);
  });

  it("answers unknown, so the run goes on", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(await readDesktopPaint()).toEqual({
      state: "unknown",
      why: "no probe on linux",
    });
  });
});

const OS = new URL("./__fixtures__/desktop-paint-os.ts", import.meta.url).href;
const SLOT = new URL("./desktop-slot.ts", import.meta.url).href;
const PAINT = new URL("./desktop-paint.ts", import.meta.url).href;
const SLOT_CLI = new URL("../scripts/desktop-slot.ts", import.meta.url)
  .pathname;

let root: string;
let stateDir: string;
let desktop: string;
let caffeinate: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "desktop-paint-"));
  stateDir = join(root, "state");
  desktop = join(root, "desktop");
  caffeinate = join(root, "caffeinate");
  await writeFile(caffeinate, "");
});
afterEach(async () => {
  for (const pid of await assertions()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone already.
    }
  }
  await rm(root, { recursive: true, force: true });
});

async function setDesktop(state: DesktopState): Promise<void> {
  await writeFile(desktop, state);
}

async function assertions(): Promise<number[]> {
  const text = await readFile(caffeinate, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => Number(line.split(" ")[0]));
}

async function node(
  args: string[],
  { onLine }: { onLine?: (line: string) => void } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", OS, ...args], {
    env: {
      ...process.env,
      [DESKTOP_DIR_ENV]: stateDir,
      [DESKTOP_SLOTS_ENV]: "1",
      [DESKTOP_SLOT_ENV]: "",
      [MEMORY_GATE_ENV]: "off",
      [MEMORY_GATE_ADMITTED_ENV]: "",
      [DESKTOP_PAINT_ENV]: "",
      ZOTLIT_TEST_DESKTOP: desktop,
      ZOTLIT_TEST_CAFFEINATE: caffeinate,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += String(chunk);
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      onLine?.(line);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));
  const [code] = (await once(child, "exit")) as [number | null];
  return { code, stdout, stderr };
}

const script = (body: string) => [
  "--input-type=module",
  "-e",
  `const slot = await import(${JSON.stringify(SLOT)});
const paint = await import(${JSON.stringify(PAINT)});
${body}`,
];

const AUTOMATED = `await slot.acquireDesktopSlotOrExit({ command: "pnpm e2e", silenceMs: 60_000, pollMs: 10, log: (message) => console.error(message) })`;

desktopOnly("desktop admission", () => {
  it("refuses an automated run with exit 75 and names the machine state, before it joins the queue", async () => {
    await setDesktop("lid closed");
    const { code, stdout, stderr } = await node(
      script(`await ${AUTOMATED};\nconsole.log("admitted");`),
    );
    expect(code).toBe(EXIT_ADMISSION_BLOCKED);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "macOS cannot paint one now: no display is awake (Color LCD: asleep), and the screen is locked. Open the lid or connect a display, wake the display, and unlock the session",
    );
    expect(stderr).toContain("not as a test failure. Exit 75.");
    const left = await readdir(stateDir).catch(() => []);
    expect(left.filter((name) => name.startsWith("slot-"))).toEqual([]);
  });

  it("admits an automated run while the desktop paints, and holds the display awake until release", async () => {
    await setDesktop("normal");
    const { code, stdout } = await node(
      script(`const held = ${AUTOMATED};
console.log("admitted " + process.pid);
await new Promise((resolve) => setTimeout(resolve, 200));
held.release();`),
    );
    expect(code).toBe(0);
    const [, pid] = /admitted (\d+)/.exec(stdout)!;
    const lines = (await readFile(caffeinate, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^\\d+ -d -i -w ${pid}$`));
    const [assertion] = await assertions();
    await expect.poll(() => isAlive(assertion!)).toBe(false);
  });

  it("starts a manual hold with a warning, since its command may need no window", async () => {
    await setDesktop("screen locked");
    const { code, stdout, stderr } = await node([
      SLOT_CLI,
      "run",
      "--",
      process.execPath,
      "-e",
      'console.log("ran")',
    ]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("ran");
    expect(stderr).toContain(
      "Desktop: warning: macOS cannot paint a window now: the screen is locked.",
    );
  });

  it("names the machine state after a failed run when the display went dark during it", async () => {
    await setDesktop("normal");
    const { code, stdout } = await node(
      script(`const { readFileSync } = await import("node:fs");
const held = ${AUTOMATED};
console.log("admitted");
while (readFileSync(${JSON.stringify(desktop)}, "utf8") !== "lid closed") {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
console.log(String(await paint.paintAfterFailure()));
held.release();`),
      {
        onLine: (line) => {
          if (line === "admitted") void setDesktop("lid closed");
        },
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain(
      "Desktop: at the end of this failed run macOS cannot paint a window: no display is awake (Color LCD: asleep), and the screen is locked. Cases that need a painted window fail for that reason, not for the code.",
    );
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
