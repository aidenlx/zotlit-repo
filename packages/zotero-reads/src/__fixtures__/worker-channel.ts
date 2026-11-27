import { Effect } from "effect";
import type { Scope } from "effect";

import type { StartWebWorkerOptions } from "#client/web-worker.ts";
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
