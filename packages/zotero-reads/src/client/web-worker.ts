import type { WebApiReadsConfig } from "#contract/rpc.ts";
import type { ZoteroReadsWeb } from "#contract/web-worker-rpc.ts";
import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { regex } from "arkregex";
import type { Scope } from "effect";
import { Effect, Layer } from "effect";
import type { RpcClientError } from "effect/rpc";
import { RpcClient, RpcWorker } from "effect/rpc";

import { layerHostLogPort } from "@zotlit/plugin-kernel/worker/effect-log-port.ts";
import type { PackRead } from "@zotlit/resource-pack/reader.ts";
import { refusalStatus } from "@zotlit/resource-pack/status.ts";
import type { PackBinaryRefusal } from "@zotlit/resource-pack/status.ts";

import {
  ReplicaWorkerInitSchema,
  WebWorkerInitSchema,
  ZoteroReadsWeb as ZoteroReadsWebGroup,
} from "#contract/web-worker-rpc.ts";
import {
  SQLITE_ENGINE_ENTRY,
  TEMPORAL_PIECE_URL_GLOBAL,
} from "#contract/web-worker.ts";
import {
  REPLICA_WORKER,
  WORKER_REQUEST_CONCURRENCY,
} from "#contract/worker-signal.ts";

export interface WebWorkerPackLocation {
  readonly version: string;
  readonly url: string;
}

export interface WebWorkerPack {
  readonly locate: Effect.Effect<WebWorkerPackLocation | null>;
  readEntry(
    location: WebWorkerPackLocation,
    name: string,
  ): Effect.Effect<PackRead>;
}

export type WebWorkerWasm =
  | { readonly kind: "ready"; readonly wasm: Uint8Array<ArrayBuffer> }
  | PackBinaryRefusal;

export interface WebWorkerCode {
  readonly source: Blob;
  readonly temporal: Blob;
}

const ENGINE_VERSION = regex(
  "^(?<major>0|[1-9]\\d*)\\.(?<minor>0|[1-9]\\d*)\\.(?<patch>0|[1-9]\\d*)-build(?<build>0|[1-9]\\d*)$",
);

function engineVersion(text: string): readonly number[] | undefined {
  const match = ENGINE_VERSION.exec(text);
  if (!match) return undefined;
  const { major, minor, patch, build } = match.groups;
  return [major, minor, patch, build].map(Number);
}

export function replicaDirectory(vaultId: string): string {
  return `/zotlit/${vaultId}`;
}

export const readWebWorkerWasm = Effect.fn("ZoteroReadsWeb.readWasm")(
  function* (
    pack: WebWorkerPack,
    glueVersion: string,
  ): Effect.fn.Return<WebWorkerWasm> {
    const location = yield* pack.locate;
    if (!location) return { kind: "pack-absent" };
    const engine = yield* pack.readEntry(location, SQLITE_ENGINE_ENTRY);
    if (!engine.ok) return refusalStatus(engine.failure);
    if (engine.upstreamVersion === undefined) return { kind: "pack-outdated" };
    const packed = engineVersion(engine.upstreamVersion);
    if (!packed) return { kind: "pack-damaged" };
    const glue = engineVersion(glueVersion);
    if (!glue)
      return yield* Effect.die(
        `The bundled glue version ${glueVersion} is malformed`,
      );
    const order = packed.reduce(
      (found, part, i) => found || part - glue[i]!,
      0,
    );
    if (order < 0) return { kind: "pack-outdated" };
    if (order > 0) return { kind: "plugin-outdated" };
    return { kind: "ready", wasm: engine.bytes };
  },
);

export const WEB_WORKER_NAME = "zotlit-zotero-reads-web";

export interface StartWebWorkerOptions {
  readonly config: WebApiReadsConfig;
  readonly storage?: "opfs-sahpool" | "memory";
  readonly spawn?: (url: string) => Worker;
}

export interface StartReplicaWorkerOptions {
  readonly config: WebApiReadsConfig;
  readonly replicaPath: string;
  readonly spawn?: (url: string) => Worker;
}

const script = (parts: BlobPart[]) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      URL.createObjectURL(new Blob(parts, { type: "text/javascript" })),
    ),
    (url) => Effect.sync(() => URL.revokeObjectURL(url)),
  );

const connectWebApiWorker = Effect.fnUntraced(function* (
  spawn: () => Worker,
  initialMessage: (logs: MessagePort) => Layer.Layer<RpcWorker.InitialMessage>,
): Effect.fn.Return<
  RpcClient.FromGroup<typeof ZoteroReadsWeb, RpcClientError.RpcClientError>,
  never,
  Scope.Scope
> {
  const { port1, port2 } = new MessageChannel();
  yield* Layer.build(
    layerHostLogPort(port1, {
      malformedMessage: "Ignored a malformed Zotero reads worker log record",
      category: ["zotero-reads"],
    }),
  );
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolWorker({
      size: 1,
      concurrency: WORKER_REQUEST_CONCURRENCY,
    }).pipe(
      Layer.provide(BrowserWorker.layer(spawn)),
      Layer.provide(initialMessage(port2)),
    ),
  ).pipe(Effect.orDie);
  return yield* RpcClient.make(ZoteroReadsWebGroup).pipe(
    Effect.provideContext(protocol),
  );
});

export const startWebWorker = Effect.fnUntraced(function* (
  ready: {
    readonly code: WebWorkerCode;
    readonly wasm: Uint8Array<ArrayBuffer>;
  },
  {
    config,
    storage = "opfs-sahpool",
    spawn = (url) => new Worker(url, { name: WEB_WORKER_NAME }),
  }: StartWebWorkerOptions,
) {
  const temporal = yield* script([ready.code.temporal]);
  const url = yield* script([
    `self[${JSON.stringify(TEMPORAL_PIECE_URL_GLOBAL)}] = ${JSON.stringify(temporal)};\n`,
    ready.code.source,
  ]);
  return yield* connectWebApiWorker(
    () => spawn(url),
    (logs) =>
      RpcWorker.layerInitialMessage(
        WebWorkerInitSchema,
        Effect.succeed({ wasm: ready.wasm, storage, config, logs }),
      ),
  );
});

export const startReplicaWorker = Effect.fnUntraced(function* (
  source: string,
  {
    config,
    replicaPath,
    spawn = (url) => new Worker(url, { name: REPLICA_WORKER }),
  }: StartReplicaWorkerOptions,
) {
  const url = yield* script([source]);
  return yield* connectWebApiWorker(
    () => spawn(url),
    (logs) =>
      RpcWorker.layerInitialMessage(
        ReplicaWorkerInitSchema,
        Effect.succeed({ replicaPath, config, logs }),
      ),
  );
});
