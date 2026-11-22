import type { Stream } from "effect";
import { Cause, Effect, Fiber, FiberSet, Scope } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { openScope } from "@zotlit/plugin-kernel/effect-scope.ts";
import { subscribe } from "@zotlit/plugin-kernel/effect-stream.ts";
import { joinForked, observeExit } from "@zotlit/plugin-kernel/fiber-exit.ts";

import { viewRuntime } from "./view-atoms.ts";
import type { ViewServices } from "./view-atoms.ts";

export type ViewRun = <A, E>(
  effect: Effect.Effect<A, E, ViewServices>,
) => Fiber.Fiber<A, E>;

export interface ViewRunner extends Disposable, AsyncDisposable {
  readonly subscribe: <A>(
    stream: Stream.Stream<A, never, ViewServices>,
    callback: (value: A) => void,
  ) => () => void;
  readonly run: ViewRun;
  readonly runSync: <A>(effect: Effect.Effect<A, never, ViewServices>) => A;
  readonly provide: <A, E>(
    effect: Effect.Effect<A, E, ViewServices>,
  ) => Effect.Effect<A, E>;
  readonly settled: () => Promise<void>;
}

export function makeViewRunner(
  registry: AtomRegistry.AtomRegistry,
): ViewRunner {
  const unmount = registry.mount(viewRuntime);
  const context = AsyncResult.getOrThrow(registry.get(viewRuntime));
  const { scope, close } = openScope();
  const fibers = Effect.runSyncWith(context)(
    FiberSet.make().pipe(Scope.provide(scope)),
  );
  const run = Effect.runSyncWith(context)(
    FiberSet.runtime(fibers)<ViewServices>(),
  );
  let closing: Promise<void> | null = null;
  const dispose = () => (closing ??= close().finally(unmount));
  return {
    run,
    runSync: Effect.runSyncWith(context),
    subscribe: (stream, callback) =>
      subscribe({ runFork: run, scope }, stream, callback),
    provide: Effect.provideContext(context),
    settled: () => Effect.runPromiseWith(context)(FiberSet.awaitEmpty(fibers)),
    [Symbol.dispose]: () => void dispose(),
    [Symbol.asyncDispose]: dispose,
  };
}

export function joinOnView<A, E>(
  run: ViewRun,
  effect: Effect.Effect<A, E, ViewServices>,
): Effect.Effect<A, E> {
  return joinForked(Effect.sync(() => run(effect)));
}

export interface InFlightSlot<A, E> {
  readonly join: Effect.Effect<A, E>;
  readonly start: () => void;
  readonly running: () => boolean;
}

export function inFlightSlot<A, E>(
  run: ViewRun,
  effect: Effect.Effect<A, E, ViewServices>,
  onChange: () => void = () => {},
): InFlightSlot<A, E> {
  let current: Fiber.Fiber<A, E> | null = null;
  const begin = (): Fiber.Fiber<A, E> => {
    if (current) return current;
    const fiber = run(effect);
    current = fiber;
    onChange();
    fiber.addObserver(() => {
      current = null;
      onChange();
    });
    return fiber;
  };
  return {
    join: Effect.suspend(() => Fiber.join(begin())),
    start: () => void begin(),
    running: () => current !== null,
  };
}

export interface LatestSlot<R> {
  readonly run: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>;
  readonly join: <A, E>(
    effect: Effect.Effect<A, E, R>,
    released: A,
  ) => Effect.Effect<A, E>;
  readonly interrupt: () => void;
}

export function latestSlot<R>(
  run: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>,
): LatestSlot<R> {
  let current: Fiber.Fiber<unknown, unknown> | null = null;
  const interrupt = () => current?.interruptUnsafe();
  const start = <A, E>(effect: Effect.Effect<A, E, R>) => {
    interrupt();
    const fiber = run(effect);
    current = fiber;
    return fiber;
  };
  return {
    run: start,
    join: (effect, released) =>
      joinForked(Effect.sync(() => start(effect))).pipe(
        Effect.catchCauseIf(Cause.hasInterruptsOnly, () =>
          Effect.succeed(released),
        ),
      ),
    interrupt,
  };
}

export function answerOf<A, E>(
  fiber: Fiber.Fiber<A, E>,
  released: A,
): Promise<A> {
  return new Promise((resolve, reject) =>
    observeExit(fiber, {
      onSuccess: resolve,
      onInterrupt: () => resolve(released),
      onFailure: reject,
    }),
  );
}
