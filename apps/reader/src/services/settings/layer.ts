import type { PluginSettingsOptions } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { settingsDefinition } from "./schema.ts";

export const withHost = (
  options: Partial<PluginSettingsOptions>,
): PluginSettingsOptions => ({
  definition: settingsDefinition,
  ...options,
});
