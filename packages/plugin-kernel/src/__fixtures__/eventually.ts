import { Effect, Exit } from "effect";
import { expect } from "vitest";

import { yieldToMain } from "#yield-to-main.ts";

export const eventually = (assert: () => void) =>
  Effect.yieldNow.pipe(
    Effect.andThen(Effect.exit(Effect.sync(assert))),
    Effect.repeat({ until: Exit.isSuccess, times: 1000 }),
    Effect.flatten,
  );

export const until = (done: () => boolean) =>
  eventually(() => expect(done()).toBe(true));

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
