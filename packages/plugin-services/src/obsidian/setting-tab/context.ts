import type { Settings } from "#core/settings/schema.ts";
import type { App, PluginManifest, SettingDefinitionItem } from "obsidian";

import type { SettingTabShape } from "./effect-tab.ts";

export type SettingsKey = keyof Settings;

// oxlint-disable-next-line typescript/no-empty-object-type -- each page's owner fills it by declaration merging
export interface SettingTabSlots {}

export interface SettingTabContext {
  tab: SettingTabShape;
  app: App;
  manifest: PluginManifest;
  slot(id: keyof SettingTabSlots): SettingDefinitionItem<SettingsKey>[];
}
