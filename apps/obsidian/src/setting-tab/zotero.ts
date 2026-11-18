// The "Zotero" page: how ZotLit talks to Zotero, in the order a researcher
// meets it — the database, the libraries it reads, keeping it current, editing
// back, and search. Where Zotero lives on this device sits one page deeper.
import type { SettingDefinitionItem } from "obsidian";

import { zoteroEditingRow } from "@zotlit/annotations/obsidian/annotation-repository/editing-settings-row.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  databaseFileItem,
  databaseLocationItems,
  databaseSyncItems,
} from "@zotlit/plugin-services/desktop/database/settings-rows.ts";
import { chineseSegmenterDefinition } from "@zotlit/plugin-services/obsidian/chinese-segmenter/settings-row.ts";
import {
  libraryScopeRow,
  selectedLibrariesList,
} from "@zotlit/plugin-services/obsidian/library-scope/settings-rows.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { liveUpdatesItems } from "./local-server.ts";

export function zoteroPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    // The general section leads without a heading: the database ZotLit reads,
    // and the way into its location when auto-detect gets it wrong.
    {
      type: "group",
      id: "settings_zotero_database",
      items: [
        databaseFileItem(ctx),
        {
          type: "page",
          id: "settings_page_zotero_location",
          name: m.settings_page_zotero_location(),
          desc: m.settings_page_zotero_location_desc(),
          items: databaseLocationItems(ctx),
        },
      ],
    },
    {
      type: "group",
      id: "settings_zotero_libraries",
      heading: m.settings_zotero_libraries_heading(),
      items: [libraryScopeRow(ctx)],
    },
    // A list cannot sit inside a group, so the selected Libraries follow the
    // Libraries group as their own compact section.
    selectedLibrariesList(ctx),
    {
      type: "group",
      id: "settings_zotero_sync",
      heading: m.settings_zotero_sync_heading(),
      items: databaseSyncItems(liveUpdatesItems(ctx)),
    },
    {
      type: "group",
      id: "settings_zotero_editing_group",
      heading: m.settings_zotero_editing_heading(),
      items: [zoteroEditingRow(ctx)],
    },
    {
      type: "group",
      id: "settings_zotero_search",
      heading: m.settings_zotero_search_heading(),
      items: [chineseSegmenterDefinition(ctx)],
    },
  ];
}
