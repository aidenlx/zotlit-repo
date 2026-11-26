import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Layer, Stream } from "effect";

import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { layerTestVaultDisk } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault-disk.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { LibraryScope as SavedLibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { bindQuery } from "#desktop/item-query/handle.ts";
import type { QueryHandle } from "#desktop/item-query/handle.ts";
import { layerQueryService, QueryService } from "#desktop/item-query/service.ts";

export interface QuerySource {
  readonly sourceId: string;
  readonly databasePath: string;
  readonly dataDir: string;
  readonly baseAttachmentPath: string | null;
}

export interface QueryFixtureOptions {
  readonly reads: ZoteroReads["Service"]["reads"];
  readonly source: QuerySource;
  readonly effective?: () => SavedLibraryScope;
  readonly uses?: Readonly<Record<string, number>>;
  readonly vaultName?: string;
  readonly basePath?: string;
  readonly pluginVersion?: string;
}

function prefSnapshot(source: QuerySource): ZoteroPrefSnapshot {
  return {
    state: "ready",
    prefs: new Map(),
    resolvedProfileDir: null,
    profileDirOverride: null,
    dataDirOverride: null,
    dataDir: source.dataDir,
    databasePath: source.databasePath,
    sourceId: source.sourceId,
    acceptedSourceIds: [source.sourceId],
    baseAttachmentPath: source.baseAttachmentPath,
    httpPort: null,
  };
}

export function layerTestQueryService(
  options: QueryFixtureOptions,
  useLedger: Layer.Layer<UseLedger> = Layer.mock(UseLedger, {
    uses: Effect.succeed(options.uses ?? {}),
    changes: Stream.empty,
  }),
): Layer.Layer<QueryService> {
  return layerQueryService({
    pluginVersion: options.pluginVersion ?? "2.2.0",
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ZoteroReads, { reads: options.reads }),
        Layer.mock(ZoteroPref, {
          current: Effect.succeed(prefSnapshot(options.source)),
        }),
        Layer.mock(LibraryScope, {
          effective: Effect.sync(
            (): SavedLibraryScope => options.effective?.() ?? { mode: "all" },
          ),
        }),
        useLedger,
        layerTestObsidianEnv({ vaultName: options.vaultName }),
        layerTestVaultDisk({ basePath: options.basePath }),
        NodeFileSystem.layer,
      ),
    ),
  );
}

export interface QueryFixture {
  readonly service: QueryService["Service"];
  readonly handle: QueryHandle;
}

export async function buildQueryService(
  options: QueryFixtureOptions,
  stack: AsyncDisposableStack,
): Promise<QueryFixture> {
  const runtime = buildRuntime(layerTestQueryService(options), stack);
  await runtime.context();
  const service = runtime.runSync(QueryService);
  return { service, handle: bindQuery(effectBridge(runtime), service) };
}
