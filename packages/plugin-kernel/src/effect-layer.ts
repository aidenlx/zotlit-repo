import * as Cause from "effect/Cause";
import * as NativeEffect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { withLogCategory } from "./effect-log.ts";
import { runtimeServices } from "./effect-services.ts";

export function buildRuntime<R>(
  layer: Layer.Layer<R>,
  stack: AsyncDisposableStack,
): ManagedRuntime.ManagedRuntime<R, never> {
  const runtime = ManagedRuntime.make(
    Layer.provideMerge(layer, Layer.succeedContext(runtimeServices)),
  );
  stack.defer(() =>
    NativeEffect.runPromiseWith(runtimeServices)(
      runtime.disposeEffect.pipe(
        NativeEffect.catchCause((cause) =>
          NativeEffect.logError("Could not close the services").pipe(
            NativeEffect.annotateLogs({ error: Cause.squash(cause) }),
          ),
        ),
        withLogCategory("services"),
      ),
    ),
  );
  return runtime;
}
