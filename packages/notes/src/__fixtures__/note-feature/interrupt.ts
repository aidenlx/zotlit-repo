import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";

export const interruptedWithin = Effect.fnUntraced(function* <A, E>(
  fiber: Fiber.Fiber<A, E>,
) {
  const ended = yield* Fiber.interrupt(fiber).pipe(
    Effect.andThen(Fiber.await(fiber)),
    Effect.timeoutOption("1 second"),
    Effect.forkChild({ startImmediately: true }),
  );
  yield* TestClock.adjust("1 second");
  const exit = yield* Fiber.join(ended);
  return (
    Option.isSome(exit) &&
    Exit.isFailure(exit.value) &&
    Cause.hasInterruptsOnly(exit.value.cause)
  );
});
