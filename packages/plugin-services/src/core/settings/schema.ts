// The plugin settings as one flat key→value map, assembled from slices. Each
// owner of settings keeps its slice beside its own code (`settingsSlice`); this
// package registers its slices below, and a host adds the slices of its
// features to `SettingsRegistry` by declaration merging. The host composes the
// same slices into the `SettingsDefinition` it gives `PluginSettings`.

import type { attachmentSettings } from "#core/attachment-import/settings.ts";
import type { databaseSettings } from "#core/database/settings.ts";
import type { itemLookupSettings } from "#core/item-lookup/settings.ts";
import type { libraryScopeSettings } from "#core/library-scope/settings.ts";
import type { serverSettings } from "#core/local-server/settings.ts";
import type { logSettings } from "#core/log/settings.ts";
import type * as v from "valibot";

import type { SliceSettings } from "./slice.ts";

/**
 * Every settings key and its value. A host's features add their slices:
 *
 * ```ts
 * declare module "@zotlit/plugin-services/core/settings/schema.ts" {
 *   interface SettingsRegistry extends SliceSettings<typeof readerSettings> {}
 * }
 * ```
 */
export interface SettingsRegistry
  extends
    SliceSettings<typeof logSettings>,
    SliceSettings<typeof serverSettings>,
    SliceSettings<typeof databaseSettings>,
    SliceSettings<typeof libraryScopeSettings>,
    SliceSettings<typeof itemLookupSettings>,
    SliceSettings<typeof attachmentSettings> {}

export type Settings = SettingsRegistry;

/**
 * The schema and defaults of every key a host keeps, composed from its
 * slices. `schema.entries` is the source of truth for the valid key set.
 */
export interface SettingsDefinition {
  readonly schema: v.GenericSchema<unknown, Settings> & {
    readonly entries: {
      readonly [K in keyof Settings]: v.GenericSchema<unknown, Settings[K]>;
    };
  };
  readonly defaults: Readonly<Settings>;
}
