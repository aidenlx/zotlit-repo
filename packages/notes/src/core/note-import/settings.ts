// The Note Import key of the plugin settings.
import { highlightMappingsSchema } from "@zotlit/plugin-kernel/highlight-mapping.ts";
import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

export const noteImportSettings = settingsSlice(
  { "note.import-highlight-mappings": highlightMappingsSchema },
  { "note.import-highlight-mappings": {} },
);

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof noteImportSettings> {}
}
