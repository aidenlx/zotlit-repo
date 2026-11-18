// This plugin's settings options: its composed definition and the migrations
// of its `data.json` history, over the platform's `PluginSettings`.
import type { Layer } from "effect";
import type { Plugin } from "obsidian";

import type { PluginData } from "@zotlit/plugin-services/obsidian/settings/plugin-data.ts";
import {
  layerPluginSettings,
  layerPluginSettingsOf,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type {
  PluginSettings,
  PluginSettingsOptions,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { settingsMigrations } from "./migrate.ts";
import { settingsDefinition } from "./schema.ts";

/** The options a caller may replace; the definition is this plugin's own. */
export type SettingsOptions = Partial<PluginSettingsOptions>;

/** The platform's settings options under this plugin's definition and migrations. */
export const withHost = (options: SettingsOptions): PluginSettingsOptions => ({
  definition: settingsDefinition,
  ...settingsMigrations,
  ...options,
});

/** Native settings layer, below logging and every consumer in the plugin graph. */
export function layerSettings(
  plugin: Pick<Plugin, "loadData" | "saveData"> & Partial<Pick<Plugin, "app">>,
  options: SettingsOptions = {},
): Layer.Layer<PluginSettings> {
  return layerPluginSettings(plugin, withHost(options));
}

/** The settings layer over the plugin data a caller provides. */
export function layerSettingsOf(
  options: SettingsOptions = {},
): Layer.Layer<PluginSettings, never, PluginData> {
  return layerPluginSettingsOf(withHost(options));
}
