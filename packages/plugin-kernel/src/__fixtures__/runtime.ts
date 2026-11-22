import { onTestFinished } from "vitest";

import { Layer } from "effect";
import { buildRuntime } from "#effect-layer.ts";

export function testRuntime() {
  const stack = new AsyncDisposableStack();
  onTestFinished(() => stack.disposeAsync());
  return buildRuntime(Layer.empty, stack);
}
