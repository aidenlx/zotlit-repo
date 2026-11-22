import { Cause, Effect, Exit } from "effect";
import type { Fiber } from "effect";

import type { ViewServices } from "#view-atoms.ts";
import { makeViewRunner } from "#view-runner.ts";

export function exitOf<A, E>(
  fiber: Fiber.Fiber<A, E>,
): Promise<Exit.Exit<A, E>> {
  return new Promise((resolve) => fiber.addObserver(resolve));
}

export const scopedViewRunner = (
  registry: Parameters<typeof makeViewRunner>[0],
) => Effect.acquireDisposable(Effect.sync(() => makeViewRunner(registry)));

export async function runOnView<A, E>(
  registry: Parameters<typeof makeViewRunner>[0],
  effect: Effect.Effect<A, E, ViewServices>,
): Promise<A> {
  await using runner = makeViewRunner(registry);
  const exit = await exitOf(runner.run(effect));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}
