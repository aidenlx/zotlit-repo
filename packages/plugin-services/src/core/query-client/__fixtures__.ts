import { Clock, Context, Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";

import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import { QueryClients } from "./service.ts";
import { layerQueryClients } from "./service.ts";
import type { TestClock as QueryTestClock } from "./test-clock.ts";

export function buildQueryClients(
  stack: AsyncDisposableStack,
  now?: QueryTestClock["now"],
): QueryClients["Service"] & {
  runtime: import("@zotlit/plugin-kernel/effect-stream.ts").SubscriptionRuntime;
  bridge: EffectBridge;
} {
  const clock = Context.get(Context.empty(), Clock.Clock);
  const layer =
    now === undefined
      ? layerQueryClients
      : layerQueryClients.pipe(
          Layer.provide(
            Layer.succeed(Clock.Clock, {
              currentTimeNanosUnsafe: () => now().epochNanoseconds,
              currentTimeNanos: Effect.sync(() => now().epochNanoseconds),
              monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
              monotonicTimeNanos: clock.monotonicTimeNanos,
              sleep: (duration) => clock.sleep(duration),
              currentTimeMillisUnsafe: () => now().epochMilliseconds,
              currentTimeMillis: Effect.sync(() => now().epochMilliseconds),
            }),
          ),
        );
  const runtime = buildRuntime(layer, stack);
  return Object.assign(runtime.runSync(QueryClients), {
    runtime,
    bridge: effectBridge(runtime),
  });
}

export function queryClientsFixture(
  now?: QueryTestClock["now"],
): QueryClients["Service"] &
  AsyncDisposable & {
    runtime: import("@zotlit/plugin-kernel/effect-stream.ts").SubscriptionRuntime;
    bridge: EffectBridge;
  } {
  const stack = new AsyncDisposableStack();
  return Object.assign(buildQueryClients(stack, now), {
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  });
}

export const queryClientsOf = Effect.fn("queryClientsOf")(function* () {
  const context = yield* Effect.context<never>();
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const services = yield* Layer.buildWithScope(layerQueryClients, scope);
  const { runtime } = yield* Effect.acquireDisposable(
    Effect.tryPromise(() => openTestRuntime(Context.merge(context, services))),
  );
  return Object.assign(runtime.runSync(QueryClients), {
    runtime,
    bridge: effectBridge(runtime),
    passCooldown: () =>
      runtime.runPromise(
        TestClock.adjust(5001).pipe(Effect.provideContext(context)),
      ),
    [Symbol.asyncDispose]: () =>
      runtime.runPromise(Scope.close(scope, Exit.void)),
  });
});

async function openTestRuntime(context: Context.Context<QueryClients>) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(Layer.succeedContext(context), stack);
  const owned = stack.move();
  return { runtime, [Symbol.asyncDispose]: () => owned.disposeAsync() };
}
