// The settings store over a test's plugin data, for any host definition.
import { Context, Effect, Layer } from "effect";
import type { Plugin } from "obsidian";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import type { Settings } from "#core/settings/schema.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "#obsidian/settings/service.ts";
import type { PluginSettingsOptions } from "#obsidian/settings/service.ts";

export type SettingsFixtureOptions = PluginSettingsOptions & {
  plugin: Pick<Plugin, "loadData" | "saveData">;
};

export const settingsOf = Effect.fnUntraced(function* ({
  plugin,
  ...options
}: SettingsFixtureOptions) {
  return Context.get(
    yield* Layer.build(layerPluginSettings(plugin, options)),
    PluginSettings,
  );
});

/** Writes `overrides` through the real store's `update`. */
export function applySettings(
  settings: Pick<PluginSettings["Service"], "update">,
  bridge: Pick<EffectBridge, "runSync">,
  overrides: Partial<Settings>,
): void {
  if (Object.keys(overrides).length > 0)
    bridge.runSync(settings.update(overrides));
}
