import { makeRunSurface } from "./effect-runtime-factory.ts";
import { runtimeServices } from "./effect-services.ts";

export * from "effect/Effect";

export const {
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
} = makeRunSurface(runtimeServices);
