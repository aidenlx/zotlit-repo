import type { ZoteroReadsClient } from "#contract/rpc.ts";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Queue, Scope, Stream } from "effect";
import { describe, expect } from "vitest";

import {
  settledOnStop,
  stoppedErrors,
  streamUntilStopped,
  untilStopped,
} from "./settle-on-stop.ts";

import { DbUnavailable } from "#contract/db-unavailable.ts";
import { ZoteroReads } from "#contract/rpc.ts";

const asked = () => {
  let sent = 0;
  return {
    request: Effect.sync(() => ++sent),
    sent: () => sent,
  };
};

describe("a request on a connection that stops", () => {
  it.effect(
    "gives the stop reason to a caller after the stop and sends no request",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const stopped = yield* Deferred.make<DbUnavailable>();
        const reason = new DbUnavailable({ message: "The worker stopped" });
        yield* Deferred.succeed(stopped, reason);
        const read = asked();
        const failed = yield* Effect.flip(
          untilStopped(read.request, {
            stopped,
            onStop: (stop) => stop,
            scope,
          }),
        );
        expect(failed).toBe(reason);
        expect(read.sent()).toBe(0);
      }),
  );

  it.live(
    "gives a stop error to a caller after its scope closed and sends no request",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        yield* Scope.close(scope, Exit.void);
        const stopped = yield* Deferred.make<DbUnavailable>();
        const read = asked();
        const failed = yield* Effect.flip(
          untilStopped(read.request, {
            stopped,
            onStop: (stop) => stop,
            scope,
          }).pipe(Effect.timeout("1 second")),
        );
        expect(failed).toBeInstanceOf(DbUnavailable);
        expect(read.sent()).toBe(0);
      }),
  );
});

describe("a stream on a connection that stops", () => {
  it.effect(
    "gives the stop reason to a stream that starts after the stop and sends no request",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const stopped = yield* Deferred.make<DbUnavailable>();
        const reason = new DbUnavailable({ message: "The worker stopped" });
        yield* Deferred.succeed(stopped, reason);
        const read = asked();
        const failed = yield* Effect.flip(
          Stream.runDrain(
            streamUntilStopped(Stream.fromEffect(read.request), {
              stopped,
              onStop: (stop) => stop,
              scope,
            }),
          ),
        );
        expect(failed).toBe(reason);
        expect(read.sent()).toBe(0);
      }),
  );

  it.live(
    "gives a stop error to a stream that starts after its scope closed and sends no request",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        yield* Scope.close(scope, Exit.void);
        const stopped = yield* Deferred.make<DbUnavailable>();
        const read = asked();
        const failed = yield* Effect.flip(
          Stream.runDrain(
            streamUntilStopped(
              Stream.fromEffect(Effect.andThen(read.request, Effect.never)),
              { stopped, onStop: (stop) => stop, scope },
            ),
          ).pipe(Effect.timeout("1 second")),
        );
        expect(failed).toBeInstanceOf(DbUnavailable);
        expect(read.sent()).toBe(0);
      }),
  );
});

describe("a client settled on the stop of its worker", () => {
  const pending = () => {
    const asked: unknown[] = [];
    const client = {
      Snapshot: (_payload: unknown, options?: { asQueue?: boolean }) => {
        asked.push(options?.asQueue ?? false);
        return options?.asQueue
          ? Effect.die("the session asks the transport for a queue")
          : Stream.never;
      },
    } as unknown as ZoteroReadsClient;
    return { client, asked };
  };
  const reason = new DbUnavailable({ message: "The worker stopped" });

  it.effect("ends a pending stream with the stop reason", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const stopped = yield* Deferred.make<DbUnavailable>();
      const { client } = pending();
      const settled = settledOnStop(ZoteroReads, client, {
        stopped,
        onStop: stoppedErrors(ZoteroReads),
        scope,
      });
      const drained = yield* Effect.forkChild(
        Effect.flip(Stream.runDrain(settled.Snapshot())),
        { startImmediately: true },
      );
      yield* Deferred.succeed(stopped, reason);
      expect(yield* Fiber.await(drained)).toEqual(Exit.succeed(reason));
    }),
  );

  it.effect(
    "gives a queue to a stream call in queue mode and fails the queue with the stop reason",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const stopped = yield* Deferred.make<DbUnavailable>();
        const { client, asked } = pending();
        const settled = settledOnStop(ZoteroReads, client, {
          stopped,
          onStop: stoppedErrors(ZoteroReads),
          scope,
        });
        const queue = yield* (
          settled.Snapshot(undefined, { asQueue: true }) as Effect.Effect<
            Queue.Dequeue<unknown, unknown>,
            never,
            Scope.Scope
          >
        ).pipe(Scope.provide(scope));
        const taken = yield* Effect.forkChild(Effect.flip(Queue.take(queue)), {
          startImmediately: true,
        });
        yield* Deferred.succeed(stopped, reason);
        expect(yield* Fiber.await(taken)).toEqual(Exit.succeed(reason));
        expect(asked).toEqual([false]);
      }),
  );
});
