import * as v from "valibot";

import { attachmentSettings } from "#core/attachment-import/settings.ts";
import { databaseSettings } from "#core/database/settings.ts";
import { itemLookupSettings } from "#core/item-lookup/settings.ts";
import { libraryScopeSettings } from "#core/library-scope/settings.ts";
import { serverSettings } from "#core/local-server/settings.ts";
import { logSettings } from "#core/log/settings.ts";
import type { Settings, SettingsDefinition } from "#core/settings/schema.ts";

const schema = v.object({
  ...logSettings.entries,
  ...itemLookupSettings.entries,
  ...serverSettings.entries,
  ...databaseSettings.entries,
  ...libraryScopeSettings.entries,
  ...attachmentSettings.entries,
});

export const platformDefaults: Readonly<Settings> = Object.freeze({
  ...logSettings.defaults,
  ...itemLookupSettings.defaults,
  ...serverSettings.defaults,
  ...databaseSettings.defaults,
  ...libraryScopeSettings.defaults,
  ...attachmentSettings.defaults,
} satisfies Settings);

export const platformSettings: SettingsDefinition = {
  schema,
  defaults: platformDefaults,
};
