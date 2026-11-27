import { expect, it } from "@effect/vitest";
import { Effect, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";

import { runSyncSchedule } from "./schedule.ts";

const setup = Effect.fn("setup")(function* (focused: boolean) {
  const focus = yield* SubscriptionRef.make(focused);
  let syncs = 0;
  yield* runSyncSchedule(
    Effect.sync(() => {
      syncs++;
    }),
    SubscriptionRef.changes(focus),
  ).pipe(Effect.forkScoped({ startImmediately: true }));
  yield* TestClock.adjust("0 millis");
  return { focus, syncs: () => syncs };
});

it.effect("syncs at start and each 5 minutes while the window has focus", () =>
  Effect.gen(function* () {
    const { syncs } = yield* setup(true);
    expect(syncs()).toBe(1);
    yield* TestClock.adjust("4 minutes");
    expect(syncs()).toBe(1);
    yield* TestClock.adjust("1 minute");
    expect(syncs()).toBe(2);
    yield* TestClock.adjust("5 minutes");
    expect(syncs()).toBe(3);
  }).pipe(Effect.scoped),
);

it.effect(
  "syncs at start also without focus, then waits for the focus to sync again",
  () =>
    Effect.gen(function* () {
      const { focus, syncs } = yield* setup(false);
      expect(syncs()).toBe(1);
      yield* TestClock.adjust("30 minutes");
      expect(syncs()).toBe(1);
      yield* SubscriptionRef.set(focus, true);
      yield* TestClock.adjust("0 millis");
      expect(syncs()).toBe(2);
      yield* TestClock.adjust("5 minutes");
      expect(syncs()).toBe(3);
    }).pipe(Effect.scoped),
);

it.effect("does not sync on a focus that comes before the 5 minutes end", () =>
  Effect.gen(function* () {
    const { focus, syncs } = yield* setup(true);
    yield* SubscriptionRef.set(focus, false);
    yield* TestClock.adjust("2 minutes");
    yield* SubscriptionRef.set(focus, true);
    yield* TestClock.adjust("0 millis");
    expect(syncs()).toBe(1);
    yield* TestClock.adjust("3 minutes");
    expect(syncs()).toBe(2);
  }).pipe(Effect.scoped),
);
