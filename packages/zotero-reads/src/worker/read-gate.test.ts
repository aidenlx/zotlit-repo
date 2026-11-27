import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Option, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { makeReadGate } from "./read-gate.ts";

const started = { startImmediately: true } as const;

const hold = (gate: Effect.Success<ReturnType<typeof makeReadGate>>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Scope.provide(gate.enter, scope);
    return scope;
  });

describe("the read gate", () => {
  it.effect(
    "tells the exclusive step how long the gate has been closed: with the drain of a short reader, and without a reader held past the hold-back",
    () =>
      Effect.gen(function* () {
        const gate = yield* makeReadGate("1 second");
        const closedFor = (held: `${number} millis`) =>
          Effect.gen(function* () {
            const reader = yield* hold(gate);
            const running = yield* Deferred.make<void>();
            const writer = yield* gate
              .exclusiveTimed((closedMillis) =>
                Effect.andThen(
                  Deferred.succeed(running, undefined),
                  Effect.andThen(
                    Effect.sleep("10 millis"),
                    Effect.sync(closedMillis),
                  ),
                ),
              )
              .pipe(Effect.forkChild(started));
            expect(gate.waiting()).toBe(true);
            yield* TestClock.adjust(held);
            yield* Scope.close(reader, Exit.void);
            yield* Deferred.await(running);
            yield* TestClock.adjust("10 millis");
            return yield* Fiber.join(writer);
          });
        expect(yield* closedFor("300 millis")).toBe(310);
        expect(yield* closedFor("1500 millis")).toBe(10);
      }),
  );

  it.effect("runs the exclusive step at once when no reader holds it", () =>
    Effect.gen(function* () {
      const gate = yield* makeReadGate("1 second");
      expect(yield* gate.exclusive(Effect.succeed("ran"))).toBe("ran");
    }),
  );

  it.effect("waits for a held reader, and runs when that reader leaves", () =>
    Effect.gen(function* () {
      const gate = yield* makeReadGate("1 second");
      const reader = yield* hold(gate);
      const ran = yield* Deferred.make<void>();
      const writer = yield* gate
        .exclusive(Deferred.succeed(ran, undefined))
        .pipe(Effect.forkChild(started));
      expect(gate.waiting()).toBe(true);
      expect(yield* Deferred.isDone(ran)).toBe(false);
      yield* TestClock.adjust("10 seconds");
      yield* Effect.scoped(gate.enter);
      expect(yield* Deferred.isDone(ran)).toBe(false);
      yield* Scope.close(reader, Exit.void);
      yield* Fiber.join(writer);
      expect(yield* Deferred.isDone(ran)).toBe(true);
      expect(gate.waiting()).toBe(false);
    }),
  );

  it.effect(
    "holds a new reader back while the exclusive step waits, then lets it in after the step",
    () =>
      Effect.gen(function* () {
        const gate = yield* makeReadGate("1 second");
        const first = yield* hold(gate);
        const order: string[] = [];
        const writer = yield* gate
          .exclusive(Effect.sync(() => order.push("apply")))
          .pipe(Effect.forkChild(started));
        const late = yield* Effect.scoped(
          Effect.andThen(
            gate.enter,
            Effect.sync(() => order.push("late read")),
          ),
        ).pipe(Effect.forkChild(started));
        expect(order).toEqual([]);
        yield* Scope.close(first, Exit.void);
        yield* Fiber.join(writer);
        yield* Fiber.join(late);
        expect(order).toEqual(["apply", "late read"]);
      }),
  );

  it.effect(
    "lets readers in again after the hold-back while a long reader holds it, and runs once the long reader leaves",
    () =>
      Effect.gen(function* () {
        const gate = yield* makeReadGate("1 second");
        const pinned = yield* hold(gate);
        const order: string[] = [];
        const writer = yield* gate
          .exclusive(Effect.sync(() => order.push("apply")))
          .pipe(Effect.forkChild(started));
        const reader = yield* Effect.scoped(
          Effect.andThen(
            gate.enter,
            Effect.sync(() => order.push("read")),
          ),
        ).pipe(Effect.forkChild(started));
        expect(order).toEqual([]);
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(reader);
        expect(order).toEqual(["read"]);
        yield* Scope.close(pinned, Exit.void);
        yield* Fiber.join(writer);
        expect(order).toEqual(["read", "apply"]);
      }),
  );

  it.effect(
    "is not starved by a steady stream of reads that are each shorter than the hold-back",
    () =>
      Effect.gen(function* () {
        const gate = yield* makeReadGate("1 second");
        let reads = 0;
        const entered = yield* Deferred.make<void>();
        const stream = Effect.forever(
          Effect.scoped(
            Effect.andThen(
              gate.enter,
              Effect.andThen(
                Effect.sleep("200 millis"),
                Effect.sync(() => {
                  reads++;
                }),
              ),
            ),
          ).pipe(Effect.forkChild, Effect.andThen(Effect.sleep("100 millis"))),
        ).pipe(Effect.forkChild);
        const streams = yield* Effect.all([stream, stream, stream]);
        yield* TestClock.adjust("1 second");
        const writer = yield* gate
          .exclusive(Deferred.succeed(entered, undefined))
          .pipe(Effect.forkChild);
        const waited = yield* Deferred.await(entered).pipe(
          Effect.timeoutOption("300 millis"),
          Effect.forkChild({ startImmediately: true }),
        );
        yield* TestClock.adjust("300 millis");
        expect(Option.isSome(yield* Fiber.join(waited))).toBe(true);
        yield* Fiber.join(writer);
        const before = reads;
        yield* TestClock.adjust("1 second");
        expect(reads).toBeGreaterThan(before);
        yield* Effect.forEach(streams, Fiber.interrupt);
      }),
  );

  it.effect(
    "lets a reader that borrows again inside its borrow finish after the hold-back, and runs after it",
    () =>
      Effect.gen(function* () {
        const gate = yield* makeReadGate("1 second");
        const outer = yield* Deferred.make<void>();
        const order: string[] = [];
        const nested = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* gate.enter;
            yield* Deferred.await(outer);
            yield* Effect.scoped(gate.enter);
            order.push("nested read");
          }),
        ).pipe(Effect.forkChild(started));
        const writer = yield* gate
          .exclusive(Effect.sync(() => order.push("apply")))
          .pipe(Effect.forkChild(started));
        yield* Deferred.succeed(outer, undefined);
        expect(order).toEqual([]);
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(nested);
        yield* Fiber.join(writer);
        expect(order).toEqual(["nested read", "apply"]);
      }),
  );

  it.effect("opens again when the waiting step is interrupted", () =>
    Effect.gen(function* () {
      const gate = yield* makeReadGate("1 second");
      const pinned = yield* hold(gate);
      const writer = yield* gate
        .exclusive(Effect.void)
        .pipe(Effect.forkChild(started));
      yield* Fiber.interrupt(writer);
      expect(gate.waiting()).toBe(false);
      yield* Effect.scoped(gate.enter);
      yield* Scope.close(pinned, Exit.void);
    }),
  );
});
