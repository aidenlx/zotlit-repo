// The Library View key of the plugin settings.
import * as v from "valibot";

import {
  jsonValueSchema,
  settingsSlice,
} from "@zotlit/plugin-services/core/settings/slice.ts";

export const librarySettings = settingsSlice(
  {
    /**
     * What the Library View shows, as its Library View Document; `null` until
     * the view saves one, and a new view opens on the default. Kept as a plain
     * JSON object: the Library View Document module reads it field by field,
     * so one field this build cannot read never resets the rest. ADR 0071.
     */
    "library.document": v.nullable(v.record(v.string(), jsonValueSchema)),
  },
  { "library.document": null },
);
