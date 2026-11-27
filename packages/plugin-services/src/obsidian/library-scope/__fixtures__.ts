import type { SettingsDefinition } from "#core/settings/schema.ts";
import type { Scope } from "effect";
import { Context, Effect, Layer } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import {
  layerZoteroReads,
  ZoteroReads,
} from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsClient } from "@zotlit/zotero-reads/contract/rpc.ts";

import { layerLibraryScope, LibraryScope } from "./service.ts";

import { layerQueryClients } from "#core/query-client/service.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "#obsidian/settings/service.ts";

export const libraryScopeFixture = Effect.fnUntraced(function* (
  definition: SettingsDefinition,
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  saved: unknown = { __VERSION__: 11 },
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() =>
      openLibraryScope(client, { definition, saved }, context),
    ),
    (fixture) => Effect.promise(() => fixture.close()),
  );
});

export async function openLibraryScope(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  {
    definition,
    saved,
  }: { readonly definition: SettingsDefinition; readonly saved: unknown },
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerLibraryScope.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          layerQueryClients,
          layerZoteroReads(client),
          layerPluginSettings(
            { loadData: async () => saved, saveData: async () => {} },
            { definition },
          ),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = runtime.runSync(LibraryScope);
  const settings = runtime.runSync(PluginSettings);
  const bridge = effectBridge(runtime);
  const reads = Object.assign(runtime.runSync(ZoteroReads), {
    bridge: effectBridge(runtime),
    runtime,
  });
  const owned = stack.move();
  return {
    runtime,
    service,
    settings,
    bridge,
    reads,
    close: () => owned.disposeAsync(),
  };
}

export async function buildLibraryScope(
  deps: {
    reads: Pick<ZoteroReads["Service"], "reads" | "events">;
    settings: PluginSettings["Service"];
  },
  stack: AsyncDisposableStack,
) {
  const settings = deps.settings;
  const runtime = buildRuntime(
    layerLibraryScope.pipe(
      Layer.provide(
        Layer.mergeAll(
          layerQueryClients,
          Layer.succeed(
            PluginSettings,
            stubService<PluginSettings["Service"]>("PluginSettings", {
              current: settings.current,
              diagnostics: settings.diagnostics,
              changes: settings.changes,
            }),
          ),
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              ...deps.reads,
            }),
          ),
        ),
      ),
    ),
    stack,
  );
  await runtime.context();
  return Object.assign(runtime.runSync(LibraryScope), {
    bridge: effectBridge(runtime),
    runtime,
  });
}
