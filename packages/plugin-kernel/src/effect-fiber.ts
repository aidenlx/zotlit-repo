import type { Exit } from "effect";
import { Effect, Fiber } from "effect";

export function awaitOwned<A, E>(
  fiber: Fiber.Fiber<A, E>,
  restore: (
    self: Effect.Effect<Exit.Exit<A, E>>,
  ) => Effect.Effect<Exit.Exit<A, E>> = (self) => self,
): Effect.Effect<Exit.Exit<A, E>> {
  return restore(Fiber.await(fiber)).pipe(
    Effect.onInterrupt(() => Fiber.interrupt(fiber)),
  );
}
