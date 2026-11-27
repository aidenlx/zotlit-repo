import type { SettingDefinitionItem, SettingDefinitionPage } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { chineseSegmenterDefinition } from "@zotlit/plugin-services/obsidian/chinese-segmenter/settings-row.ts";
import {
  libraryScopeRow,
  selectedLibrariesList,
} from "@zotlit/plugin-services/obsidian/library-scope/settings-rows.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

declare module "@zotlit/plugin-services/obsidian/setting-tab/context.ts" {
  interface SettingTabSlots {
    "zotero.source": unknown;
    "zotero.database": unknown;
    "zotero.sync": unknown;
    "zotero.editing": unknown;
  }
}

export const zoteroPageSlots = {
  source: "zotero.source",
  database: "zotero.database",
  sync: "zotero.sync",
  editing: "zotero.editing",
} as const;

export function zoteroPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    id: "settings_page_zotero",
    name: m.settings_page_zotero(),
    desc: m.settings_page_zotero_desc(),
    items: zoteroPageItems(ctx),
  };
}

function zoteroPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    ...ctx.slot(zoteroPageSlots.source),
    ...ctx.slot(zoteroPageSlots.database),
    {
      type: "group",
      id: "settings_zotero_libraries",
      heading: m.settings_zotero_libraries_heading(),
      items: [libraryScopeRow(ctx)],
    },
    selectedLibrariesList(ctx),
    ...ctx.slot(zoteroPageSlots.sync),
    ...ctx.slot(zoteroPageSlots.editing),
    {
      type: "group",
      id: "settings_zotero_search",
      heading: m.settings_zotero_search_heading(),
      items: [chineseSegmenterDefinition(ctx)],
    },
  ];
}
