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
  Object.assign(globalThis, { __PLUGIN_ID__: "zotlit" });
});

async function startPluginBundle(
  id: string,
  level: string,
): Promise<RunningPlugin> {
  vi.resetModules();
  Object.assign(globalThis, { __PLUGIN_ID__: id });
  const { currentLogOutputs, logServices, withLogCategory } =
    await import("@zotlit/plugin-kernel/effect-log.ts");
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
      Layer.provide(layerLogOutput(plugin.manifest.dir, adapter)),
      Layer.provideMerge(
        layerPluginSettings(plugin, { definition: platformSettings }),
      ),
    ),
    stack,
  );
  await graph.context();
  const settings = graph.runSync(PluginSettings);
  const levelApplied = (next: string) =>
    vi.waitFor(() => expect(currentLogOutputs().level).toBe(next));
  await levelApplied(level);

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
      runtime.runSyncWith(logServices)(
        Effect.logWarning(message).pipe(withLogCategory("plain")),
      );
    },
    setLevel: async (next) => {
      await graph.runPromise(settings.update({ "log.level": next as never }));
      await levelApplied(next);
    },
    close: async () => {
      open.delete(running);
      await stack.disposeAsync();
    },
  };
  open.add(running);
  return running;
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
      "zotlit.obsidian.plain",
    ]);
    expect(reader.appendedRecords().map((record) => record.logger)).toEqual([
      "zotlit-reader.obsidian",
      "zotlit-reader.obsidian.plain",
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
    reader.log("after zotlit unloaded");
    await reader.close();

    expect(messagesOf(reader)).toEqual(Array(2).fill("after zotlit unloaded"));
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
