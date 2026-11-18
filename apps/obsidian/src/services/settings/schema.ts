// The settings this plugin keeps: the slices of its features, composed by the
// shell into the one definition `PluginSettings` loads. Each slice registers
// itself in `SettingsRegistry` beside its owner; the check below keeps the
// composition equal to the registered keys.
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { settingsDefinitionOf } from "@zotlit/plugin-shell/obsidian/compose.ts";
import type { ComposedSettings } from "@zotlit/plugin-shell/obsidian/feature.ts";

import { features } from "@/features.ts";

export const settingsDefinition = settingsDefinitionOf(features);

export const { schema } = settingsDefinition;

/**
 * Current defaults. Host-dependent legacy defaults are represented as `null` and
 * resolved at the consume site, so their effective values still match legacy
 * `getDefaultSettings()` without persisting machine-specific values.
 */
export const { defaults } = settingsDefinition;

/** Compile-time assert: `T` must be `true`. */
type Expect<T extends true> = T;
type Equals<A, B> = [A, B] extends [B, A] ? true : false;
/** The composed slices hold exactly the registered keys. */
type _Composed = Expect<Equals<ComposedSettings<typeof features>, Settings>>;
