// The Node-free host, checked whole: it type-checks only while every port its
// features read has a stub in `capabilities.ts`. Only `tsconfig.mobile.json`
// checks it: a program with the desktop files registers the desktop
// services in the open registries, which this host does not fill.
import {
  defineHost,
  settingsDefinitionOf,
} from "@zotlit/plugin-shell/obsidian/compose.ts";

import { mobileFeatures } from "./features.ts";

export const mobileHost = defineHost({
  features: mobileFeatures,
  settings: { definition: settingsDefinitionOf(mobileFeatures) },
  settingTab: {
    top: ["literature-notes"],
    pages: ["note-import", "citations", "zotero", "reader", "advanced"],
  },
  fileMenu: ["indexed-key", "annotation-history"],
  folderMenu: [],
});
