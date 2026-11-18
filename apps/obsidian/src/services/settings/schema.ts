// The settings this plugin keeps: the slices of the platform services and of
// every feature, composed into the one definition `PluginSettings` loads.
// `src/typings/settings.d.ts` registers the same feature slices in
// `SettingsRegistry`; the check below keeps the two lists equal.
import * as v from "valibot";

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

import { citationSettings } from "@/services/citation-index/settings.ts";
import { noteImportSettings } from "@/services/note-import/settings.ts";
import { readerSettings } from "@/services/pdf-annotation-editor/settings.ts";
import { profileSettings } from "@/services/profile/settings.ts";
import { releaseSettings } from "@/services/release/settings.ts";
import { templateSettings } from "@/services/template/settings.ts";
import { librarySettings } from "@/views/library/settings.ts";
import { welcomeSettings } from "@/views/welcome/settings.ts";

export const schema = v.object({
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
  ...librarySettings.entries,
  ...welcomeSettings.entries,
  ...releaseSettings.entries,
});

/**
 * Current defaults. Host-dependent legacy defaults are represented as `null` and
 * resolved at the consume site, so their effective values still match legacy
 * `getDefaultSettings()` without persisting machine-specific values.
 */
export const defaults: Readonly<Settings> = Object.freeze({
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
  ...librarySettings.defaults,
  ...welcomeSettings.defaults,
  ...releaseSettings.defaults,
} satisfies Settings);

/** Compile-time assert: `T` must be `true`. */
type Expect<T extends true> = T;
type Equals<A, B> = [A, B] extends [B, A] ? true : false;
/** The composed schema holds exactly the registered keys. */
type _Composed = Expect<Equals<v.InferOutput<typeof schema>, Settings>>;

export const settingsDefinition: SettingsDefinition = { schema, defaults };
