import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { processRecord } from "@zotlit/scripts/desktop-slot";

import type { AppStorage } from "./pdf-sidebar-pin.ts";
import { pinLocalStorage } from "./pdf-sidebar-pin.ts";

const KEY = "pdfjs.sidebarView";

type FakeStorage = AppStorage & { value: string | null; failWrites: boolean };

function appStorage(initial: string | null): FakeStorage {
  const storage: FakeStorage = {
    value: initial,
    failWrites: false,
    read: async () => storage.value,
    write: async (value: string | null) => {
      if (storage.failWrites) throw new Error("the app window is gone");
      storage.value = value;
    },
  };
  return storage;
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "local-storage-pin-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const pin = (storage: AppStorage, holder?: { pid: number }) =>
  pinLocalStorage({ key: KEY, value: "0", storage, dir, holder });

const leftovers = async () =>
  (await readdir(dir)).filter((name) => name.endsWith(".json"));

async function pinInKilledRun(storage: AppStorage): Promise<void> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  await once(child, "spawn");
  if (child.pid === undefined) throw new Error("the run process has no pid");
  await pin(storage, await processRecord(child.pid));
  child.kill("SIGKILL");
  await once(child, "exit");
}

describe("a pin of one app localStorage key", () => {
  it("pins the key for one run and writes the old value back at its end", async () => {
    const storage = appStorage("1");
    const run = await pin(storage);
    expect(storage.value).toBe("0");
    await run[Symbol.asyncDispose]();
    expect(storage.value).toBe("1");
    expect(await leftovers()).toEqual([]);
  });

  it("removes the key at the end when it had no value before", async () => {
    const storage = appStorage(null);
    const run = await pin(storage);
    expect(storage.value).toBe("0");
    await run[Symbol.asyncDispose]();
    expect(storage.value).toBeNull();
  });

  it("keeps the key pinned until the last of two overlapping runs ends", async () => {
    const storage = appStorage("1");
    const first = await pin(storage);
    const second = await pin(storage);
    await first[Symbol.asyncDispose]();
    expect(storage.value).toBe("0");
    await second[Symbol.asyncDispose]();
    expect(storage.value).toBe("1");
  });

  it("writes the value from before a killed run back at the end of the next run", async () => {
    const storage = appStorage("1");
    await pinInKilledRun(storage);
    expect(storage.value).toBe("0");

    const next = await pin(storage);
    await next[Symbol.asyncDispose]();
    expect(storage.value).toBe("1");
    expect(await leftovers()).toEqual([]);
  });

  it("keeps a value set at the app after a killed run as the one to write back", async () => {
    const storage = appStorage("1");
    await pinInKilledRun(storage);
    storage.value = "2";

    const next = await pin(storage);
    await next[Symbol.asyncDispose]();
    expect(storage.value).toBe("2");
  });

  it("leaves the saved value for the next run when the last write back fails", async () => {
    const storage = appStorage("1");
    const run = await pin(storage);
    storage.failWrites = true;
    await expect(run[Symbol.asyncDispose]()).rejects.toThrow("gone");
    storage.failWrites = false;

    const next = await pin(storage);
    await next[Symbol.asyncDispose]();
    expect(storage.value).toBe("1");
  });
});
