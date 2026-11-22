import type { Layer } from "effect";
import type { Plugin } from "obsidian";
import * as v from "valibot";

import { readerSettings } from "@zotlit/annotations/obsidian/pdf-annotation-editor/settings.ts";
import {
  applySettings,
  buildSettings as buildDefinedSettings,
  settingsFeed as definedSettingsFeed,
  settingsOf as definedSettingsOf,
} from "@zotlit/plugin-services/__fixtures__/settings.ts";
import type { SettingsFixture } from "@zotlit/plugin-services/__fixtures__/settings.ts";
import { attachmentSettings } from "@zotlit/plugin-services/core/attachment-import/settings.ts";
import { databaseSettings } from "@zotlit/plugin-services/core/database/settings.ts";
import { itemLookupSettings } from "@zotlit/plugin-services/core/item-lookup/settings.ts";
import { libraryScopeSettings } from "@zotlit/plugin-services/core/library-scope/settings.ts";
import { serverSettings } from "@zotlit/plugin-services/core/local-server/settings.ts";
import { logSettings } from "@zotlit/plugin-services/core/log/settings.ts";
import type {
  Settings,
  SettingsDefinition,
} from "@zotlit/plugin-services/core/settings/schema.ts";
import { layerPluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type {
  PluginSettings,
  PluginSettingsOptions,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { citationSettings } from "#core/citation-index/settings.ts";

export type { SettingsFixture } from "@zotlit/plugin-services/__fixtures__/settings.ts";

export const defaults = Object.freeze({
  ...logSettings.defaults,
  ...citationSettings.defaults,
  ...itemLookupSettings.defaults,
  ...serverSettings.defaults,
  ...databaseSettings.defaults,
  ...libraryScopeSettings.defaults,
  ...attachmentSettings.defaults,
  ...readerSettings.defaults,
}) as Readonly<Settings>;

const schema = v.object({
  ...logSettings.entries,
  ...citationSettings.entries,
  ...itemLookupSettings.entries,
  ...serverSettings.entries,
  ...databaseSettings.entries,
  ...libraryScopeSettings.entries,
  ...attachmentSettings.entries,
  ...readerSettings.entries,
}) as unknown as SettingsDefinition["schema"];

const definition: SettingsDefinition = { schema, defaults };

export type SettingsFixtureOptions = Partial<PluginSettingsOptions> & {
  plugin: Pick<Plugin, "loadData" | "saveData">;
};

export function layerSettings(
  plugin: Pick<Plugin, "loadData" | "saveData">,
  options: Partial<PluginSettingsOptions> = {},
): Layer.Layer<PluginSettings> {
  return layerPluginSettings(plugin, { definition, ...options });
}

export const settingsOf = ({ plugin, ...options }: SettingsFixtureOptions) =>
  definedSettingsOf({ plugin, definition, ...options });

export const settingsFeed = (overrides: Partial<Settings> = {}) =>
  definedSettingsFeed(defaults, overrides);

export async function buildSeededSettings(
  overrides: Partial<Settings> = {},
): Promise<SettingsFixture> {
  const settings = await buildDefinedSettings({
    definition,
    plugin: {
      loadData: () => Promise.resolve(null),
      saveData: () => Promise.resolve(),
    },
  });
  applySettings(settings, settings.bridge, overrides);
  return settings;
}
