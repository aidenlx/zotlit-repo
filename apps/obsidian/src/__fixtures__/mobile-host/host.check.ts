import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";
import { catalog } from "@zotlit/plugin-messages/catalog.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import {
  defineHost,
  settingsDefinitionOf,
} from "@zotlit/plugin-shell/obsidian/compose.ts";

import { mobileFeatures } from "./features.ts";

export const mobileHost = defineHost({
  features: mobileFeatures,
  settings: { definition: settingsDefinitionOf(mobileFeatures) },
  languagePack: {
    catalog,
    runtime,
    namespace: "zotlit",
    repository: RELEASE_REPOSITORY,
  },
  settingTab: {
    top: ["literature-notes"],
    pages: ["note-import", "citations", "zotero", "reader", "advanced"],
  },
  fileMenu: ["indexed-key", "annotation-history"],
  folderMenu: [],
});
