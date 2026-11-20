import { getLogger } from "@logtape/logtape";
import { Effect, Layer } from "effect";
import type { DataAdapter, Plugin } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

interface FileRecord {
  readonly logger: string;
  readonly message: string;
}

interface RunningPlugin {
  readonly id: string;
  readonly appendedRecords: () => FileRecord[];
  readonly log: (message: string) => void;
  readonly setLevel: (level: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

const open = new Set<RunningPlugin>();

afterEach(async () => {
  for (const plugin of open) await plugin.close();
});

async function startPluginBundle(
  id: string,
  level: string,
): Promise<RunningPlugin> {
  vi.resetModules();
  const kernelLog = await import("@zotlit/plugin-kernel/log.ts");
  kernelLog.setLogCategoryRoot(id);
  const { bridgeLog } = await import("@zotlit/plugin-kernel/effect-log.ts");
  const runtime = await import("@zotlit/plugin-kernel/effect-runtime.ts");
  const { buildRuntime } =
    await import("@zotlit/plugin-kernel/effect-layer.ts");
  const { layerLogging, layerLogOutput } = await import("./service.ts");
  const { layerPluginSettings, PluginSettings } =
    await import("#obsidian/settings/service.ts");
  const { platformSettings } =
    await import("#__fixtures__/platform-settings.ts");

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
    manifest: stubService<Plugin["manifest"]>("Manifest", { id, dir: id }),
    loadData: async () => ({
      __VERSION__: 11,
      "log.level": level,
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
  const settings = graph.runSync(PluginSettings);
  await waitUntilLevelApplied(id, level);

  const log = bridgeLog(runtime, "bridge");
  const running: RunningPlugin = {
    id,
    appendedRecords: () =>
      appended
        .join("")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as FileRecord),
    log: (message) => {
      runtime.runSync(Effect.logWarning(message));
      log.warn(message);
    },
    setLevel: async (next) => {
      await graph.runPromise(settings.update({ "log.level": next as never }));
      await waitUntilLevelApplied(id, next);
    },
    close: async () => {
      open.delete(running);
      await stack.disposeAsync();
    },
  };
  open.add(running);
  return running;
}

async function waitUntilLevelApplied(id: string, level: string): Promise<void> {
  const below = { info: "debug", warning: "info", error: "warning" }[level]!;
  await vi.waitFor(() => {
    expect(getLogger([id]).isEnabledFor(below as never)).toBe(false);
    expect(getLogger([id]).isEnabledFor(level as never)).toBe(true);
  });
}

const messagesOf = (plugin: RunningPlugin) =>
  plugin.appendedRecords().map((record) => record.message);

describe("two plugins in one window", () => {
  it("files each plugin's records under its own id, in its own log", async () => {
    const zotlit = await startPluginBundle("zotlit", "info");
    const reader = await startPluginBundle("zotlit-reader", "info");

    zotlit.log("from zotlit");
    reader.log("from reader");
    await zotlit.close();
    await reader.close();

    expect(messagesOf(zotlit)).toEqual(Array(2).fill("from zotlit"));
    expect(messagesOf(reader)).toEqual(Array(2).fill("from reader"));
    expect(zotlit.appendedRecords().map((record) => record.logger)).toEqual([
      "zotlit.obsidian",
      "zotlit.obsidian.bridge",
    ]);
    expect(reader.appendedRecords().map((record) => record.logger)).toEqual([
      "zotlit-reader.obsidian",
      "zotlit-reader.obsidian.bridge",
    ]);
  });

  it("keeps the other plugin's level when one plugin's level changes", async () => {
    const zotlit = await startPluginBundle("zotlit", "info");
    const reader = await startPluginBundle("zotlit-reader", "info");

    await reader.setLevel("error");
    zotlit.log("from zotlit");
    reader.log("from reader");
    await zotlit.close();
    await reader.close();

    expect(messagesOf(zotlit)).toHaveLength(2);
    expect(messagesOf(reader)).toEqual([]);
  });

  it("keeps the other plugin's sinks when one plugin unloads", async () => {
    const zotlit = await startPluginBundle("zotlit", "info");
    const reader = await startPluginBundle("zotlit-reader", "info");

    await zotlit.close();
    expect(Symbol.for("logtape.rootLogger") in globalThis).toBe(true);
    reader.log("after zotlit unloaded");
    await reader.close();

    expect(messagesOf(reader)).toEqual(Array(2).fill("after zotlit unloaded"));
    expect(Symbol.for("logtape.rootLogger") in globalThis).toBe(false);
  });

  it("gives LogTape's own warnings to each plugin that runs", async () => {
    const zotlit = await startPluginBundle("zotlit", "info");
    const reader = await startPluginBundle("zotlit-reader", "info");
    const meta = getLogger(["logtape", "meta"]);

    await reader.setLevel("error");
    meta.warn("a sink failed");
    await zotlit.close();
    meta.warn("a sink failed again");
    await reader.close();

    expect(messagesOf(zotlit)).toEqual(["a sink failed"]);
    expect(messagesOf(reader)).toEqual([
      "a sink failed",
      "a sink failed again",
    ]);
  });

  it("replaces only that plugin's configuration on its second start", async () => {
    const first = await startPluginBundle("zotlit", "info");
    const reader = await startPluginBundle("zotlit-reader", "info");

    const second = await startPluginBundle("zotlit", "warning");
    second.log("second start");
    reader.log("reader beside it");
    await first.close();
    second.log("after the first closed");
    reader.log("reader after it");
    await second.close();
    await reader.close();

    expect(messagesOf(first)).toEqual([]);
    expect(new Set(messagesOf(second))).toEqual(
      new Set(["second start", "after the first closed"]),
    );
    expect(new Set(messagesOf(reader))).toEqual(
      new Set(["reader beside it", "reader after it"]),
    );
  });
});
