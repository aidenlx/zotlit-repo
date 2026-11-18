// Items for the "Reader" sub-page: what ZotLit does around Obsidian's own PDF
// reader once it puts a Zotero Attachment there.

import type { SettingDefinitionItem } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

export function readerPageItems(): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      id: "settings_reader_focus_annot_view",
      name: m.settings_reader_focus_annot_view_name(),
      desc: m.settings_reader_focus_annot_view_desc(),
      control: { type: "toggle", key: "reader.focus-annot-view" },
    },
    {
      id: "settings_reader_open_file_links",
      name: m.settings_reader_open_file_links_name(),
      desc: m.settings_reader_open_file_links_desc(),
      control: { type: "toggle", key: "reader.open-file-links" },
    },
    {
      id: "settings_reader_open_annotation_links",
      name: m.settings_reader_open_annotation_links_name(),
      desc: m.settings_reader_open_annotation_links_desc(),
      control: { type: "toggle", key: "reader.open-annotation-links" },
    },
  ];
}
