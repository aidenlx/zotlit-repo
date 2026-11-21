// How a caller reads or joins a Fiber a runner forked: plain code reads how it
// ended, and Effect code joins it with the caller's interrupt passed on.
import { Cause, Effect, Exit, Fiber } from "effect";

/** How a Fiber ended, for a caller outside Effect. */
export interface ExitHandlers<A, E> {
  readonly onSuccess?: (value: A) => void;
  readonly onFailure?: (error: unknown, cause: Cause.Cause<E>) => void;
  /** An end by interrupts only: the owner closed, or a newer run replaced it. */
  readonly onInterrupt?: () => void;
}

/**
 * Calls the handler of how `fiber` ends; at once when it has ended already.
 * @returns Stops the report.
 */
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

/**
 * Runs `fork` and joins the Fiber it answers. The caller's interrupt
 * interrupts that Fiber too, also one that lands as the Fiber starts: the fork
 * and the finalizer run before an interrupt can land. The forked Fiber stays
 * interruptible; a fork is interruptible unless its options ask otherwise.
 */
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
