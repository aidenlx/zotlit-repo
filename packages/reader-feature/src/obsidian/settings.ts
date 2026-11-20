import * as v from "valibot";

import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

export const readerSettings = settingsSlice(
  { "reader.open-all-pdfs": v.boolean() },
  { "reader.open-all-pdfs": true },
);

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof readerSettings> {}
}
