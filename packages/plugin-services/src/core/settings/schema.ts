// The plugin settings as one flat key→value map, assembled from slices. Each
// owner of settings keeps its slice beside its own code (`settingsSlice`); the
// base below holds the log slice, which every host keeps, and each other slice
// adds itself to `SettingsRegistry` by declaration merging beside its owner.
// The host composes the same slices into the `SettingsDefinition` it gives
// `PluginSettings`.

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
// oxlint-disable-next-line typescript/no-empty-object-type -- the slices add their keys by declaration merging
export interface SettingsRegistry extends SliceSettings<typeof logSettings> {}

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
