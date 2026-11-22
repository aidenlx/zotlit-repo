import { Cause, Effect, Exit, Fiber } from "effect";

export interface ExitHandlers<A, E> {
  readonly onSuccess?: (value: A) => void;
  readonly onFailure?: (error: unknown, cause: Cause.Cause<E>) => void;
  readonly onInterrupt?: () => void;
}

export function observeExit<A, E>(
  fiber: Fiber.Fiber<A, E>,
  handlers: ExitHandlers<A, E>,
): () => void {
  return fiber.addObserver((exit) => {
    if (Exit.isSuccess(exit)) handlers.onSuccess?.(exit.value);
    else if (Cause.hasInterruptsOnly(exit.cause)) handlers.onInterrupt?.();
    else handlers.onFailure?.(Cause.squash(exit.cause), exit.cause);
  });
}

export function joinForked<A, E, E2, R>(
  fork: Effect.Effect<Fiber.Fiber<A, E>, E2, R>,
): Effect.Effect<A, E | E2, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.flatMap(fork, (fiber) =>
      restore(Fiber.join(fiber)).pipe(
        Effect.onInterrupt(() => Fiber.interrupt(fiber)),
      ),
    ),
  );
}
