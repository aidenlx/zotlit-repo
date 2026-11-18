// The `obsidian://zotlit/<action>` handlers of every composed feature, on one
// registration.
import { Effect, FiberSet, Layer } from "effect";

import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { logAndContinue } from "@zotlit/plugin-kernel/effect-log.ts";

import type { ProtocolHandler } from "./feature.ts";

/**
 * Register each of `handlers` on the plugin. Each Obsidian callback runs its
 * handler as a fiber of the layer's Scope, so unloading the plugin interrupts
 * a run still going; a handler that fails is logged. The callback returns the
 * handler's fiber: Obsidian ignores it, and a test joins it for the outcome.
 * Obsidian removes the handlers as the plugin unloads.
 */
export const layerProtocolHandlers = (
  handlers: readonly ProtocolHandler[],
): Layer.Layer<never, never, any> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* PluginHost;
      const runs = yield* FiberSet.make();
      const run = yield* FiberSet.runtime(runs)<any>();
      for (const { action, handle } of handlers)
        host.registerObsidianProtocolHandler(action, (data) =>
          run(
            handle(data).pipe(
              logAndContinue("Protocol handler failed", "protocol", { action }),
            ),
          ),
        );
    }),
  );
