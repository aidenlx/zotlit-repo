// Where an Effect Scope meets an Obsidian Component: the Scope closes when
// the Component unloads.
import { Effect, Exit, Scope } from "effect";
import type { Component } from "obsidian";

import { logAndContinue } from "@zotlit/plugin-kernel/effect-log.ts";

/**
 * Finalizers run once: on unload, or earlier when the caller closes the Scope
 * itself. They run with the caller's services, and a failed one is logged
 * while the rest still run.
 *
 * @param component The edge (a view, a render child, a modal) whose unload
 *   closes the Scope.
 * @returns A Scope for the Effect work the edge holds while it stands.
 */
export function componentScope(
  component: Pick<Component, "register">,
): Effect.Effect<Scope.Closeable> {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const run = Effect.runPromiseWith(yield* Effect.context<never>());
    component.register(
      () =>
        void run(
          Scope.close(scope, Exit.void).pipe(
            logAndContinue("Could not close a scope", "scope"),
          ),
        ),
    );
    return scope;
  });
}
