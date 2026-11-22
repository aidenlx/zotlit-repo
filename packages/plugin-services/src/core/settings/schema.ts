import type { logSettings } from "#core/log/settings.ts";
import type * as v from "valibot";

import type { SliceSettings } from "./slice.ts";

// oxlint-disable-next-line typescript/no-empty-object-type -- the slices add their keys by declaration merging
export interface SettingsRegistry extends SliceSettings<typeof logSettings> {}

export type Settings = SettingsRegistry;

export interface SettingsDefinition {
  readonly schema: v.GenericSchema<unknown, Settings> & {
    readonly entries: {
      readonly [K in keyof Settings]: v.GenericSchema<unknown, Settings[K]>;
    };
  };
  readonly defaults: Readonly<Settings>;
}
