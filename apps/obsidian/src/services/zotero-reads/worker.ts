// Web Worker entry: serves the ZoteroReads handler layer over the worker-runner protocol.
// Obsidian runs workers with Node integration, so `node:sqlite` and `node:fs`
// load here through the worker's `require`.

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Layer, Logger, Ref } from "effect";
import { RpcServer, RpcWorker } from "effect/rpc";

import {
  layerLibraryLogPort,
  makePortLogger,
} from "@zotlit/plugin-kernel/effect-log-port.ts";

import { prepareRead } from "@/services/database/read-source.ts";

import { handlersLayer } from "./handlers.ts";
import { WorkerInitSchema, ZoteroReads } from "./rpc.ts";
import { readSegmenterFromOpfs } from "./segmenter.ts";
import { layerSource } from "./source.ts";
import { launchWorker } from "./worker-launch.ts";

/**
 * The handlers and the source start from the settings the renderer sent with
 * the spawn: the source opens them, the Item Index takes the locale. Every
 * read snapshot carries the owner tag the renderer sent, and every log record
 * goes to the port it sent. The worker's own runtime reaches the Node file
 * system once, for the source's snapshot sweeps.
 */
const HandlersLive = Layer.unwrap(
  RpcWorker.initialMessage(WorkerInitSchema).pipe(
    Effect.orDie,
    Effect.map(({ snapshotOwner, logs, ...config }) => {
      const level = Ref.makeUnsafe(config.logLevel);
      return handlersLayer({
        locale: config.locale,
        chineseSegmenter: config.chineseSegmenter,
        readSegmenter: readSegmenterFromOpfs,
        applyLogLevel: (next) => Ref.set(level, next),
      }).pipe(
        Layer.provide(
          layerSource({
            initial: config,
            ports: {
              prepareRead: (mode, path) =>
                prepareRead(mode, path, snapshotOwner),
            },
          }),
        ),
        Layer.provide(Logger.layer([makePortLogger(logs, level)])),
        Layer.provide(layerLibraryLogPort),
        Layer.provide(NodeFileSystem.layer),
      );
    }),
  ),
);

launchWorker(
  self,
  RpcServer.layer(ZoteroReads).pipe(Layer.provide(HandlersLive)),
);
