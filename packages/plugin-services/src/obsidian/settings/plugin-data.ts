import { Context, Effect, Layer } from "effect";
import type { Cause } from "effect";
import type { Plugin } from "obsidian";

export class PluginData extends Context.Service<
  PluginData,
  {
    readonly load: Effect.Effect<unknown, Cause.UnknownError>;
    save(data: unknown): Effect.Effect<void, Cause.UnknownError>;
  }
>()("zotlit/obsidian/PluginData") {}

export function layerPluginData(
  plugin: Pick<Plugin, "loadData" | "saveData">,
): Layer.Layer<PluginData> {
  return Layer.succeed(
    PluginData,
    PluginData.of({
      load: Effect.tryPromise((): Promise<unknown> => plugin.loadData()),
      save: Effect.fn("PluginData.save")((data) =>
        Effect.tryPromise(() => plugin.saveData(data)),
      ),
    }),
  );
}
