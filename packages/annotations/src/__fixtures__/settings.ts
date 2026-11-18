// The settings the annotation feature reads, for its tests: the platform
// slices and the reader slice. A host's program registers more keys, which
// these tests never read, so the defaults stand in for its whole map.
import { attachmentSettings } from "@zotlit/plugin-services/core/attachment-import/settings.ts";
import { databaseSettings } from "@zotlit/plugin-services/core/database/settings.ts";
import { itemLookupSettings } from "@zotlit/plugin-services/core/item-lookup/settings.ts";
import { libraryScopeSettings } from "@zotlit/plugin-services/core/library-scope/settings.ts";
import { serverSettings } from "@zotlit/plugin-services/core/local-server/settings.ts";
import { logSettings } from "@zotlit/plugin-services/core/log/settings.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import { readerSettings } from "#obsidian/pdf-annotation-editor/settings.ts";

export const defaults = Object.freeze({
  ...logSettings.defaults,
  ...itemLookupSettings.defaults,
  ...serverSettings.defaults,
  ...databaseSettings.defaults,
  ...libraryScopeSettings.defaults,
  ...attachmentSettings.defaults,
  ...readerSettings.defaults,
}) as Readonly<Settings>;
