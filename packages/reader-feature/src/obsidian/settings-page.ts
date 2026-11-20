import type { SettingDefinitionPage } from "obsidian";

import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import * as m from "@zotlit/reader-messages/messages.ts";

export function readerPage(): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    id: "reader_settings_page",
    name: m.reader_settings_page(),
    desc: m.reader_settings_page_desc(),
    items: [
      {
        id: "reader_settings_open_all_pdfs",
        name: m.reader_settings_open_all_pdfs_name(),
        desc: m.reader_settings_open_all_pdfs_desc(),
        control: { type: "toggle", key: "reader.open-all-pdfs" },
      },
    ],
  };
}
