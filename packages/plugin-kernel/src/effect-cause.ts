import { Cause, Effect } from "effect";

export function recover<B>(
  logged: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
  fallback: Effect.Effect<B>,
) {
  return <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | B, never, R> =>
    Effect.catchCause(effect, (cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.andThen(logged(cause), fallback),
    );
}
