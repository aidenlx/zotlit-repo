// Bounded polls for a test that waits on a forked fiber, with no time passing.
import { Effect, Exit } from "effect";
import { expect } from "vitest";

import { yieldToMain } from "#yield-to-main.ts";

/**
 * Yield until `assert` passes, for a forked fiber (a toast) to take in what
 * just happened. After a bounded number of turns, the case dies with the last
 * assertion failure.
 */
export const eventually = (assert: () => void) =>
  Effect.yieldNow.pipe(
    Effect.andThen(Effect.exit(Effect.sync(assert))),
    Effect.repeat({ until: Exit.isSuccess, times: 1000 }),
    Effect.flatten,
  );

/** {@link eventually} for a condition: yield until `done` holds. */
export const until = (done: () => boolean) =>
  eventually(() => expect(done()).toBe(true));

/** Retries `assertion` across host turns until it holds. */
export async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 999) throw error;
      await yieldToMain();
    }
  }
}
