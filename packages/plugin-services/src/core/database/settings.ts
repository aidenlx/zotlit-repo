// The keys of the plugin settings that configure the database source: how
// ZoteroReads reads the Zotero database (`ReadsConfig` of its contract).

import type { SliceSettings } from "#core/settings/slice.ts";
import * as v from "valibot";

import { settingsSlice } from "#core/settings/slice.ts";

const zoteroReadMode = v.picklist(["auto", "reflink", "copy", "immutable"]);
export type ZoteroReadMode = v.InferOutput<typeof zoteroReadMode>;

export const databaseSettings = settingsSlice(
  {
    "zotero.auto-refresh": v.boolean(),
    "zotero.read-mode": zoteroReadMode,
  },
  {
    "zotero.auto-refresh": true,
    "zotero.read-mode": "auto",
  },
);

declare module "#core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof databaseSettings> {}
}
