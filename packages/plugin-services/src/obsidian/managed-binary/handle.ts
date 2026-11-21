// A Managed Binary service with runners captured at build, for callers outside Effect.
import type { Effect } from "effect";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

/**
 * A binary's service and the two ways to enter Effect with it through
 * {@link EffectBridge}. `Api` is the binary's service (`PackBinaryApi`).
 */
export interface BinaryHandle<Api> {
  readonly binary: Api;
  readonly runSync: <A>(effect: Effect.Effect<A>) => A;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}

export function bindManagedBinary<Api>(
  bridge: Pick<EffectBridge, "runSync" | "runPromise">,
  binary: Api,
): BinaryHandle<Api> {
  return {
    binary,
    runSync: bridge.runSync,
    runPromise: bridge.runPromise,
  };
}
