import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { Effect, Schema } from "effect";
import { RpcClient, RpcClientError } from "effect/rpc";
import { WorkerError } from "effect/workers/WorkerError";

import {
  SnapshotIntegrity,
  snapshotFailure,
  verifySnapshotInProcess,
} from "./snapshot-integrity-check.ts";

import { DbUnavailable } from "#contract/db-unavailable.ts";
import { SNAPSHOT_INTEGRITY_WORKER } from "#contract/worker-signal.ts";
import { spawnWorker } from "#worker/worker-launch.ts";

const invalidReply = () =>
  new DbUnavailable({
    message: "Invalid database snapshot verification reply",
  });

export type VerifySnapshot = (
  path: string,
) => Effect.Effect<void, DbUnavailable>;

export function snapshotVerifier(workerUrl: string): VerifySnapshot {
  return typeof Worker === "undefined"
    ? verifySnapshotInProcess
    : (path) => verifySnapshotInWorker(path, workerUrl);
}

const verifySnapshotInWorker = Effect.fnUntraced(
  function* (path: string, url: string): Effect.fn.Return<void, DbUnavailable> {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const worker = yield* Effect.acquireRelease(
          Effect.try({
            try: () => spawnWorker(url, SNAPSHOT_INTEGRITY_WORKER),
            catch: snapshotFailure,
          }),
          (worker) => Effect.sync(() => worker.terminate()),
        );
        const check = Effect.gen(function* () {
          const protocol = yield* RpcClient.makeProtocolWorker({ size: 1 });
          const client = yield* RpcClient.make(SnapshotIntegrity, {
            disableTracing: true,
          }).pipe(Effect.provideService(RpcClient.Protocol, protocol));
          yield* client.Check({ path });
        }).pipe(
          Effect.provide(BrowserWorker.layer(() => worker)),
          Effect.mapError((error) => {
            if (error instanceof DbUnavailable) return error;
            if (
              error instanceof RpcClientError.RpcClientError &&
              "cause" in error.reason
            )
              return snapshotFailure(error.reason.cause ?? error);
            return snapshotFailure(error);
          }),
        );
        yield* Effect.raceFirst(workerFailure(worker), check).pipe(
          Effect.timeoutOrElse({
            duration: "60 seconds",
            orElse: () =>
              Effect.fail(
                new DbUnavailable({
                  message: "Database snapshot verification timed out",
                }),
              ),
          }),
        );
      }),
    );
  },
  Effect.catchDefect((error) =>
    Effect.fail(
      Schema.isSchemaError(error)
        ? invalidReply()
        : snapshotFailure(
            error instanceof WorkerError
              ? (error.reason.cause ?? error)
              : error,
          ),
    ),
  ),
);

function workerFailure(worker: Worker) {
  return Effect.callback<never, DbUnavailable>((resume) => {
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      fail(new DbUnavailable({ message: event.message }));
    };
    const onMessageError = () => fail(invalidReply());
    const clear = () => {
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
    };
    const fail = (error: DbUnavailable) => {
      clear();
      resume(Effect.fail(error));
    };
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    return Effect.sync(clear);
  });
}
