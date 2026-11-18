// The Note Import key of the plugin settings.
import { highlightMappingsSchema } from "@zotlit/plugin-kernel/highlight-mapping.ts";
import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";

export const noteImportSettings = settingsSlice(
  { "note.import-highlight-mappings": highlightMappingsSchema },
  { "note.import-highlight-mappings": {} },
);
