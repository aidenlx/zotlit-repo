import { Cause, Context, Effect, Exit, Fiber, Scope } from "effect";
import type { ManagedRuntime, Stream } from "effect";

import { AbortError } from "./abort-error.ts";
import { withLogCategory } from "./effect-log.ts";
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

const logForgottenFailure = (cause: Cause.Cause<unknown>) =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.void
    : Effect.logError("A fire-and-forget Effect failed", cause).pipe(
        withLogCategory("bridge"),
      );

const underTestRunner = (): boolean =>
  (
    import.meta as {
      readonly env?: Readonly<Record<string, string | boolean | undefined>>;
    }
  ).env?.["MODE"] === "test";

export interface BridgeOptions {
  readonly rejectsForgottenFailures?: boolean;
}

function bridgeOver(
  context: Context.Context<never>,
  host: Pick<ManagedRuntime.ManagedRuntime<never, never>, "runFork"> & {
    readonly scope: Scope.Scope;
  },
  { rejectsForgottenFailures = underTestRunner() }: BridgeOptions = {},
): EffectBridge {
  const { scope } = host;
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
      const run = runPromiseExit(
        effect.pipe(Effect.tapCause((cause) => logForgottenFailure(cause))),
      );
      void (rejectsForgottenFailures
        ? run.then((exit) => valueOr(exit, undefined))
        : run);
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
  options?: BridgeOptions,
): EffectBridge {
  return bridgeOver(runtime.runSync(Effect.context<R>()), runtime, options);
}

export const scopedBridge: Effect.Effect<EffectBridge, never, Scope.Scope> =
  Effect.gen(function* () {
    const context = yield* Effect.context<Scope.Scope>();
    const scope = Context.get(context, Scope.Scope);
    return bridgeOver(context, {
      runFork: Effect.runForkWith(context),
      scope,
    });
  });
