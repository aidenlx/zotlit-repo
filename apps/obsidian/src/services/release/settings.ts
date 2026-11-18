// The release check keys of the plugin settings.
import * as v from "valibot";

import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";

export const releaseSettings = settingsSlice(
  {
    "release.previous-version": v.nullable(v.string()),
    "release.notices-enabled": v.boolean(),
    "release.migration-pending": v.boolean(),
    /**
     * The running version is an update the Welcome View banner announces until
     * the researcher opens "What's new" or dismisses the banner. ADR 0077.
     */
    "release.update-pending": v.boolean(),
  },
  {
    // Absent until the release check records a launch; see the release service.
    "release.previous-version": null,
    "release.notices-enabled": true,
    "release.migration-pending": false,
    "release.update-pending": false,
  },
);
