import type { ReadsConfig } from "#contract/rpc.ts";
// The Worker side of ZoteroReads for a host's Worker entry: the handler layer
// over the host's Connection, served over the worker-runner protocol.
import { Effect, Layer, Logger, Ref } from "effect";
import type { FileSystem } from "effect";
import { RpcServer, RpcWorker } from "effect/rpc";

import {
  layerLibraryLogPort,
  makePortLogger,
} from "@zotlit/plugin-kernel/effect-log-port.ts";

import type { Connection } from "./connection.ts";
import { handlersLayer } from "./handlers.ts";
import type { HandlersOptions } from "./handlers.ts";
import { launchWorker } from "./worker-launch.ts";
import type { WorkerScope } from "./worker-launch.ts";

import { WorkerInitSchema, ZoteroReads } from "#contract/rpc.ts";

/** What a host gives the Worker: how it opens the database, and its platform. */
export interface ZoteroReadsWorkerHost {
  /**
   * The Connection the handlers borrow, over the settings the renderer sent
   * with the spawn. `snapshotOwner` is the tag the renderer reaps this
   * worker's read snapshots by.
   */
  readonly connection: (spawn: {
    readonly config: ReadsConfig;
    readonly snapshotOwner: string;
    readonly deferOpen: boolean;
  }) => Layer.Layer<Connection, never, FileSystem.FileSystem>;
  /** The host's reads beyond the spawn settings. */
  readonly handlers?: Pick<HandlersOptions, "readSegmenter" | "queryJobs">;
  /** The file system the Connection and the Query Jobs use. */
  readonly fileSystem: Layer.Layer<FileSystem.FileSystem>;
}

/**
 * Serve ZoteroReads from this Worker until the renderer's close message. The
 * handlers and the Connection start from the settings the renderer sent with
 * the spawn: the Connection opens them, the Item Index takes the locale.
 * Every log record goes to the port the renderer sent, at the level the
 * settings name, until `Configure` sends another.
 */
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
