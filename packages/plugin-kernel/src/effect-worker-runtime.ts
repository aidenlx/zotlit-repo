import * as Context from "effect/Context";
import * as References from "effect/References";
import { Scheduler } from "effect/Scheduler";

import { browserScheduler } from "./browser-scheduler.ts";
import { makeRunSurface } from "./effect-runtime-factory.ts";

const runtimeServices = Context.add(
  Context.empty(),
  Scheduler,
  browserScheduler,
).pipe(Context.add(References.MinimumLogLevel, "All"));

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
