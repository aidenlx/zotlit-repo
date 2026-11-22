import { Effect, Fiber } from "effect";

export const startupBarrier = Effect.fn("startupBarrier")(function* <R, R2>(
  load: Effect.Effect<void, never, R>,
  onTimeout: Effect.Effect<void, never, R2>,
) {
  const pending = yield* Effect.forkScoped(load, { startImmediately: true });
  yield* Fiber.join(pending).pipe(
    Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => onTimeout }),
  );
});
