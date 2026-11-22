import { Effect, Scope } from "effect";

import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { makeExcerptPdfQueue } from "#core/excerpt-image/pdf-queue.ts";

export const queueFixture = Effect.fn("queueFixture")(function* (
  options: { limit?: number; render?: number; preflight?: number } = {},
) {
  const queue = yield* makeExcerptPdfQueue(options);
  const bridge = yield* scopedBridge;
  const scope = yield* Scope.Scope;
  return {
    get diagnostics() {
      return queue.diagnostics;
    },
    get busy() {
      return queue.busy;
    },
    nextSequence: queue.nextSequence,
    reserve: async (signal: AbortSignal) => {
      const admission = await bridge.runPromise(
        Effect.provideService(queue.reserve, Scope.Scope, scope),
        { signal },
      );
      return {
        render: <A>(
          task: () => Promise<A>,
          order: { pdf: string; sequence: number; signal: AbortSignal },
        ) =>
          bridge.runPromise(
            admission.render(
              Effect.uninterruptible(Effect.tryPromise(() => task())),
              order,
            ),
            { signal: order.signal },
          ),
        release: () => bridge.runSync(admission.release),
      };
    },
    preflight: <A>(task: () => Promise<A>, signal: AbortSignal) =>
      bridge.runPromise(
        queue.preflight(
          Effect.uninterruptible(Effect.tryPromise(() => task())),
        ),
        { signal },
      ),
    teardown: <A>(task: () => Promise<A>) =>
      bridge.runPromise(queue.teardown(Effect.tryPromise(() => task()))),
    idle: () => bridge.runPromise(queue.idle),
  };
});
export type QueueFixture = Effect.Success<ReturnType<typeof queueFixture>>;
