import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";

import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import type { SyncWorker } from "./sync-run.ts";
import { makeSyncRuns } from "./sync-run.ts";

interface FakeWorker extends SyncWorker {
  readonly asked: number[];
}

const workerAnswering = (
  answer: (syncId: number) => Effect.Effect<boolean>,
): FakeWorker => {
  const asked: number[] = [];
  return {
    asked,
    StopSync: ({ syncId }) =>
      Effect.andThen(
        Effect.sync(() => asked.push(syncId)),
        answer(syncId),
      ),
  };
};

const runsOf = () =>
  makeSyncRuns<FakeWorker>({
    stopped: () => new DbUnavailable({ message: "The Worker stopped" }),
    changed: Effect.void,
  });

it.effect(
  "keeps a stop to the Worker that confirmed it: a new Worker with the same sync number has no stop and is asked again",
  () =>
    Effect.gen(function* () {
      const runs = runsOf();
      const first = workerAnswering(() => Effect.succeed(true));
      const second = workerAnswering(() => Effect.succeed(true));
      yield* runs.stop(first, 1);
      expect(runs.view(first, 1)).toEqual({ syncId: 1, state: "confirmed" });
      expect(runs.view(second, 1)).toBeNull();

      yield* runs.stop(second, 1);
      expect(first.asked).toEqual([1]);
      expect(second.asked).toEqual([1]);
      expect(runs.view(second, 1)).toEqual({ syncId: 1, state: "confirmed" });
    }),
);

it.effect(
  "ends the sync of a detached Worker for its callers, and drops the late answer to its stop",
  () =>
    Effect.gen(function* () {
      const runs = runsOf();
      const asked = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<void>();
      const worker = workerAnswering(() =>
        Effect.andThen(
          Deferred.succeed(asked, undefined),
          Effect.as(Deferred.await(answer), true),
        ),
      );
      const scope = yield* Scope.make();
      const run = yield* runs.begin({
        worker,
        key: "key",
        scope,
        refresh: Effect.never,
      });
      expect(runs.current(worker)).toBe(run);
      const stopping = yield* Effect.forkChild(runs.stop(worker, 2), {
        startImmediately: true,
      });
      yield* Deferred.await(asked);
      expect(runs.view(worker, 2)).toEqual({ syncId: 2, state: "requested" });

      runs.detach(worker);
      expect(runs.current(worker)).toBeNull();
      expect(yield* Effect.flip(Deferred.await(run.done))).toBeInstanceOf(
        DbUnavailable,
      );

      yield* Deferred.succeed(answer, undefined);
      yield* Fiber.join(stopping);
      expect(runs.view(worker, 2)).toBeNull();
      yield* Scope.close(scope, Exit.void);
    }),
);
