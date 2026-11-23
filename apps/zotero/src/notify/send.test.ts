import { configure, reset } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const dirError = new Error("Zotero data directory unavailable");
const readDataDir = vi.fn(() => {
  throw dirError;
});
const fetch = vi.fn();
const records: LogRecord[] = [];
let enabled: boolean;

beforeEach(async () => {
  vi.resetModules();
  readDataDir.mockClear();
  fetch.mockClear();
  records.length = 0;
  enabled = true;
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("Localization", class {});
  vi.stubGlobal("Zotero", {
    Prefs: {
      get(key: string) {
        if (key === "extensions.zotlit.notify") return enabled;
        if (key === "extensions.zotlit.notify-url") return "http://localhost";
      },
    },
    Profile: { dir: "/profile" },
    DataDirectory: {
      get dir() {
        return readDataDir();
      },
    },
    File: { pathToFileURI: (path: string) => `file://${path}` },
  });
  await import("@/prefs/index.ts");
  await configure({
    sinks: { memory: (record) => void records.push(record) },
    loggers: [
      {
        category: ["zotlit", "zotero"],
        lowestLevel: "debug",
        sinks: ["memory"],
      },
      { category: ["logtape", "meta"], lowestLevel: "error", sinks: [] },
    ],
  });
});

afterEach(async () => {
  await reset();
  vi.unstubAllGlobals();
});

it("logs a preparation failure and resolves without sending", async () => {
  const { createSender } = await import("./send.ts");

  await expect(
    createSender()({ event: "db/updated" }),
  ).resolves.toBeUndefined();

  expect(fetch).not.toHaveBeenCalled();
  expect(records).toContainEqual(
    expect.objectContaining({
      level: "warning",
      properties: expect.objectContaining({ error: dirError }),
    }),
  );
});

it("skips notification preparation when notifications are disabled", async () => {
  enabled = false;
  const { createSender } = await import("./send.ts");

  await expect(
    createSender()({ event: "db/updated" }),
  ).resolves.toBeUndefined();

  expect(readDataDir).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(records).toEqual([]);
});
