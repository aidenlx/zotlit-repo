import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Exit, Layer, Scope } from "effect";

import { layerExcerptImage } from "#desktop/excerpt-image/layer.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";
import type { ExcerptDeps } from "#desktop/excerpt-image/layer.ts";
import { layerReaderRefusingLoads } from "#__fixtures__/pdf-engine.ts";

/** One real layer, with a child scope a shutdown test can close itself. */
export const excerptImageFixture = Effect.fnUntraced(function* (deps: ExcerptDeps = {}) {
  const scope = yield* Scope.fork(yield* Scope.Scope);
  const context = yield* Layer.buildWithScope(layerExcerptImage(deps).pipe(Layer.provide([NodeFileSystem.layer, layerReaderRefusingLoads])), scope);
  const service = Context.get(context, ExcerptImageService);
  return {
    ...service,
    get queueDiagnostics() { return service.queueDiagnostics; },
    close: Scope.close(scope, Exit.void),
  };
});
