import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";
import { catalog } from "@zotlit/plugin-messages/catalog.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import { defineHost } from "@zotlit/plugin-shell/obsidian/compose.ts";

import { features } from "./features.ts";
import { withHost } from "./services/settings/layer.ts";

export const host = defineHost({
  features,
  settings: withHost({}),
  languagePack: {
    catalog,
    runtime,
    namespace: "zotlit",
    repository: RELEASE_REPOSITORY,
  },
  settingTab: {
    top: ["resources", "literature-notes"],
    pages: [
      "profiles",
      "note-import",
      "citations",
      "zotero",
      "attachments",
      "reader",
      "advanced",
    ],
  },
  fileMenu: [
    "attachment-open",
    "pdf-note",
    "template-workbench",
    "note-feature",
    "citation-presentation",
    "annotation-history",
    "indexed-key",
    "show-in-library",
    "explorer",
    "query-file",
  ],
  folderMenu: ["query-file"],
});
