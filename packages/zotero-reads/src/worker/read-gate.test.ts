import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { makeReadGate } from "./read-gate.ts";

const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
});

const hold = (gate: Effect.Success<ReturnType<typeof makeReadGate>>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Scope.provide(gate.enter, scope);
    return scope;
  });

describe("the read gate", () => {
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
        .pipe(Effect.forkChild);
      yield* settle;
      expect(gate.waiting()).toBe(true);
      expect(yield* Deferred.isDone(ran)).toBe(false);
      yield* TestClock.adjust("10 seconds");
      yield* settle;
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
          .pipe(Effect.forkChild);
        yield* settle;
        const late = yield* Effect.scoped(
          Effect.andThen(
            gate.enter,
            Effect.sync(() => order.push("late read")),
          ),
        ).pipe(Effect.forkChild);
        yield* settle;
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
          .pipe(Effect.forkChild);
        yield* settle;
        const reader = yield* Effect.scoped(
          Effect.andThen(
            gate.enter,
            Effect.sync(() => order.push("read")),
          ),
        ).pipe(Effect.forkChild);
        yield* settle;
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
        let applied = false;
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
          .exclusive(
            Effect.sync(() => {
              applied = true;
            }),
          )
          .pipe(Effect.forkChild);
        yield* TestClock.adjust("300 millis");
        yield* settle;
        expect(applied).toBe(true);
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
        ).pipe(Effect.forkChild);
        yield* settle;
        const writer = yield* gate
          .exclusive(Effect.sync(() => order.push("apply")))
          .pipe(Effect.forkChild);
        yield* settle;
        yield* Deferred.succeed(outer, undefined);
        yield* settle;
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
      const writer = yield* gate.exclusive(Effect.void).pipe(Effect.forkChild);
      yield* settle;
      yield* Fiber.interrupt(writer);
      expect(gate.waiting()).toBe(false);
      yield* Effect.scoped(gate.enter);
      yield* Scope.close(pinned, Exit.void);
    }),
  );
});
