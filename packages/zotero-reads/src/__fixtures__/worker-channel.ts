import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { Effect, Layer } from "effect";
import type { Scope } from "effect";
import { RpcClient, RpcWorker } from "effect/rpc";

import type { StartWebWorkerOptions } from "#client/web-worker.ts";
import type {
  FileReadsConfig,
  ZoteroReadsClient,
} from "#contract/rpc.ts";
import { WorkerInitSchema, ZoteroReads } from "#contract/rpc.ts";
import type { ZoteroReadsWorkerHost } from "#worker/serve.ts";
import { serveZoteroReads } from "#worker/serve.ts";
import type { WorkerScope } from "#worker/worker-launch.ts";

type HostWorker = ReturnType<NonNullable<StartWebWorkerOptions["spawn"]>>;

export interface WorkerChannel {
  readonly scope: WorkerScope;
  readonly spawn: () => HostWorker;
}

export const workerChannel: Effect.Effect<WorkerChannel, never, Scope.Scope> =
  Effect.gen(function* () {
    const { port1, port2 } = new MessageChannel();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        port1.close();
        port2.close();
      }),
    );
    const scope: WorkerScope = {
      addEventListener: (type, listener) =>
        port2.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        port2.removeEventListener(type, listener),
      postMessage: (message) => port2.postMessage(message),
      close: () => port2.close(),
    };
    const spawn = () =>
      ({
        postMessage: (message: unknown, transfer?: Transferable[]) =>
          port1.postMessage(message, transfer ?? []),
        addEventListener: (
          type: string,
          listener: EventListenerOrEventListenerObject,
        ) => {
          port1.addEventListener(type, listener);
          port1.start();
        },
        removeEventListener: (
          type: string,
          listener: EventListenerOrEventListenerObject,
        ) => port1.removeEventListener(type, listener),
        terminate: () => port1.close(),
      }) as unknown as HostWorker;
    return {
      scope,
      spawn: () => {
        port2.start();
        return spawn();
      },
    };
  });

export const workerChannelClient = Effect.fnUntraced(function* (
  host: ZoteroReadsWorkerHost,
  config: FileReadsConfig,
): Effect.fn.Return<ZoteroReadsClient, never, Scope.Scope> {
  const channel = yield* workerChannel;
  serveZoteroReads(channel.scope, host);
  const logs = new MessageChannel();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      logs.port1.close();
      logs.port2.close();
    }),
  );
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolWorker({ size: 1 }).pipe(
      Layer.provide(BrowserWorker.layer(() => channel.spawn() as never)),
      Layer.provide(
        RpcWorker.layerInitialMessage(
          WorkerInitSchema,
          Effect.succeed({
            ...config,
            snapshotOwner: "worker-channel",
            deferOpen: false,
            logs: logs.port2,
          }),
        ),
      ),
    ),
  ).pipe(Effect.orDie);
  const client = yield* RpcClient.make(ZoteroReads).pipe(
    Effect.provideContext(protocol),
  );
  yield* Effect.orDie(client.Configure(config));
  return client;
});
