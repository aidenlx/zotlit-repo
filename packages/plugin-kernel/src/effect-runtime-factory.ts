import * as Context from "effect/Context";
import * as NativeEffect from "effect/Effect";

export const makeRunSurface = (services: Context.Context<never>) => {
  const withRuntime = <R>(context: Context.Context<R>) =>
    Context.merge(services, context);

  const runFork: typeof NativeEffect.runFork =
    NativeEffect.runForkWith(services);
  const runForkWith: typeof NativeEffect.runForkWith = (context) =>
    NativeEffect.runForkWith(withRuntime(context));

  const runCallback: typeof NativeEffect.runCallback =
    NativeEffect.runCallbackWith(services);
  const runCallbackWith: typeof NativeEffect.runCallbackWith = (context) =>
    NativeEffect.runCallbackWith(withRuntime(context));

  const runPromise: typeof NativeEffect.runPromise =
    NativeEffect.runPromiseWith(services);
  const runPromiseWith: typeof NativeEffect.runPromiseWith = (context) =>
    NativeEffect.runPromiseWith(withRuntime(context));

  const runPromiseExit: typeof NativeEffect.runPromiseExit =
    NativeEffect.runPromiseExitWith(services);
  const runPromiseExitWith: typeof NativeEffect.runPromiseExitWith = (
    context,
  ) => NativeEffect.runPromiseExitWith(withRuntime(context));

  const provideRuntime = <A, E, R>(
    effect: NativeEffect.Effect<A, E, R>,
    context?: Context.Context<R>,
  ) =>
    NativeEffect.provideContext(
      effect,
      withRuntime(context ?? (Context.empty() as Context.Context<R>)),
    );

  const runSync: typeof NativeEffect.runSync = (effect) =>
    NativeEffect.runSync(provideRuntime(effect));
  const runSyncWith: typeof NativeEffect.runSyncWith = (context) => (effect) =>
    NativeEffect.runSync(provideRuntime(effect, context));

  const runSyncExit: typeof NativeEffect.runSyncExit = (effect) =>
    NativeEffect.runSyncExit(provideRuntime(effect));
  const runSyncExitWith: typeof NativeEffect.runSyncExitWith =
    (context) => (effect) =>
      NativeEffect.runSyncExit(provideRuntime(effect, context));

  return {
    runFork,
    runForkWith,
    runCallback,
    runCallbackWith,
    runPromise,
    runPromiseWith,
    runPromiseExit,
    runPromiseExitWith,
    runSync,
    runSyncWith,
    runSyncExit,
    runSyncExitWith,
  };
};
