import type { Feature } from "#obsidian/feature.ts";
import { Duration, Effect, Layer, Stream } from "effect";

import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { makeSettingTab } from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";
import type {
  SettingTab,
  SettingTabEnv,
} from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";

import type { SettingTabOrder } from "./tab.ts";
import { ShellSettingTab } from "./tab.ts";

const REBUILD_SETTLE = Duration.millis(50);

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
