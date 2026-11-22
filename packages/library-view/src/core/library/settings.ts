import * as v from "valibot";

import {
  jsonValueSchema,
  settingsSlice,
} from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

export const librarySettings = settingsSlice(
  {
    "library.document": v.nullable(v.record(v.string(), jsonValueSchema)),
  },
  { "library.document": null },
);

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof librarySettings> {}
}
