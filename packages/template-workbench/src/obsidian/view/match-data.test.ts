import type { WorkbenchHostDeps } from "#__fixtures__/view.ts";
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { vi } from "vitest";

import { scopedViewRunner } from "@zotlit/obsidian-kit/__fixtures__/view-runner.ts";
import { waitFor } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { createMatchData } from "./match-data.ts";

import { makeWorkbenchHost } from "#__fixtures__/view.ts";

it.effect(
  "stops reading custom fields when the Match editor interrupts the read",
  () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<AbortSignal>();
      const customFieldNames = vi.fn((signal: AbortSignal) => {
        started.resolve(signal);
        return new Promise<never>(() => {});
      });
      const host = makeWorkbenchHost({
        query: stubService<NonNullable<WorkbenchHostDeps["query"]>>("Query", {
          customFieldNames,
        }),
      });
      const runner = yield* scopedViewRunner(host.registry);
      const data = createMatchData(runner.provide);
      const fiber = yield* Effect.forkChild(data.customFields);
      const running = yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(fiber);
      expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
      yield* Effect.promise(() =>
        waitFor(() => expect(running.aborted).toBe(true)),
      );
      expect(customFieldNames).toHaveBeenCalledOnce();
    }),
);

it.effect("stops every concurrent read when its view closes", () =>
  Effect.gen(function* () {
    const signals: AbortSignal[] = [];
    const host = makeWorkbenchHost({
      query: stubService<NonNullable<WorkbenchHostDeps["query"]>>("Query", {
        customFieldNames: (signal) => {
          signals.push(signal);
          return new Promise<never>(() => {});
        },
      }),
    });
    const runner = yield* scopedViewRunner(host.registry);
    const data = createMatchData(runner.provide);
    const fibers = [
      runner.run(data.customFields),
      runner.run(data.customFields),
    ];
    yield* Effect.promise(() => waitFor(() => expect(signals).toHaveLength(2)));
    yield* Effect.promise(() => runner[Symbol.asyncDispose]());
    for (const fiber of fibers)
      expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  }),
);
