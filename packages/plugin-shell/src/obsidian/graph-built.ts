// The moment the plugin graph has finished building, for a port that must not
// act during start-up.
import { Context, Layer } from "effect";

/**
 * Settles once every service of the plugin graph has acquired. A port whose
 * work opens a view (a prompt) awaits it, so the work runs after start-up
 * and never during a layer's acquisition.
 */
export class GraphBuilt extends Context.Service<
  GraphBuilt,
  { readonly whenBuilt: Promise<void> }
>()("zotlit/shell/GraphBuilt") {}

/** The signal and the call that settles it, made once per load. */
export function makeGraphBuilt(): {
  readonly layer: Layer.Layer<GraphBuilt>;
  readonly settle: () => void;
} {
  const { promise, resolve } = Promise.withResolvers<void>();
  return {
    layer: Layer.succeed(GraphBuilt, { whenBuilt: promise }),
    settle: () => resolve(),
  };
}
