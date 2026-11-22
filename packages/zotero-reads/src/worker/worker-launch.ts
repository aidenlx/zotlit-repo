import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { Effect, Layer } from "effect";
import { RpcServer } from "effect/rpc";

import { WORKER_CLOSED } from "#contract/worker-signal.ts";

export interface WorkerScope {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  postMessage(message: unknown): void;
  close(): void;
}

export function launchWorker<E>(
  scope: WorkerScope,
  server: Layer.Layer<never, E, RpcServer.Protocol>,
): void {
  const endpoint: WorkerScope = {
    addEventListener: scope.addEventListener.bind(scope),
    removeEventListener: scope.removeEventListener.bind(scope),
    postMessage: scope.postMessage.bind(scope),
    close: () => undefined,
  };
  const main = server.pipe(
    Layer.provide(
      RpcServer.layerProtocolWorkerRunner.pipe(
        Layer.provide(
          BrowserWorkerRunner.layerMessagePort(endpoint as MessagePort),
        ),
      ),
    ),
    Layer.launch,
    Effect.runFork,
  );
  main.addObserver(() => {
    scope.postMessage(WORKER_CLOSED);
    scope.close();
  });
}
