// The plugin's feature slices of the settings, added to the settings registry
// of the platform services (`SettingsRegistry`) by declaration merging. The
// platform services register their own slices; `services/settings/schema.ts`
// composes all of them into the definition the plugin loads.
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

import type { citationSettings } from "@/services/citation-index/settings.ts";
import type { noteImportSettings } from "@/services/note-import/settings.ts";
import type { readerSettings } from "@/services/pdf-annotation-editor/settings.ts";
import type { profileSettings } from "@/services/profile/settings.ts";
import type { releaseSettings } from "@/services/release/settings.ts";
import type { templateSettings } from "@/services/template/settings.ts";
import type { librarySettings } from "@/views/library/settings.ts";
import type { welcomeSettings } from "@/views/welcome/settings.ts";

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  interface SettingsRegistry
    extends
      SliceSettings<typeof citationSettings>,
      SliceSettings<typeof profileSettings>,
      SliceSettings<typeof templateSettings>,
      SliceSettings<typeof noteImportSettings>,
      SliceSettings<typeof readerSettings>,
      SliceSettings<typeof librarySettings>,
      SliceSettings<typeof welcomeSettings>,
      SliceSettings<typeof releaseSettings> {}
}
