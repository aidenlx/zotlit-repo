// The item search key of the plugin settings. Its `citation.` name predates
// the item search; data.json keeps it.
import * as v from "valibot";

import { settingsSlice } from "#core/settings/slice.ts";

export const itemLookupSettings = settingsSlice(
  {
    /** Show each hit's Citation Key in the item search results. */
    "citation.show-citekey-in-suggester": v.boolean(),
  },
  { "citation.show-citekey-in-suggester": false },
);
