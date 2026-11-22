import { it as effectIt } from "@effect/vitest";
import { Context, Effect, Logger, Tracer } from "effect";
import { Scheduler } from "effect/Scheduler";
import { expect, it } from "vitest";

import { browserScheduler } from "./browser-scheduler.ts";
import { pluginLogger } from "./effect-log.ts";

it("runs Effect.runSync from effect with the runtime services", () => {
  const services = Effect.runSync(Effect.context<never>());
  expect(Context.get(services, Scheduler)).toBe(browserScheduler);
  expect(Context.get(services, Logger.CurrentLoggers)).toContain(pluginLogger);
  expect(Context.get(services, Tracer.DisablePropagation)).toBe(true);
});

effectIt.effect(
  "runs it.effect from @effect/vitest with the browser scheduler",
  () =>
    Effect.gen(function* () {
      expect(yield* Scheduler).toBe(browserScheduler);
    }),
);
