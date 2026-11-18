// Desktop ZotLit as a host of the shell: its features, its settings history,
// and the order of its setting tab and its file menu.
import { defineHost } from "@zotlit/plugin-shell/obsidian/compose.ts";

import { features } from "./features.ts";
import { withHost } from "./services/settings/layer.ts";

export const host = defineHost({
  features,
  settings: withHost({}),
  settingTab: {
    top: ["resources", "literature-notes"],
    // Profiles leads because it extends the default Profile's rows above it.
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
  // Each entry names its own section; this order is the order of the rows
  // inside each section.
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
