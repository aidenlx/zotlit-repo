import type { Effect, Fiber } from "effect";
import { Data } from "effect";

export type WorkbenchRunner = <A, E>(
  effect: Effect.Effect<A, E>,
) => Fiber.Fiber<A, E>;

export class WorkbenchHostError extends Data.TaggedError("WorkbenchHostError")<{
  readonly cause: unknown;
}> {}
