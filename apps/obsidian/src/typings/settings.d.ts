// The plugin's feature slices of the settings, added to the settings registry
// of the platform services (`SettingsRegistry`) by declaration merging. The
// platform services, the annotation feature, the citations and the notes
// register their own slices; `services/settings/schema.ts` composes all of
// them into the definition the plugin loads.
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

import type { releaseSettings } from "@/services/release/settings.ts";
import type { librarySettings } from "@/views/library/settings.ts";
import type { welcomeSettings } from "@/views/welcome/settings.ts";

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  interface SettingsRegistry
    extends
      SliceSettings<typeof librarySettings>,
      SliceSettings<typeof welcomeSettings>,
      SliceSettings<typeof releaseSettings> {}
}
