import { it } from "@effect/vitest";
import {
  Cause,
  Effect,
  Exit,
  PubSub,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect";
import { describe, expect } from "vitest";

import { openTestBridge } from "./__fixtures__/effect-bridge.ts";
import { captureLogRecords } from "./__fixtures__/log-capture.ts";
import { AbortError } from "./abort-error.ts";
import { scopedBridge, valueOr } from "./effect-bridge.ts";

class BridgeError extends Schema.TaggedError<
  BridgeError,
  { readonly brand: unique symbol }
>()("BridgeError", { message: Schema.String }) {}

it.effect("runSync returns the value of a synchronous Effect", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    expect(bridge.runSync(Effect.succeed(42))).toBe(42);
  }),
);

it.effect("runPromise rejects with the Effect failure", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const error = new BridgeError({ message: "failed" });
    await expect(bridge.runPromise(Effect.fail(error))).rejects.toBe(error);
  }),
);

it.effect("runPromiseExit resolves with a failure Exit", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const error = new BridgeError({ message: "failed" });
    const exit = await bridge.runPromiseExit(Effect.fail(error));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(error);
  }),
);

it.effect("runAndForget logs a failed Effect once with its cause", () =>
  Effect.promise(async () => {
    using logs = captureLogRecords();
    const bridge = openTestBridge();
    const error = new BridgeError({ message: "callback failed" });

    bridge.runAndForget(Effect.fail(error));
    await bridge[Symbol.asyncDispose]();

    expect(logs.records).toHaveLength(1);
    const record = logs.records[0];
    expect(record?.level).toBe("error");
    expect(record?.properties["error"]).toBe(error);
  }),
);

it.effect("runAndForget interrupts a pending Effect silently on unload", () =>
  Effect.promise(async () => {
    using logs = captureLogRecords();
    const bridge = openTestBridge();
    const started = Promise.withResolvers<void>();
    let interrupted = false;
    bridge.runAndForget(
      Effect.sync(() => started.resolve()).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      ),
    );

    await started.promise;
    await bridge[Symbol.asyncDispose]();

    expect(interrupted).toBe(true);
    expect(logs.records).toEqual([]);
  }),
);

it.effect("the captured context survives runtime disposal", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const value = bridge.runSync(Ref.make(1));
    await bridge[Symbol.asyncDispose]();
    expect(bridge.closed()).toBe(true);
    expect(bridge.runSync(Ref.get(value))).toBe(1);

    const received: number[] = [];
    const unsubscribe = bridge.subscribe(Stream.make(1, 2, 3), (next) =>
      received.push(next),
    );
    unsubscribe();
    expect(received).toEqual([]);
  }),
);

it.effect("subscribe receives each stream element in order", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const received: number[] = [];
    const unsubscribe = bridge.subscribe(Stream.make(1, 2, 3), (next) =>
      received.push(next),
    );
    expect(received).toEqual([1, 2, 3]);
    unsubscribe();
  }),
);

it.effect("a subscription stops receiving after it is unsubscribed", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const bus = bridge.runSync(PubSub.unbounded<number>());
    const received: number[] = [];
    const first = Promise.withResolvers<void>();
    const unsubscribe = bridge.subscribe(Stream.fromPubSub(bus), (next) => {
      received.push(next);
      first.resolve();
    });
    const witnessed: number[] = [];
    const second = Promise.withResolvers<void>();
    const stopWitness = bridge.subscribe(Stream.fromPubSub(bus), (next) => {
      witnessed.push(next);
      if (next === 2) second.resolve();
    });

    PubSub.publishUnsafe(bus, 1);
    await first.promise;
    unsubscribe();
    PubSub.publishUnsafe(bus, 2);
    await second.promise;
    stopWitness();

    expect(witnessed).toEqual([1, 2]);
    expect(received).toEqual([1]);
  }),
);

it.effect("unloading the runtime interrupts a pending runPromiseExit", () =>
  Effect.promise(async () => {
    const bridge = openTestBridge();
    const pending = bridge.runPromiseExit(Effect.never);
    await bridge[Symbol.asyncDispose]();
    const exit = await pending;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  }),
);

it.effect(
  "unloading the runtime rejects a pending runPromise with an AbortError",
  () =>
    Effect.promise(async () => {
      const bridge = openTestBridge();
      const pending = bridge.runPromise(Effect.never);
      await bridge[Symbol.asyncDispose]();
      const error: unknown = await pending.then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(AbortError.test(error)).toBe(true);
    }),
);

describe("valueOr", () => {
  it.effect("returns the value of a success", () =>
    Effect.sync(() => {
      expect(valueOr(Exit.succeed(7), -1)).toBe(7);
    }),
  );

  it.effect(
    "returns the released value where only interrupts ended the run",
    () =>
      Effect.sync(() => {
        expect(valueOr(Exit.interrupt(), -1)).toBe(-1);
      }),
  );

  it.effect("throws the failure of a run that failed", () =>
    Effect.sync(() => {
      const error = new BridgeError({ message: "failed" });
      expect(() => valueOr(Exit.fail(error), -1)).toThrow(error);
    }),
  );
});

it.effect("a scoped bridge closes with its Scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const bridge = yield* scopedBridge.pipe(Scope.provide(scope));
    const received: number[] = [];
    bridge.subscribe(Stream.make(1, 2), (next) => received.push(next));
    expect(received).toEqual([1, 2]);
    expect(bridge.closed()).toBe(false);
    yield* Scope.close(scope, Exit.void);
    expect(bridge.closed()).toBe(true);
    bridge.subscribe(Stream.make(3), (next) => received.push(next));
    expect(received).toEqual([1, 2]);
  }),
);
