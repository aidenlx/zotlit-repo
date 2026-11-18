// The template keys of the plugin settings: the template folder, its trim
// rules, the frontmatter fields, and the state of the template conversion.
import * as v from "valibot";

import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";
import {
  autoTrimSchema,
  DEFAULT_AUTO_TRIM,
  frontmatterFieldSchema,
} from "@zotlit/templates/constants";

import { DEFAULT_FRONTMATTER_FIELDS } from "./defaults.ts";

const frontmatterFieldsSchema = v.pipe(
  v.array(frontmatterFieldSchema),
  v.checkItems(
    (item, index, array) =>
      array.findIndex((field) => field.key === item.key) === index,
    "Duplicate frontmatter key",
  ),
  v.readonly(),
);

export const templateSettings = settingsSlice(
  {
    "note.template-conversion-pending": v.boolean(),
    "note.template-conversion-result": v.nullable(
      v.object({
        /** `null` when the vault held no Literature Note slots to fold. */
        document: v.nullable(v.pipe(v.string(), v.nonEmpty())),
        trashed: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
        /** Legacy files a failed trash left behind; retried from the Welcome view.
         *  Absent in results saved before cleanup retry existed. */
        pendingCleanup: v.optional(v.array(v.string()), []),
      }),
    ),
    "note.frontmatter-fields": frontmatterFieldsSchema,
    "template.folder": v.string(),
    "template.auto-trim-leading": autoTrimSchema,
    "template.auto-trim-trailing": autoTrimSchema,
  },
  {
    "note.template-conversion-pending": false,
    "note.template-conversion-result": null,
    "note.frontmatter-fields": DEFAULT_FRONTMATTER_FIELDS,
    "template.folder": "templates",
    "template.auto-trim-leading": DEFAULT_AUTO_TRIM.leading,
    "template.auto-trim-trailing": DEFAULT_AUTO_TRIM.trailing,
  },
);

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof templateSettings> {}
}
