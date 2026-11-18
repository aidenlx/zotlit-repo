// A test-owned Effect bridge over an empty managed runtime.
// oxlint-disable-next-line no-restricted-imports -- The fixture needs an empty standalone runtime with no plugin services.
import { Layer, ManagedRuntime } from "effect";
import { effectBridge } from "#effect-bridge.ts";
import type { EffectBridge } from "#effect-bridge.ts";

export function openTestBridge(): EffectBridge & AsyncDisposable {
  const runtime = ManagedRuntime.make(Layer.empty);
  return Object.assign(effectBridge(runtime), {
    [Symbol.asyncDispose]: () => runtime.dispose(),
  });
}
