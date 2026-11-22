import * as v from "valibot";

import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

export const releaseSettings = settingsSlice(
  {
    "release.previous-version": v.nullable(v.string()),
    "release.notices-enabled": v.boolean(),
    "release.migration-pending": v.boolean(),
    "release.update-pending": v.boolean(),
  },
  {
    "release.previous-version": null,
    "release.notices-enabled": true,
    "release.migration-pending": false,
    "release.update-pending": false,
  },
);

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof releaseSettings> {}
}
