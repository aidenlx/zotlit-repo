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

export type SettingsOptions = Partial<PluginSettingsOptions>;

export const withHost = (options: SettingsOptions): PluginSettingsOptions => ({
  definition: settingsDefinition,
  ...settingsMigrations,
  ...options,
});

export function layerSettings(
  plugin: Pick<Plugin, "loadData" | "saveData"> & Partial<Pick<Plugin, "app">>,
  options: SettingsOptions = {},
): Layer.Layer<PluginSettings> {
  return layerPluginSettings(plugin, withHost(options));
}

export function layerSettingsOf(
  options: SettingsOptions = {},
): Layer.Layer<PluginSettings, never, PluginData> {
  return layerPluginSettingsOf(withHost(options));
}
