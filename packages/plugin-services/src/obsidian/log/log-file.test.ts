import { Cause, DateTime, Effect, Layer } from "effect";
import type { DataAdapter, Plugin } from "obsidian";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { LogTimestamp } from "@zotlit/plugin-kernel/effect-log-category.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { logLibrary } from "@zotlit/shared/logging";

import { layerLogging, layerLogOutput } from "./service.ts";

import { platformSettings } from "#__fixtures__/platform-settings.ts";
import { layerPluginSettings } from "#obsidian/settings/service.ts";

const NOW = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-11-20T09:30:00.125Z"),
);
const WORKER_TIME = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2001-02-03T04:05:06.007Z"),
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const failure = () => {
  const error = new Error("disk full", { cause: "quota" });
  error.stack = "Error: disk full\n    at write (vault.ts:1:1)";
  return error;
};

/** The log file's lines once each record went through the plugin's logging. */
async function logFileLines(
  records: readonly Effect.Effect<void>[],
): Promise<string[]> {
  const appended: string[] = [];
  const adapter = stubService<DataAdapter>("Adapter", {
    write: async () => {},
    append: async (_path, data) => {
      appended.push(data);
    },
  });
  const plugin = stubService<Plugin>("Plugin", {
    app: stubService<Plugin["app"]>("App", {
      vault: stubService<Plugin["app"]["vault"]>("Vault", { adapter }),
    }),
    manifest: stubService<Plugin["manifest"]>("Manifest", {
      id: "zotlit",
      dir: "zotlit",
    }),
    loadData: async () => ({
      __VERSION__: 11,
      "log.level": "trace",
      "log.to-file": true,
    }),
    saveData: async () => {},
  });
  const stack = new AsyncDisposableStack();
  const graph = buildRuntime(
    layerLogging.pipe(
      Layer.provide(layerLogOutput(plugin)),
      Layer.provideMerge(
        layerPluginSettings(plugin, { definition: platformSettings }),
      ),
    ),
    stack,
  );
  await graph.context();
  await vi.waitFor(
    () => {
      graph.runSync(Effect.logTrace("probe"));
      expect(appended.join("")).toContain('"message":"probe"');
    },
    { timeout: 10_000, interval: 200 },
  );
  appended.length = 0;
  vi.setSystemTime(NOW);
  for (const record of records) graph.runSync(record);
  await stack.disposeAsync();
  return appended
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes('"message":"probe"'));
}

it("reports a record the log file cannot hold as a fatal record on the console", async () => {
  using consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const loop: Record<string, unknown> = { name: "loop" };
  loop["self"] = loop;

  const lines = await logFileLines([
    Effect.logInfo("Looped").pipe(Effect.annotateLogs({ loop })),
  ]);

  expect(lines).toEqual([]);
  expect(consoleError.mock.calls).toContainEqual(
    expect.arrayContaining([
      expect.stringMatching(/FTL.*Failed to write a log record to a sink: /),
    ]),
  );
});

it("writes the same JSON lines as LogTape 2.1.0's JSON-lines formatter", async () => {
  const lines = await logFileLines([
    Effect.logInfo("Opened Zotero database"),
    Effect.logWarning("Unknown tag type {type}").pipe(
      Effect.annotateLogs({ type: 99 }),
    ),
    Effect.logInfo("Moved {from} to {to}").pipe(
      Effect.annotateLogs({ from: "a.md", to: "b.md" }),
      withLogCategory("notes"),
    ),
    Effect.logDebug("Kept {{braces}} and {missing}"),
    Effect.logDebug({ id: 1, name: "item" }),
    Effect.logInfo("Saved", 42, "extra"),
    Effect.logInfo("Timed").pipe(Effect.withLogSpan("load")),
    Effect.logError("Write failed").pipe(
      Effect.annotateLogs({ error: failure() }),
      withLogCategory("citations", "export"),
    ),
    Effect.logError("Refresh failed", Cause.fail(failure())),
    Effect.logWarning("Unknown tag type {type}").pipe(
      Effect.annotateLogs({ type: 7 }),
      Effect.provideService(LogTimestamp, WORKER_TIME),
      withLogCategory("zotlit", "db", "tags"),
    ),
    Effect.logFatal("Lost {library.name}").pipe(
      Effect.annotateLogs({ library: { name: "My Library" } }),
    ),
    Effect.sync(() =>
      logLibrary({
        level: "warn",
        category: ["zotlit", "db", "creators"],
        message: "Creator {id} has no name",
        properties: { id: 5 },
      }),
    ),
  ]);

  expect(lines).toEqual([
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"INFO","message":"Opened Zotero database","logger":"zotlit.obsidian","properties":{}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"WARN","message":"Unknown tag type 99","logger":"zotlit.obsidian","properties":{"type":99}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"INFO","message":"Moved \\"a.md\\" to \\"b.md\\"","logger":"zotlit.obsidian.notes","properties":{"from":"a.md","to":"b.md"}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"DEBUG","message":"Kept {braces} and undefined","logger":"zotlit.obsidian","properties":{}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"DEBUG","message":"{\\"id\\":1,\\"name\\":\\"item\\"}","logger":"zotlit.obsidian","properties":{"message":{"id":1,"name":"item"}}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"INFO","message":"Saved","logger":"zotlit.obsidian","properties":{"details":[42,"extra"]}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"INFO","message":"Timed","logger":"zotlit.obsidian","properties":{"spans":{"load":0}}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"ERROR","message":"Write failed","logger":"zotlit.obsidian.citations.export","properties":{"error":{"name":"Error","message":"disk full","stack":"Error: disk full\\n    at write (vault.ts:1:1)","cause":"quota"}}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"ERROR","message":"Refresh failed","logger":"zotlit.obsidian","properties":{"error":{"name":"Error","message":"disk full","stack":"Error: disk full\\n    at write (vault.ts:1:1)","cause":"quota"}}}',
    '{"@timestamp":"2001-02-03T04:05:06.007Z","level":"WARN","message":"Unknown tag type 7","logger":"zotlit.db.tags","properties":{"type":7}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"FATAL","message":"Lost \\"My Library\\"","logger":"zotlit.obsidian","properties":{"library":{"name":"My Library"}}}',
    '{"@timestamp":"2026-11-20T09:30:00.125Z","level":"WARN","message":"Creator 5 has no name","logger":"zotlit.db.creators","properties":{"id":5}}',
  ]);
});
