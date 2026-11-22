import { Effect, Exit, Scope } from "effect";
import type { Component } from "obsidian";

import { logAndContinue } from "@zotlit/plugin-kernel/effect-log.ts";

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
