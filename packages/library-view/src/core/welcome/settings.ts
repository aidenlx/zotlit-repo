// The Welcome View keys of the plugin settings.
import * as v from "valibot";

import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

export const welcomeSettings = settingsSlice(
  {
    /**
     * The researcher dismissed the Welcome View banner above the Library View;
     * the open-welcome command shows it again. ADR 0077.
     */
    "welcome.dismissed": v.boolean(),
    /**
     * The researcher asked for the Welcome View banner ("Open welcome view",
     * "Welcome & help", "Review conversion"), so it shows with its setup steps
     * until they dismiss it, across reloads. ADR 0077.
     */
    "welcome.requested": v.boolean(),
    /**
     * "Show steps" on the banner's folded "Setup done" line is open, until the
     * banner is dismissed. ADR 0077.
     */
    "welcome.steps-shown": v.boolean(),
  },
  {
    "welcome.dismissed": false,
    "welcome.requested": false,
    "welcome.steps-shown": false,
  },
);

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof welcomeSettings> {}
}
