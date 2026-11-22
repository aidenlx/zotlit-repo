import type { SliceSettings } from "#core/settings/slice.ts";
import * as v from "valibot";

import { settingsSlice } from "#core/settings/slice.ts";

export const itemLookupSettings = settingsSlice(
  {
    "citation.show-citekey-in-suggester": v.boolean(),
  },
  { "citation.show-citekey-in-suggester": false },
);

declare module "#core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof itemLookupSettings> {}
}
