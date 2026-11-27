import type { WebWorkerInit } from "#contract/web-worker-rpc.ts";
import { Effect, FileSystem, Layer, Logger, Ref } from "effect";
import { RpcServer, RpcWorker } from "effect/rpc";

import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import type { SqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import {
  layerLibraryLogPort,
  makePortLogger,
} from "@zotlit/plugin-kernel/worker/effect-log-port.ts";
import type { WebApiFetch } from "@zotlit/web-library";

import { toDbUnavailable } from "./connection.ts";
import type { QueryJobRunner } from "./handlers.ts";
import { handlersLayer } from "./handlers.ts";
import { layerUnpinnedConnectionItemSource } from "./item-source.ts";
import type { ReadSegmenter } from "./segmenter.ts";
import { readSegmenterFromPack } from "./segmenter.ts";
import { sha256Hex } from "./snapshot/sha256.ts";
import { layerWebApiSource, WebLibrarySync } from "./web-api-source.ts";
import type { WorkerScope } from "./worker-launch.ts";
import { launchWorker } from "./worker-launch.ts";

import {
  ReplicaRequests,
  WebWorkerInitSchema,
  ZoteroReadsWeb,
} from "#contract/web-worker-rpc.ts";

const loadEngine = (init: WebWorkerInit): Promise<SqliteWasm> =>
  init.storage === "memory"
    ? loadSqliteWasm({ wasm: init.wasm, storage: "memory" })
    : loadSqliteWasm({
        wasm: init.wasm,
        storage: "opfs-sahpool",
        directory: init.config.poolDirectory,
      });

const globalFetch: WebApiFetch = (url, init) => fetch(url, init);

export const layerAbsentFileSystem: Layer.Layer<FileSystem.FileSystem> =
  FileSystem.layerNoop({});

export const layerReplicaRequests = ReplicaRequests.toLayer(
  Effect.gen(function* () {
    const sync = yield* WebLibrarySync;
    return ReplicaRequests.of({
      SyncStatus: () => sync.status,
      RemoveReplica: () => sync.removeReplica,
    });
  }),
);

export interface WebRootOptions {
  readonly fetch?: WebApiFetch;
  readonly queryJobs: QueryJobRunner;
  readonly readSegmenter?: ReadSegmenter;
}

export function serveZoteroReadsWeb(
  scope: WorkerScope,
  {
    fetch = globalFetch,
    queryJobs,
    readSegmenter = readSegmenterFromPack,
  }: WebRootOptions,
): void {
  const handlers = Layer.unwrap(
    RpcWorker.initialMessage(WebWorkerInitSchema).pipe(
      Effect.orDie,
      Effect.map((init) => {
        const level = Ref.makeUnsafe(init.config.logLevel);
        const source = layerWebApiSource({
          engine: Effect.tryPromise({
            try: () => loadEngine(init),
            catch: toDbUnavailable,
          }),
          fetch,
          initial: init.config,
        });
        return Layer.mergeAll(
          handlersLayer({
            snapshotRevision: sha256Hex,
            locale: init.config.locale,
            chineseSegmenter: init.config.chineseSegmenter,
            applyLogLevel: (next) => Ref.set(level, next),
            itemSource: layerUnpinnedConnectionItemSource,
            queryJobs,
            readSegmenter,
          }),
          layerReplicaRequests,
        ).pipe(
          Layer.provide(source),
          Layer.provide(Logger.layer([makePortLogger(init.logs, level)])),
          Layer.provide(layerLibraryLogPort),
          Layer.provide(layerAbsentFileSystem),
        );
      }),
    ),
  );
  launchWorker(
    scope,
    RpcServer.layer(ZoteroReadsWeb).pipe(Layer.provide(handlers)),
  );
}
