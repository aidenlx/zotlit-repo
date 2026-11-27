import type { DbUnavailable, WebApiReadsConfig } from "#contract/rpc.ts";
import type { Schema } from "effect";
import { Effect, FileSystem, Layer, Logger, Ref } from "effect";
import { RpcServer, RpcWorker } from "effect/rpc";

import {
  layerLibraryLogPort,
  makePortLogger,
} from "@zotlit/plugin-kernel/worker/effect-log-port.ts";
import type { WebApiFetch } from "@zotlit/web-library";

import type { QueryJobRunner } from "./handlers.ts";
import { handlersLayer } from "./handlers.ts";
import { layerUnpinnedConnectionItemSource } from "./item-source.ts";
import type { ReplicaDriver } from "./replica-driver.ts";
import type { ReadSegmenter } from "./segmenter.ts";
import { readSegmenterFromPack } from "./segmenter.ts";
import { sha256Hex } from "./snapshot/sha256.ts";
import { layerWebApiSource, WebLibrarySync } from "./web-api-source.ts";
import type { WorkerScope } from "./worker-launch.ts";
import { launchWorker } from "./worker-launch.ts";

import { ReplicaRequests, ZoteroReadsWeb } from "#contract/web-worker-rpc.ts";

const globalFetch: WebApiFetch = (url, init) => fetch(url, init);

export const layerAbsentFileSystem: Layer.Layer<FileSystem.FileSystem> =
  FileSystem.layerNoop({});

export const layerReplicaRequests = ReplicaRequests.toLayer(
  Effect.gen(function* () {
    const sync = yield* WebLibrarySync;
    return ReplicaRequests.of({
      SyncStatus: () => sync.status,
      RemoveReplica: () => sync.removeReplica,
      SyncProgress: () => sync.progress,
      StopSync: ({ syncId }) => sync.stopSync(syncId),
    });
  }),
);

export interface WebRootOptions {
  readonly fetch?: WebApiFetch;
  readonly queryJobs: QueryJobRunner;
  readonly readSegmenter?: ReadSegmenter;
}

type WebApiInit = Schema.Decoder<{
  readonly config: WebApiReadsConfig;
  readonly logs: MessagePort;
}>;

export interface WebApiRoot<S extends WebApiInit> {
  readonly init: S;
  readonly driver: (
    init: S["Type"],
  ) => Effect.Effect<ReplicaDriver, DbUnavailable>;
  readonly file?: (init: S["Type"]) => string;
}

export function serveWebApiReads<S extends WebApiInit>(
  scope: WorkerScope,
  root: WebApiRoot<S>,
  {
    fetch = globalFetch,
    queryJobs,
    readSegmenter = readSegmenterFromPack,
  }: WebRootOptions,
): void {
  const handlers = Layer.unwrap(
    RpcWorker.initialMessage(root.init).pipe(
      Effect.orDie,
      Effect.map((init) => {
        const level = Ref.makeUnsafe(init.config.logLevel);
        const file = root.file?.(init);
        const source = layerWebApiSource({
          driver: root.driver(init),
          fetch,
          initial: init.config,
          ...(file !== undefined && { file }),
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
