// The Attachment Import keys of the plugin settings.
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
