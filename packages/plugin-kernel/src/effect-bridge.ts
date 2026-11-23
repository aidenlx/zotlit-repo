import { Cause, Context, Effect, Exit, Fiber, Scope } from "effect";
import type { ManagedRuntime, Stream } from "effect";

import { AbortError } from "./abort-error.ts";
import { logAndContinue } from "./effect-log.ts";
import { isScopeClosed } from "./effect-scope.ts";
import { subscribe } from "./effect-stream.ts";

export interface EffectBridge {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E>) => A;
  readonly runPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<A>;
  readonly runPromiseExit: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Exit.Exit<A, E>>;
  readonly runAndForget: <A, E>(effect: Effect.Effect<A, E>) => void;
  readonly subscribe: <A>(
    stream: Stream.Stream<A>,
    callback: (value: A) => void,
  ) => () => void;
  readonly closed: () => boolean;
}

export function valueOr<A, E>(exit: Exit.Exit<A, E>, released: A): A {
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) return released;
  throw Cause.squash(exit.cause);
}

export function exitOver<R>(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  context: Context.Context<R>,
) {
  return <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Exit.Exit<A, E>> =>
    bridge.runPromiseExit(Effect.provideContext(effect, context), options);
}

function bridgeOver(
  context: Context.Context<never>,
  scope: Scope.Scope,
  host: Pick<ManagedRuntime.ManagedRuntime<never, never>, "runFork"> & {
    readonly scope: Scope.Scope;
  },
): EffectBridge {
  const runExit = Effect.runPromiseExitWith(context);
  const onFiberStart = Fiber.runIn(scope);
  const runPromiseExit: EffectBridge["runPromiseExit"] = (effect, options) =>
    runExit(effect, { ...options, onFiberStart });
  return {
    runSync: Effect.runSyncWith(context),
    runPromise: async (effect, options) => {
      const exit = await runPromiseExit(effect, options);
      if (Exit.isSuccess(exit)) return exit.value;
      if (Cause.hasInterruptsOnly(exit.cause))
        throw new AbortError("The plugin unloaded during the run.");
      throw Cause.squash(exit.cause);
    },
    runPromiseExit,
    runAndForget: (effect) => {
      void runPromiseExit(
        effect.pipe(
          logAndContinue("A fire-and-forget Effect failed", "bridge"),
        ),
      );
    },
    subscribe: (stream, callback) => subscribe(host, stream, callback),
    closed: () => isScopeClosed(scope),
  };
}

export function effectBridge<R>(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<R, never>,
    "runSync" | "runFork" | "scope"
  >,
): EffectBridge {
  return bridgeOver(
    runtime.runSync(Effect.context<R>()),
    runtime.scope,
    runtime,
  );
}

export const scopedBridge: Effect.Effect<EffectBridge, never, Scope.Scope> =
  Effect.gen(function* () {
    const context = yield* Effect.context<Scope.Scope>();
    const scope = Context.get(context, Scope.Scope);
    return bridgeOver(context, scope, {
      runFork: Effect.runForkWith(context),
      scope,
    });
  });
