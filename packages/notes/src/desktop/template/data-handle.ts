import { Effect } from "effect";
import type { Context } from "effect";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import { readCitationData, readTemplateData, withSettings } from "./data.ts";
import type { TemplateDataLoader, TemplateDataServices } from "./data.ts";

export function bindTemplateData(
  bridge: Pick<EffectBridge, "runPromise">,
  context: Context.Context<TemplateDataServices>,
): TemplateDataLoader {
  const run = <A, E>(effect: Effect.Effect<A, E, TemplateDataServices>) =>
    bridge.runPromise(Effect.provideContext(effect, context));
  return {
    load: (indexedKey, root, options) => {
      const read = readTemplateData(indexedKey, root);
      return run(
        (options?.settings === undefined
          ? read
          : read.pipe(withSettings(options.settings))
        ).pipe(Effect.mapError(({ cause }) => cause)),
      );
    },
    loadCitation: (selector, variant) =>
      run(
        readCitationData(selector, variant).pipe(
          Effect.mapError(({ cause }) => cause),
        ),
      ),
  };
}
