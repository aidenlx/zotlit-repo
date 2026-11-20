import { defineHost } from "@zotlit/plugin-shell/obsidian/compose.ts";

import { features } from "./features.ts";
import { withHost } from "./services/settings/layer.ts";

export const host = defineHost({
  features,
  settings: withHost({}),
  settingTab: { top: [], pages: [] },
  fileMenu: [],
  folderMenu: [],
});
