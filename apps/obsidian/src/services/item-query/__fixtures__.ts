// ZotLit Query built from its layer over a test's reads, for tests outside Effect.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Layer, Stream } from "effect";

import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { LibraryScope as SavedLibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { LibraryScope } from "@/services/library-scope/service.ts";
import { UseLedger } from "@/services/use-ledger/service.ts";
import { ZoteroPref } from "@/services/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service.ts";

import { bindQuery } from "./handle.ts";
import type { QueryHandle } from "./handle.ts";
import { layerQueryService, QueryService } from "./service.ts";

/** The Zotero source a test's jobs name. */
export interface QuerySource {
  readonly sourceId: string;
  readonly databasePath: string;
  readonly dataDir: string;
  readonly baseAttachmentPath: string | null;
}

export interface QueryFixtureOptions {
  /** The worker operations the jobs go to. */
  readonly reads: ZoteroReads["Service"]["reads"];
  readonly source: QuerySource;
  /** The saved Library Scope of each job; all Libraries where absent. */
  readonly effective?: () => SavedLibraryScope;
  /** The device Uses of each job; none where absent. */
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
    baseAttachmentPath: source.baseAttachmentPath,
    httpPort: null,
  };
}

/** ZotLit Query over `options.reads`, the real file system, and fixed deps. */
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
        layerTestObsidianEnv({
          vaultName: options.vaultName,
          basePath: options.basePath,
        }),
        NodeFileSystem.layer,
      ),
    ),
  );
}

/** The built service and its Promise edge. */
export interface QueryFixture {
  readonly service: QueryService["Service"];
  readonly handle: QueryHandle;
}

/** ZotLit Query from {@link layerTestQueryService}; `stack` closes it. */
export async function buildQueryService(
  options: QueryFixtureOptions,
  stack: AsyncDisposableStack,
): Promise<QueryFixture> {
  const runtime = buildRuntime(layerTestQueryService(options), stack);
  await runtime.context();
  const service = runtime.runSync(QueryService);
  return { service, handle: bindQuery(effectBridge(runtime), service) };
}
