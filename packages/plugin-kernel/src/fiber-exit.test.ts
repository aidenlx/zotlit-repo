import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Scope } from "effect";
import type { Fiber as FiberType } from "effect";

import { joinForked, observeExit } from "./fiber-exit.ts";

describe("joinForked", () => {
  it.effect(
    "interrupts the forked Fiber when the caller is interrupted as it starts",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        let caller: FiberType.Fiber<unknown, unknown> | undefined;
        let stopped = false;
        const child = Effect.sync(() => caller?.interruptUnsafe()).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              stopped = true;
            }),
          ),
        );
        const fiber = yield* Effect.forkDetach(
          Effect.withFiber((self) => {
            caller = self;
            return joinForked(
              Effect.forkIn(child, scope, { startImmediately: true }),
            );
          }),
        );
        const exit = yield* Fiber.await(fiber);
        expect(Exit.hasInterrupts(exit)).toBe(true);
        expect(stopped).toBe(true);
        yield* Scope.close(scope, Exit.void);
      }),
  );
});

describe("observeExit", () => {
  it.effect("reports a success, a failure, and an end by interrupts only", () =>
    Effect.gen(function* () {
      const seen: string[] = [];
      const report = (fiber: FiberType.Fiber<string, string>) =>
        observeExit(fiber, {
          onSuccess: (value) => seen.push(`success ${value}`),
          onFailure: (error) => seen.push(`failure ${String(error)}`),
          onInterrupt: () => seen.push("interrupt"),
        });
      for (const effect of [
        Effect.succeed("a"),
        Effect.fail("b"),
        Effect.interrupt,
      ]) {
        const fiber = yield* Effect.forkDetach(effect);
        yield* Fiber.await(fiber);
        report(fiber);
      }
      expect(seen).toEqual(["success a", "failure b", "interrupt"]);
    }),
  );
});
