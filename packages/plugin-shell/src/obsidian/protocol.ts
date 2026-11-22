import { Effect, FiberSet, Layer } from "effect";

import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { logAndContinue } from "@zotlit/plugin-kernel/effect-log.ts";

import type { ProtocolHandler } from "./feature.ts";

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
