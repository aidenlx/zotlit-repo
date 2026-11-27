import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DESKTOP_DIR_ENV,
  MEMORY_GATE_ADMITTED_ENV,
  MEMORY_GATE_ENV,
} from "@zotlit/config/memory-gate";

import { DESKTOP_PAINT_ENV } from "./desktop-paint.ts";
import {
  acquireDesktopSlot,
  ADMISSION_DEADLINE_MS,
  DESKTOP_SLOT_ENV,
  DesktopSlotBlockedError,
  EVICTION_GRACE_MS,
  EXIT_ADMISSION_BLOCKED,
  EXIT_LEASE_ENDED,
  holdDesktopMutex,
  KILL_AFTER_MS,
  NOTICE_MS,
  readDesktopSlotStatus,
} from "./desktop-slot.ts";

const desktopOnly = describe.skipIf(process.env.GITHUB_ACTIONS === "true");

const MINUTE = 60_000;
const ENV_KEYS = [
  DESKTOP_DIR_ENV,
  DESKTOP_SLOT_ENV,
  MEMORY_GATE_ENV,
  MEMORY_GATE_ADMITTED_ENV,
  DESKTOP_PAINT_ENV,
];
const saved = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const spawned = new Set<ChildProcess>();
const detachedChildren = new WeakSet<ChildProcess>();
const strays = new Set<number>();

async function end(each: ChildProcess): Promise<void> {
  if (each.exitCode !== null || each.signalCode !== null) return;
  const exited = once(each, "exit");
  try {
    process.kill(
      detachedChildren.has(each) ? -each.pid! : each.pid!,
      "SIGKILL",
    );
  } catch {
    // Gone already.
  }
  await exited;
}

function track(
  [command, ...args]: readonly [string, ...string[]],
  { env, detached = false }: { env: NodeJS.ProcessEnv; detached?: boolean },
): ChildProcess {
  const each = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached,
  });
  spawned.add(each);
  if (detached) detachedChildren.add(each);
  return each;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "desktop-slot-"));
  process.env[DESKTOP_DIR_ENV] = dir;
  process.env[MEMORY_GATE_ENV] = "off";
  process.env[DESKTOP_PAINT_ENV] = "off";
  delete process.env[DESKTOP_SLOT_ENV];
  delete process.env[MEMORY_GATE_ADMITTED_ENV];
});
afterEach(async () => {
  await Promise.all([...spawned].map(end));
  spawned.clear();
  for (const pid of strays) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // Gone already.
      }
    }
  }
  strays.clear();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await rm(dir, { recursive: true, force: true });
});

const IN_TEST = {
  silenceMs: 30 * MINUTE,
  pollMs: 10,
  onLeaseEnd: () => {},
  log: () => {},
};

const MODULE = new URL("./desktop-slot.ts", import.meta.url).href;

function child(
  body: string,
  env: NodeJS.ProcessEnv = {},
  detached = false,
): ChildProcess {
  const code = `const slot = await import(${JSON.stringify(MODULE)});\n${body}`;
  return track([process.execPath, "--input-type=module", "-e", code], {
    env,
    detached,
  });
}

async function printed(
  process: ChildProcess,
  line: string | RegExp,
): Promise<void> {
  const matches = (each: string) =>
    typeof line === "string" ? each === line : line.test(each);
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += String(chunk);
      if (!output.split("\n").some(matches)) return;
      process.stdout!.off("data", onData);
      process.stdout!.resume();
      resolve();
    };
    process.stdout!.on("data", onData);
    process.stdout!.once("end", () =>
      reject(new Error(`exited before printing ${String(line)}: ${output}`)),
    );
  });
}

function collect(process: ChildProcess): () => string {
  let output = "";
  process.stdout!.on("data", (chunk: Buffer) => (output += String(chunk)));
  return () => output;
}

async function exists(file: string): Promise<boolean> {
  return await stat(file).then(
    () => true,
    () => false,
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && isAlive(pid); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (isAlive(pid)) throw new Error(`pid ${pid} is still running`);
}

async function deadPid(): Promise<number> {
  const gone = spawn(process.execPath, ["-e", ""]);
  await once(gone, "exit");
  return gone.pid!;
}

const HOLD = `await slot.acquireDesktopSlot({ command: "holder", silenceMs: 30 * 60_000, pollMs: 10 });
console.log("held");
setInterval(() => {}, 1000);`;

function holderIn(
  worktree: string,
  {
    detached = false,
    ...options
  }: {
    command?: string;
    silenceMs?: number;
    manual?: boolean;
    detached?: boolean;
  } = {},
): ChildProcess {
  return child(
    `await slot.acquireDesktopSlot({ command: "holder", silenceMs: 30 * 60_000, pollMs: 10, worktree: ${JSON.stringify(worktree)}, log: (message) => console.log(message), ...${JSON.stringify(options)} });
console.log("held");
setInterval(() => {}, 1000);`,
    {
      [DESKTOP_SLOT_ENV]: "",
    },
    detached,
  );
}

async function blocked(options: {
  worktree: string;
  now?: () => number;
}): Promise<DesktopSlotBlockedError> {
  const error = await acquireDesktopSlot({
    ...IN_TEST,
    ...options,
    waitMs: 300,
  }).then(
    (slot) => slot.release(),
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(DesktopSlotBlockedError);
  return error as DesktopSlotBlockedError;
}

function waiter(
  name: string,
  trace: string,
  { pollMs = 10, ...options }: { pollMs?: number; worktree?: string } = {},
): ChildProcess {
  return child(
    `const { appendFileSync } = await import("node:fs");
const held = await slot.acquireDesktopSlot({ command: ${JSON.stringify(name)}, silenceMs: 60_000, pollMs: ${pollMs}, log: (message) => console.log(message), ...${JSON.stringify(options)} });
appendFileSync(${JSON.stringify(trace)}, ${JSON.stringify(name)} + "\\n");
held.release();`,
    { [DESKTOP_SLOT_ENV]: "" },
  );
}

const OWNER = () => join(dir, "slot-0", "owner.json");

async function holderPids(): Promise<number[]> {
  return (await readDesktopSlotStatus()).holders.map((holder) => holder.pid);
}

const SCRIPT = new URL("../scripts/desktop-slot.ts", import.meta.url).pathname;

function start(...args: string[]): ChildProcess {
  return track([process.execPath, SCRIPT, ...args], {
    env: { [DESKTOP_SLOT_ENV]: "" },
  });
}

desktopOnly("a free slot", () => {
  it("is taken at once, records its holder and Lease, and is gone after release", async () => {
    const slot = await acquireDesktopSlot({
      ...IN_TEST,
      command: "pnpm e2e",
      worktree: "/work/tree",
    });
    const [holder] = (await readDesktopSlotStatus()).holders;
    expect(holder).toMatchObject({
      pid: process.pid,
      command: "pnpm e2e",
      worktree: "/work/tree",
      kind: "automated",
      silenceMs: 30 * MINUTE,
      progress: { what: "admitted" },
    });
    expect(
      Temporal.Instant.from(holder!.leaseEndsAt!)
        .since(Temporal.Instant.from(holder!.admittedAt))
        .total("minutes"),
    ).toBe(30);
    expect(process.env[DESKTOP_SLOT_ENV]).toBe(holder!.token);
    slot.release();
    expect((await readDesktopSlotStatus()).holders).toEqual([]);
    expect(process.env[DESKTOP_SLOT_ENV]).toBeUndefined();
  });
});

desktopOnly("the Desktop Queue", () => {
  it("passes the slot on in enqueue order, not poll order", async () => {
    const holder = await acquireDesktopSlot(IN_TEST);
    const trace = join(dir, "trace");
    await writeFile(trace, "");
    const waiters: ChildProcess[] = [];
    for (const [name, pollMs] of [
      ["first", 200],
      ["second", 20],
      ["third", 5],
    ] as const) {
      const each = waiter(name, trace, { pollMs });
      waiters.push(each);
      await printed(each, new RegExp(`position ${waiters.length} of`));
    }
    holder.release();
    const codes = await Promise.all(
      waiters.map(async (each) => (await once(each, "exit"))[0]),
    );
    expect(codes).toEqual([0, 0, 0]);
    expect(await readFile(trace, "utf8")).toBe("first\nsecond\nthird\n");
  });

  it("reaps the ticket of a dead waiter", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const doomed = waiter("doomed", join(dir, "trace"));
    await printed(doomed, /position 1 of/);
    doomed.kill("SIGKILL");
    await once(doomed, "exit");

    const waiting = acquireDesktopSlot(IN_TEST);
    holder.kill("SIGTERM");
    using slot = await waiting;
    expect(slot.reused).toBe(false);
    expect((await readDesktopSlotStatus()).waiters).toEqual([]);
  });

  it("sends a waiter whose ticket was removed to the back of the queue", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const trace = join(dir, "trace");
    await writeFile(trace, "");
    const messages: string[] = [];
    let removed = false;
    const ticketGone = Promise.withResolvers<void>();
    const waiting = acquireDesktopSlot({
      ...IN_TEST,
      waitMs: 20_000,
      log: (message) => {
        messages.push(message);
        if (removed) ticketGone.resolve();
      },
    });
    const behind = waiter("behind", trace);
    await printed(behind, /position 2 of/);
    const [own] = (await readDesktopSlotStatus()).waiters;
    expect(own?.pid).toBe(process.pid);
    removed = true;
    await rm(
      join(
        dir,
        "queue",
        `${String(own!.seq).padStart(12, "0")}-${own!.token}.json`,
      ),
    );
    await ticketGone.promise;
    expect(
      (await readDesktopSlotStatus()).waiters.map((ticket) => ticket.pid),
    ).toEqual([behind.pid, process.pid]);

    holder.kill("SIGTERM");
    expect((await once(behind, "exit"))[0]).toBe(0);
    using slot = await waiting;
    expect(slot.owner.pid).toBe(process.pid);
    expect(await readFile(trace, "utf8")).toBe("behind\n");
    expect(
      messages.filter((message) => message.includes("ticket was removed")),
    ).toHaveLength(1);
  });

  it("gives up at the Admission Deadline, naming the holder and the waiters ahead", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const ahead = waiter("ahead", join(dir, "trace"));
    await printed(ahead, /position 1 of/);

    const error = await acquireDesktopSlot({ ...IN_TEST, waitMs: 200 }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(DesktopSlotBlockedError);
    const message = (error as Error).message;
    expect(message).toContain(`pid ${holder.pid} (holder)`);
    expect(message).toContain(`pid ${ahead.pid} (ahead)`);
    const { waiters } = await readDesktopSlotStatus();
    expect(waiters.map((ticket) => ticket.pid)).toEqual([ahead.pid]);

    ahead.kill("SIGTERM");
    holder.kill("SIGTERM");
    await Promise.all([once(ahead, "exit"), once(holder, "exit")]);
  });

  it("gives up at the Admission Deadline when it comes before the next poll", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const error = await acquireDesktopSlot({
      ...IN_TEST,
      waitMs: 100,
      pollMs: MINUTE,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(DesktopSlotBlockedError);
  });
});

desktopOnly("one Desktop Slot", () => {
  it("serializes worktrees and writes an exclusive hold for older clients", async () => {
    const holder = holderIn("/a");
    await printed(holder, "held");
    const trace = join(dir, "trace");
    const second = waiter("second", trace, { worktree: "/b" });
    await printed(second, /position 1 of/);
    expect((await readDesktopSlotStatus()).holders).toMatchObject([
      { pid: holder.pid, exclusive: true, slots: [0] },
    ]);
    const exited = once(second, "exit");
    holder.kill("SIGTERM");
    expect((await exited)[0]).toBe(0);
    expect(await readFile(trace, "utf8")).toBe("second\n");
  });

  it("waits for a legacy holder beyond slot zero and refuses to reuse a legacy non-exclusive hold", async () => {
    const holder = holderIn("/old");
    await printed(holder, "held");
    const old = JSON.parse(await readFile(OWNER(), "utf8")) as {
      token: string;
      exclusive?: boolean;
      slots: number[];
    };
    delete old.exclusive;
    old.slots = [2];
    const path = join(dir, "slot-2");
    await rename(join(dir, "slot-0"), path);
    await writeFile(join(path, "owner.json"), JSON.stringify(old));
    const error = await blocked({ worktree: "/new" });
    expect(error.message).toContain(`pid ${holder.pid} (holder)`);

    process.env[DESKTOP_SLOT_ENV] = old.token;
    await expect(acquireDesktopSlot(IN_TEST)).rejects.toThrow(
      "old Desktop Slot pool",
    );
    expect(await holderPids()).toEqual([holder.pid]);
  });
});

desktopOnly("the desktop mutex", () => {
  it("lets a second holder in only after the first releases", async () => {
    const released = join(dir, "released");
    const first = track(
      [
        process.execPath,
        "--input-type=module",
        "-e",
        `const slot = await import(${JSON.stringify(MODULE)});
const { writeFileSync } = await import("node:fs");
const held = await slot.holdDesktopMutex("registry.lock", { dir: ${JSON.stringify(dir)} });
process.on("SIGTERM", () => { writeFileSync(${JSON.stringify(released)}, ""); held[Symbol.dispose](); process.exit(0); });
console.log("held");
setInterval(() => {}, 1000);`,
      ],
      { env: {} },
    );
    await printed(first, "held");
    const second = holdDesktopMutex("registry.lock", { dir });
    first.kill("SIGTERM");
    using _held = await second;
    expect(await exists(released)).toBe(true);
  });

  it("breaks a mutex older than its stale time", async () => {
    const path = join(dir, "registry.lock");
    await mkdir(path);
    await writeFile(join(path, "dead-owner"), "");
    const old = Temporal.Now.instant().epochMilliseconds / 1000 - 60;
    await utimes(path, old, old);
    using _held = await holdDesktopMutex("registry.lock", {
      dir,
      staleMs: 30_000,
    });
    expect(await exists(join(path, "dead-owner"))).toBe(false);
  });

  it("is left alone by an owner whose stale mutex another broke", async () => {
    const path = join(dir, "registry.lock");
    const stale = await holdDesktopMutex("registry.lock", { dir });
    const old = Temporal.Now.instant().epochMilliseconds / 1000 - 60;
    await utimes(path, old, old);
    const current = await holdDesktopMutex("registry.lock", {
      dir,
      staleMs: 30_000,
    });
    stale[Symbol.dispose]();
    expect(await exists(path)).toBe(true);
    current[Symbol.dispose]();
    expect(await exists(path)).toBe(false);
  });
});

desktopOnly("a dead holder", () => {
  it("is taken over", async () => {
    await mkdir(join(dir, "slot-0"));
    const pid = await deadPid();
    await writeFile(
      OWNER(),
      JSON.stringify({ token: "old", pid, command: "crashed", worktree: "/w" }),
    );
    const messages: string[] = [];
    using slot = await acquireDesktopSlot({
      ...IN_TEST,
      log: (message) => messages.push(message),
    });
    expect(slot.owner.pid).toBe(process.pid);
    expect(messages.join("\n")).toContain(`pid ${pid} (crashed) is gone`);
  });

  describe("whose command's process group lives on", () => {
    async function orphanGroup(): Promise<{ pgid: number; sleep: number }> {
      const pidFile = join(dir, "sleep");
      const wrapper = start(
        "run",
        "--",
        "sh",
        "-c",
        `sleep 60 & echo $! > ${pidFile}; wait`,
      );
      for (let attempt = 0; ; attempt++) {
        const [holder] = (await readDesktopSlotStatus()).holders;
        if (holder?.pgid !== undefined && (await exists(pidFile))) {
          const sleep = Number(await readFile(pidFile, "utf8"));
          strays.add(holder.pgid);
          strays.add(sleep);
          const exited = once(wrapper, "exit");
          wrapper.kill("SIGKILL");
          await exited;
          return { pgid: holder.pgid, sleep };
        }
        if (attempt === 200) {
          throw new Error("the run wrapper never recorded its group");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    it("is ended before the waiter takes the slot", async () => {
      const { pgid, sleep } = await orphanGroup();
      const messages: string[] = [];
      using slot = await acquireDesktopSlot({
        ...IN_TEST,
        killAfterMs: 200,
        log: (message) => messages.push(message),
      });
      expect(slot.owner.pid).toBe(process.pid);
      expect(messages.join("\n")).toContain(`process group ${pgid}`);
      await gone(pgid);
      await gone(sleep);
    });

    it("is never signalled when its leader's pid now names another process", async () => {
      const { pgid, sleep } = await orphanGroup();
      const owner = JSON.parse(await readFile(OWNER(), "utf8")) as object;
      await writeFile(
        OWNER(),
        JSON.stringify({ ...owner, pgidStart: "Thu Jan  1 00:00:00 1970" }),
      );
      using slot = await acquireDesktopSlot({ ...IN_TEST, killAfterMs: 200 });
      expect(slot.owner.pid).toBe(process.pid);
      expect(isAlive(pgid)).toBe(true);
      expect(isAlive(sleep)).toBe(true);
    });
  });

  it("includes a holder whose pid now belongs to a new process, which is never signalled", async () => {
    await mkdir(join(dir, "slot-0"));
    const ended = Temporal.Now.instant().subtract({ hours: 3 }).toString();
    await writeFile(
      OWNER(),
      JSON.stringify({
        token: "old",
        pid: process.pid,
        processStart: "Thu Jan  1 00:00:00 1970",
        command: "crashed",
        worktree: "/w",
        admittedAt: ended,
        silenceMs: MINUTE,
        leaseEndsAt: ended,
      }),
    );
    const messages: string[] = [];
    using slot = await acquireDesktopSlot({
      ...IN_TEST,
      log: (message) => messages.push(message),
    });
    expect(slot.reused).toBe(false);
    expect(messages.join("\n")).toContain(
      `pid ${process.pid} (crashed) is gone`,
    );
  });

  it("includes a claim that died before it wrote its record", async () => {
    await mkdir(join(dir, "slot-0"));
    const old = Temporal.Now.instant().epochMilliseconds / 1000 - 60;
    await utimes(join(dir, "slot-0"), old, old);
    using slot = await acquireDesktopSlot(IN_TEST);
    expect(slot.owner.pid).toBe(process.pid);
  });
});

desktopOnly("the Lease of an automated holder", () => {
  it("moves its end to the time of the last progress plus the silence limit", async () => {
    let clock = Temporal.Now.instant().epochMilliseconds;
    using slot = await acquireDesktopSlot({
      ...IN_TEST,
      silenceMs: 10 * MINUTE,
      now: () => clock,
    });
    clock += 7 * MINUTE;
    slot.progress("first step");
    let [holder] = (await readDesktopSlotStatus()).holders;
    expect(holder?.progress?.what).toBe("first step");
    expect(Temporal.Instant.from(holder!.leaseEndsAt!).epochMilliseconds).toBe(
      clock + 10 * MINUTE,
    );

    const nested = child(`slot.reportDesktopProgress("a nested step");`);
    expect((await once(nested, "exit"))[0]).toBe(0);
    [holder] = (await readDesktopSlotStatus()).holders;
    expect(holder?.progress?.what).toBe("a nested step");
  });

  it("ends a silent holder with exit 76, naming the silence and the last progress", async () => {
    const holder = child(
      `const held = await slot.acquireDesktopSlot({ silenceMs: 300, pollMs: 10, log: (message) => console.log(message) });
held.progress("the first step");
setInterval(() => {}, 1000);`,
    );
    await printed(
      holder,
      /made no progress for .*silence limit of 300 ms.*"the first step"/,
    );
    const [code] = await once(holder, "exit");
    expect(code).toBe(EXIT_LEASE_ENDED);
    expect(await exists(OWNER())).toBe(false);
  });

  it("keeps a healthy run that lasts longer than the old fixed Lease of 20 min", async () => {
    const holder = child(
      `let shift = 0;
const held = await slot.acquireDesktopSlot({ silenceMs: slot.SILENCE_LIMIT_MS.e2e, pollMs: 10, now: () => Temporal.Now.instant().epochMilliseconds + shift, log: (message) => console.log(message) });
for (let step = 1; step <= 12; step++) {
  shift += 5 * 60_000;
  held.progress("step " + step);
  await new Promise((resolve) => setTimeout(resolve, 30));
}
console.log("finished after " + shift / 60_000 + " min");
held.release();`,
    );
    const said = collect(holder);
    const [code] = await once(holder, "exit");
    expect(code).toBe(0);
    expect(said()).toContain("finished after 60 min");
    expect(said()).not.toContain("Lease");
  });

  it("does not yield to a waiter, which names its last progress and silence limit", async () => {
    const holder = holderIn("/a", { command: "automated" });
    await printed(holder, "held");
    const error = await blocked({ worktree: "/b" });
    expect(error.message).toMatch(
      new RegExp(
        `pid ${holder.pid} \\(automated\\).*automated, last progress .* \\(admitted\\), silence limit 30 min, Lease ends`,
      ),
    );
    const [status] = (await readDesktopSlotStatus()).holders;
    expect(status?.notice).toBeUndefined();
    expect(isAlive(holder.pid!)).toBe(true);
  });

  it("is a backstop: the head waiter evicts a silent holder that ignores its Lease end", async () => {
    const holder = child(
      `await slot.acquireDesktopSlot({ command: "ignores", silenceMs: 200, pollMs: 10, onLeaseEnd: () => console.log("ignored"), log: () => {} });
console.log("held");
setInterval(() => {}, 1000);`,
      {},
      true,
    );
    const exited = once(holder, "exit");
    await printed(holder, "ignored");
    const messages: string[] = [];
    using _slot = await acquireDesktopSlot({
      ...IN_TEST,
      now: () => Temporal.Now.instant().add({ minutes: 3 }).epochMilliseconds,
      log: (message) => messages.push(message),
    });
    expect((await exited)[1]).toBe("SIGTERM");
    expect(messages.join("\n")).toContain(`evicting pid ${holder.pid}`);
  });

  it("is overdue past its grace, so the head waiter evicts the holder and takes the slot", async () => {
    const holder = child(HOLD, {}, true);
    const exited = once(holder, "exit");
    await printed(holder, "held");
    const messages: string[] = [];
    using _slot = await acquireDesktopSlot({
      ...IN_TEST,
      now: () => Temporal.Now.instant().add({ minutes: 33 }).epochMilliseconds,
      log: (message) => messages.push(message),
    });
    const [, signal] = await exited;
    expect(signal).toBe("SIGTERM");
    expect(messages.join("\n")).toContain(`evicting pid ${holder.pid}`);
  });

  it("does not start while the holder waits at the Memory Gate, so no waiter evicts it there", async () => {
    await mkdir(join(dir, "last-start.lock"));
    const holder = child(
      `await slot.acquireDesktopSlot({ command: "holder", silenceMs: 30 * 60_000, pollMs: 10, log: (message) => console.log(message) });
console.log("held");`,
      { [MEMORY_GATE_ENV]: "" },
    );
    await printed(holder, /^Memory Gate: waiting/);
    const messages: string[] = [];
    const error = await acquireDesktopSlot({
      ...IN_TEST,
      waitMs: 300,
      now: () => Temporal.Now.instant().add({ minutes: 33 }).epochMilliseconds,
      log: (message) => messages.push(message),
    }).then(
      (slot) => slot.release(),
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(DesktopSlotBlockedError);
    expect(messages.join("\n")).not.toContain("evicting");
    expect(isAlive(holder.pid!)).toBe(true);
    expect(await holderPids()).toEqual([holder.pid]);
  });
});

function behindByNotice(leftMs: number): () => number {
  return () => Temporal.Now.instant().epochMilliseconds - NOTICE_MS + leftMs;
}

desktopOnly("the Lease of a manual hold", () => {
  it("has no end while no run waits, past any old cap", async () => {
    const holder = child(
      `await slot.acquireDesktopSlot({ manual: true, command: "manual", pollMs: 10, now: () => Temporal.Now.instant().add({ hours: 3 }).epochMilliseconds, log: (message) => console.log(message) });
console.log("held");
setInterval(() => {}, 1000);`,
    );
    await printed(holder, "held");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(isAlive(holder.pid!)).toBe(true);
    const [status] = (
      await readDesktopSlotStatus({
        now: () => Temporal.Now.instant().add({ hours: 3 }).epochMilliseconds,
      })
    ).holders;
    expect(status).toMatchObject({
      pid: holder.pid,
      kind: "manual",
      overdue: false,
    });
    expect(status?.leaseEndsAt).toBeUndefined();
  });

  it("fits a notice and the eviction grace inside the default Admission Deadline", () => {
    expect(NOTICE_MS + EVICTION_GRACE_MS + KILL_AFTER_MS).toBeLessThan(
      ADMISSION_DEADLINE_MS,
    );
  });

  it("gives its holder notice and admits the waiting run after the hold ends", async () => {
    const holder = holderIn("/a", { command: "manual", manual: true });
    await printed(holder, "held");
    const said = collect(holder);
    const exited = once(holder, "exit");
    const messages: string[] = [];
    using slot = await acquireDesktopSlot({
      ...IN_TEST,
      worktree: "/b",
      now: behindByNotice(500),
      log: (message) => messages.push(message),
    });
    expect(slot.owner.pid).toBe(process.pid);
    expect(messages.join("\n")).toContain(
      `gave the manual hold of pid ${holder.pid} (manual) 5 min of notice`,
    );
    expect((await exited)[0]).toBe(EXIT_LEASE_ENDED);
    expect(said()).toContain("waits for a slot. This manual hold ends at");
  });

  it("turns away a manual hold from its own worktree at once, naming the token that runs inside it", async () => {
    const holder = holderIn("/a", { command: "sleep 86400", manual: true });
    await printed(holder, "held");
    const started = Temporal.Now.instant().epochMilliseconds;
    const options = {
      manual: true,
      insideOwnHold: true,
      command: "obsidian-vault open",
      worktree: "/a",
      pollMs: 10,
      waitMs: 2000,
      log: () => {},
      onLeaseEnd: () => {},
    } as const;

    const error = await acquireDesktopSlot(options).then(
      (slot) => slot.release(),
      (error: unknown) => error,
    );

    expect(Temporal.Now.instant().epochMilliseconds - started).toBeLessThan(
      1000,
    );
    const [status] = (await readDesktopSlotStatus()).holders;
    expect(error).toBeInstanceOf(DesktopSlotBlockedError);
    expect((error as Error).message).toContain(
      `the manual hold of pid ${holder.pid} (sleep 86400) in this worktree has the Desktop Slot, so obsidian-vault open would wait behind it. Run the command inside that hold: prefix it with ${DESKTOP_SLOT_ENV}=${status?.token}.`,
    );
    expect(status?.notice).toBeUndefined();
    expect(isAlive(holder.pid!)).toBe(true);
    process.env[DESKTOP_SLOT_ENV] = status?.token;
    using inside = await acquireDesktopSlot(options);
    expect(inside.reused).toBe(true);
  });

  it("goes on when no run waits at the end of its notice", async () => {
    const holder = holderIn("/a", { command: "manual", manual: true });
    await printed(holder, "held");
    await blocked({ worktree: "/b", now: behindByNotice(1000) });
    await printed(holder, /no run waits any more, so this manual hold goes on/);
    expect(isAlive(holder.pid!)).toBe(true);
    const [status] = (await readDesktopSlotStatus()).holders;
    expect(status?.notice).toBeUndefined();
    expect(status?.leaseEndsAt).toBeUndefined();
  });
});

desktopOnly("a child of the holder", () => {
  it("reuses the slot at once and leaves it held", async () => {
    using _slot = await acquireDesktopSlot(IN_TEST);
    const nested = child(
      `const inner = await slot.acquireDesktopSlot({ leaseMs: 60_000, pollMs: 10, log: () => {} });
console.log(inner.reused ? "reused" : "own");
inner.release();`,
    );
    await printed(nested, "reused");
    await once(nested, "exit");
    expect(await exists(OWNER())).toBe(true);
  });

  it("joins the queue once the holder's Lease has ended", async () => {
    using _slot = await acquireDesktopSlot(IN_TEST);
    const error = await acquireDesktopSlot({
      ...IN_TEST,
      waitMs: 100,
      now: () => Temporal.Now.instant().add({ minutes: 31 }).epochMilliseconds,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(DesktopSlotBlockedError);
    expect(await exists(OWNER())).toBe(true);
  });

  it("acquires normally when the inherited token is not the holder's", async () => {
    process.env[DESKTOP_SLOT_ENV] = "stale";
    using slot = await acquireDesktopSlot(IN_TEST);
    expect(slot.reused).toBe(false);
  });
});

desktopOnly("the desktop-slot command", () => {
  async function cli(...args: string[]) {
    const run = start(...args);
    let stdout = "";
    let stderr = "";
    run.stdout!.on("data", (chunk) => (stdout += String(chunk)));
    run.stderr!.on("data", (chunk) => (stderr += String(chunk)));
    const [code] = await once(run, "exit");
    return { code, stdout, stderr };
  }

  it("holds the slot while the command runs and passes its exit code through", async () => {
    const { code, stdout } = await cli(
      "run",
      "--",
      process.execPath,
      "-e",
      `const { existsSync } = require("node:fs");
console.log(existsSync(process.argv[1]) ? "held" : "free", process.env.${DESKTOP_SLOT_ENV} ? "token" : "none");
process.exit(7);`,
      OWNER(),
    );
    expect(code).toBe(7);
    expect(stdout.trim()).toBe("held token");
    expect(await exists(OWNER())).toBe(false);
  });

  it("exits with 128 plus the signal number when a signal ends the command", async () => {
    const { code } = await cli(
      "run",
      "--",
      process.execPath,
      "-e",
      'process.kill(process.pid, "SIGTERM")',
    );
    expect(code).toBe(143);
  });

  it.each([[["run", "--for", "20m", "--", "true"]], [["extend", "20m"]]])(
    "rejects a Lease duration, which no hold takes now, and says what to do (%j)",
    async (args) => {
      const { code, stderr } = await cli(...args);
      expect(code).toBe(2);
      expect(stderr).toMatch(
        /is gone: .*(Run the command again|end the command)/,
      );
    },
  );

  it("passes --for after -- on to the command", async () => {
    const { code, stdout } = await cli(
      "run",
      "--",
      "sh",
      "-c",
      'echo "$@"',
      "sh",
      "--for",
      "1m",
    );
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("--for 1m");
  });

  it("exits 75 at the Admission Deadline and names the holder", async () => {
    const holder = child(HOLD);
    await printed(holder, "held");
    const { code, stderr } = await cli("run", "--wait", "200ms", "--", "true");
    expect(code).toBe(EXIT_ADMISSION_BLOCKED);
    expect(stderr).toContain(`pid ${holder.pid} (holder)`);
    expect((await readDesktopSlotStatus()).waiters).toEqual([]);
    holder.kill("SIGTERM");
    await once(holder, "exit");
  });

  it("lists the desktop hold on disk", async () => {
    using _slot = await acquireDesktopSlot(IN_TEST);
    const { code, stdout } = await cli("status");
    expect(code).toBe(0);
    expect(stdout).toMatch(
      new RegExp(
        `Slot 1: pid ${process.pid} .*automated, last progress .* \\(admitted\\), silence limit 30 min, Lease ends`,
      ),
    );
  });

  it("accepts --exclusive as an alias for a normal hold", async () => {
    const { code } = await cli("run", "--exclusive", "--", "true");
    expect(code).toBe(0);
  });

  it("ends the command's whole process group at the end of a notice, exits 76, and admits the waiter", async () => {
    const pidFile = join(dir, "grandchild");
    const running = cli(
      "run",
      "--",
      "sh",
      "-c",
      `sleep 60 & echo $! > ${pidFile}; wait`,
    );
    for (let attempt = 0; !(await exists(pidFile)); attempt++) {
      if (attempt === 200) throw new Error("the command never started");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const grandchild = Number(await readFile(pidFile, "utf8"));
    strays.add(grandchild);
    using slot = await acquireDesktopSlot({
      ...IN_TEST,
      worktree: "/w",
      now: behindByNotice(0),
    });
    const { code, stderr } = await running;
    expect(code).toBe(EXIT_LEASE_ENDED);
    expect(stderr).toContain("waits for a slot. This manual hold ends at");
    expect(stderr).toContain("ending the command's process group");
    await gone(grandchild);
    expect(slot.owner.pid).toBe(process.pid);
  });
});
