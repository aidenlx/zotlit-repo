import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { settingsDefinitionOf } from "@zotlit/plugin-shell/obsidian/compose.ts";
import type { ComposedSettings } from "@zotlit/plugin-shell/obsidian/feature.ts";

import { features } from "@/features.ts";

export const settingsDefinition = settingsDefinitionOf(features);

export const { schema } = settingsDefinition;

export const { defaults } = settingsDefinition;

type Expect<T extends true> = T;
type Equals<A, B> = [A, B] extends [B, A] ? true : false;
type _Composed = Expect<Equals<ComposedSettings<typeof features>, Settings>>;
