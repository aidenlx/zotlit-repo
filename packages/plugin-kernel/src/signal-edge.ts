import { Cause, Exit } from "effect";

export function settleAtEdge<A, E>(
  exit: Exit.Exit<A, E>,
  signal: AbortSignal | undefined,
  released?: () => A,
): A {
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) {
    if (signal?.aborted) throw signal.reason;
    if (released !== undefined) return released();
  }
  throw Cause.squash(exit.cause);
}
