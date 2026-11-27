import type { FileReadsConfig } from "#contract/rpc.ts";
import type { FileSystem } from "effect";
import { Effect, Layer, Logger, Ref } from "effect";
import { RpcServer, RpcWorker } from "effect/rpc";

import {
  layerLibraryLogPort,
  makePortLogger,
} from "@zotlit/plugin-kernel/worker/effect-log-port.ts";

import type { Connection } from "./connection.ts";
import type { HandlersOptions } from "./handlers.ts";
import { handlersLayer } from "./handlers.ts";
import type { WorkerScope } from "./worker-launch.ts";
import { launchWorker } from "./worker-launch.ts";

import { WorkerInitSchema, ZoteroReads } from "#contract/rpc.ts";

export interface ZoteroReadsWorkerHost {
  readonly connection: (spawn: {
    readonly config: FileReadsConfig;
    readonly snapshotOwner: string;
    readonly deferOpen: boolean;
  }) => Layer.Layer<Connection, never, FileSystem.FileSystem>;
  readonly handlers: Pick<
    HandlersOptions,
    "readSegmenter" | "queryJobs" | "snapshotRevision"
  >;
  readonly fileSystem: Layer.Layer<FileSystem.FileSystem>;
}

export function serveZoteroReads(
  scope: WorkerScope,
  host: ZoteroReadsWorkerHost,
): void {
  const handlers = Layer.unwrap(
    RpcWorker.initialMessage(WorkerInitSchema).pipe(
      Effect.orDie,
      Effect.map(({ snapshotOwner, deferOpen, logs, ...config }) => {
        const level = Ref.makeUnsafe(config.logLevel);
        return handlersLayer({
          ...host.handlers,
          locale: config.locale,
          chineseSegmenter: config.chineseSegmenter,
          applyLogLevel: (next) => Ref.set(level, next),
        }).pipe(
          Layer.provide(host.connection({ config, snapshotOwner, deferOpen })),
          Layer.provide(Logger.layer([makePortLogger(logs, level)])),
          Layer.provide(layerLibraryLogPort),
          Layer.provide(host.fileSystem),
        );
      }),
    ),
  );
  launchWorker(
    scope,
    RpcServer.layer(ZoteroReads).pipe(Layer.provide(handlers)),
  );
}
