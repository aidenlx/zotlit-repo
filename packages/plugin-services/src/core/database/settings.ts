import type { SliceSettings } from "#core/settings/slice.ts";
import * as v from "valibot";

import { ZOTERO_LOCALES } from "@zotlit/zotero-compat";

import { settingsSlice } from "#core/settings/slice.ts";

const zoteroReadMode = v.picklist(["auto", "reflink", "copy", "immutable"]);
export type ZoteroReadMode = v.InferOutput<typeof zoteroReadMode>;

export const AUTOMATIC_ZOTERO_LANGUAGE = "auto";

export const databaseSettings = settingsSlice(
  {
    "zotero.auto-refresh": v.boolean(),
    "zotero.read-mode": zoteroReadMode,
    "zotero.language": v.union([
      v.literal(AUTOMATIC_ZOTERO_LANGUAGE),
      v.picklist(ZOTERO_LOCALES),
    ]),
  },
  {
    "zotero.auto-refresh": true,
    "zotero.read-mode": "auto",
    "zotero.language": AUTOMATIC_ZOTERO_LANGUAGE,
  },
);

declare module "#core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof databaseSettings> {}
}
