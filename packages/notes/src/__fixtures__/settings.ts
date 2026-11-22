import type { Layer } from "effect";
import type { Plugin } from "obsidian";
import * as v from "valibot";

import { readerSettings } from "@zotlit/annotations/obsidian/pdf-annotation-editor/settings.ts";
import { citationSettings } from "@zotlit/citations/core/citation-index/settings.ts";
import { buildSettings as buildDefinedSettings } from "@zotlit/plugin-services/__fixtures__/settings.ts";
import type { SettingsFixtureOptions as DefinedSettingsOptions } from "@zotlit/plugin-services/__fixtures__/settings.ts";
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

import { noteImportSettings } from "#core/note-import/settings.ts";
import { templateSettings } from "#core/template/settings.ts";
import { profileSettings } from "#obsidian/profile/settings.ts";

export type { SettingsFixture } from "@zotlit/plugin-services/__fixtures__/settings.ts";

export const defaults = Object.freeze({
  ...logSettings.defaults,
  ...citationSettings.defaults,
  ...itemLookupSettings.defaults,
  ...profileSettings.defaults,
  ...templateSettings.defaults,
  ...noteImportSettings.defaults,
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
  ...profileSettings.entries,
  ...templateSettings.entries,
  ...noteImportSettings.entries,
  ...serverSettings.entries,
  ...databaseSettings.entries,
  ...libraryScopeSettings.entries,
  ...attachmentSettings.entries,
  ...readerSettings.entries,
}) as unknown as SettingsDefinition["schema"];

export const settingsDefinition: SettingsDefinition = { schema, defaults };

export function layerSettings(
  plugin: Pick<Plugin, "loadData" | "saveData">,
  options: Partial<PluginSettingsOptions> = {},
): Layer.Layer<PluginSettings> {
  return layerPluginSettings(plugin, {
    definition: settingsDefinition,
    ...options,
  });
}

export const buildSettings = (
  options: Omit<DefinedSettingsOptions, "definition">,
) => buildDefinedSettings({ definition: settingsDefinition, ...options });
