import * as v from "valibot";

import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

export const welcomeSettings = settingsSlice(
  {
    "welcome.dismissed": v.boolean(),
    "welcome.requested": v.boolean(),
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
