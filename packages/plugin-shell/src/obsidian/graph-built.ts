import { Context, Layer } from "effect";

export class GraphBuilt extends Context.Service<
  GraphBuilt,
  { readonly whenBuilt: Promise<void> }
>()("zotlit/shell/GraphBuilt") {}

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
