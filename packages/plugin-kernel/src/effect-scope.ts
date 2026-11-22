import { Cause, Effect, Exit, Scope } from "effect";

import { withLogCategory } from "./effect-log.ts";

const logFailure =
  (message: string) =>
  <E, R>(release: Effect.Effect<void, E, R>): Effect.Effect<void, never, R> =>
    release.pipe(
      Effect.catchCause((cause) =>
        Effect.logError(message).pipe(
          Effect.annotateLogs({ error: Cause.squash(cause) }),
          withLogCategory("scope"),
        ),
      ),
    );

export function isScopeClosed(scope: Scope.Scope): boolean {
  return scope.state._tag === "Closed";
}

export function openScope(): {
  scope: Scope.Closeable;
  close: () => Promise<void>;
} {
  const scope = Scope.makeUnsafe();
  return {
    scope,
    close: () =>
      Effect.runPromise(
        Scope.close(scope, Exit.void).pipe(
          logFailure("Could not close a scope"),
        ),
      ),
  };
}
