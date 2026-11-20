import { defineHost } from "@zotlit/plugin-shell/obsidian/compose.ts";
import { catalog } from "@zotlit/reader-messages/catalog.ts";
import { runtime } from "@zotlit/reader-messages/runtime.ts";

import { features } from "./features.ts";
import { withHost } from "./services/settings/layer.ts";

export const host = defineHost({
  features,
  settings: withHost({}),
  languagePack: {
    catalog,
    runtime,
    namespace: "zotlit-reader",
    repository: __PLUGIN_REPOSITORY__,
  },
  settingTab: { top: [], pages: ["reader", "advanced"] },
  fileMenu: [],
  folderMenu: [],
});
