import * as Context from "effect/Context";
import { Scheduler } from "effect/Scheduler";
import * as Tracer from "effect/Tracer";

import { browserScheduler } from "./browser-scheduler.ts";
import { logServices } from "./effect-log.ts";

export const runtimeServices = logServices.pipe(
  Context.add(Scheduler, browserScheduler),
  Context.add(Tracer.DisablePropagation, true),
);
