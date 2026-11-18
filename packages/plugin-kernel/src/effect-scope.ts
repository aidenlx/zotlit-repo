// Where Effect Scopes meet code that lives outside Effect: a service's load,
// a lease, a `Disposable`.
import { Cause, Effect, Exit, Scope } from "effect";

import { withLogCategory } from "./effect-log.ts";

/** Log a failed release, so the rest of the scope still closes. */
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

/**
 * Whether `scope` has closed: a released runtime or layer, which takes no new
 * work. A caller checks it before it runs anything on that runtime.
 */
export function isScopeClosed(scope: Scope.Scope): boolean {
  return scope.state._tag === "Closed";
}

/**
 * A scope opened now, with the promise that closes it. Closing never fails: a
 * finalizer that fails is logged.
 */
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
