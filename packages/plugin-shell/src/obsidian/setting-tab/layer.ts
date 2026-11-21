import type { Feature } from "#obsidian/feature.ts";
// The setting tab as a scoped layer: it registers the tab, keeps its
// definitions current, and removes it when its Scope closes.
import { Duration, Effect, Layer, Stream } from "effect";

import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { makeSettingTab } from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";
import type {
  SettingTab,
  SettingTabEnv,
} from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";

import { ShellSettingTab } from "./tab.ts";
import type { SettingTabOrder } from "./tab.ts";

/**
 * How long the tab waits for changes to settle before it rebuilds. Obsidian
 * re-renders every `render` row on a rebuild, and startup moves several
 * services at once.
 */
const REBUILD_SETTLE = Duration.millis(50);

/** The tab of `features` in `order`. */
export function layerSettingTab(
  features: readonly Feature<any, any, any>[],
  order: SettingTabOrder,
): Layer.Layer<never, never, Exclude<SettingTabEnv, SettingTab>> {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* PluginHost;
      let tab: ShellSettingTab | undefined;
      const service = yield* makeSettingTab(() => tab?.update());
      tab = yield* host.addSettingTab(
        (plugin) =>
          new ShellSettingTab(plugin, { tab: service }, { features, order }),
      );

      // Rows that are included or left out, not toggled through `visible`,
      // follow what the features name. A scalar `control` edit is read on
      // Obsidian's own render cycle, so it never rebuilds and never steals
      // focus from an input.
      const signals = yield* Effect.forEach(
        features.flatMap((feature) => feature.settingTab.rebuild ?? []),
        (signal) => signal,
      );
      if (signals.length === 0) return;
      yield* forkEach(
        Stream.mergeAll(signals, { concurrency: "unbounded" }).pipe(
          Stream.debounce(REBUILD_SETTLE),
        ),
        () => service.update,
      );
    }),
  ) as Layer.Layer<never, never, Exclude<SettingTabEnv, SettingTab>>;
}
