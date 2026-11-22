import { Context, DateTime, Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";

import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { MemoryMetadataCache } from "@zotlit/obsidian-kit/__fixtures__/obsidian-metadata-cache.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import { layerUseLedger, UseLedger } from "./service.ts";

export interface LedgerHost extends HostSources {
  readonly deviceStorage: MemoryDeviceStorage;
  readonly workspace: MemoryWorkspace;
  readonly metadataCache: MemoryMetadataCache;
}

export function ledgerHost(sources: Partial<LedgerHost> = {}): LedgerHost {
  return {
    deviceStorage: sources.deviceStorage ?? new MemoryDeviceStorage(),
    workspace: sources.workspace ?? new MemoryWorkspace(),
    metadataCache: sources.metadataCache ?? new MemoryMetadataCache(),
  };
}

export function useLedgerOf(
  host: HostSources,
): Effect.Effect<UseLedger["Service"], never, Scope.Scope> {
  return Effect.map(Layer.build(ledgerOver(host)), Context.get(UseLedger));
}

export function buildUseLedger(host: HostSources, stack: AsyncDisposableStack) {
  const runtime = buildRuntime(ledgerOver(host), stack);
  return Object.assign(runtime.runSync(UseLedger), { runtime });
}

export const inertUseLedger: UseLedger["Service"] = {
  current: Effect.succeed({}),
  get: () => Effect.succeed(undefined),
  uses: Effect.succeed({}),
  record: (_itemKey, kind, instant = DateTime.nowUnsafe()) =>
    Effect.succeed({ instant, kind }),
  withoutNoteUse: (_file, open) => open,
  changes: Stream.succeed({}),
};

function ledgerOver(host: HostSources): Layer.Layer<UseLedger> {
  return layerUseLedger.pipe(Layer.provide(layerHost(host)));
}
