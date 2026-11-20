// The Attachment Import keys of the plugin settings.

import type { SliceSettings } from "#core/settings/slice.ts";
import * as v from "valibot";

import { settingsSlice } from "#core/settings/slice.ts";

export const attachmentSettings = settingsSlice(
  {
    "attachment.folder-path": v.nullable(v.string()),
    "attachment.import": v.boolean(),
  },
  {
    "attachment.folder-path": null,
    "attachment.import": true,
  },
);

declare module "#core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof attachmentSettings> {}
}
