// The "Zotero" page: how ZotLit talks to Zotero, in the order a researcher
// meets it — the database, the libraries it reads, keeping it current, editing
// back, and search. Where Zotero lives on this device sits one page deeper.
// The database and the sync rows read the Zotero data folder, so a desktop
// host gives them; the Zotero editing row comes from the annotations.
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
    /** The Zotero page's lead: the database ZotLit reads and its location. */
    "zotero.database": unknown;
    /** The Zotero page, after the Libraries: keeping the database current. */
    "zotero.sync": unknown;
    /** The Zotero page, after the sync rows: editing Zotero back. */
    "zotero.editing": unknown;
  }
}

/** The slots the Zotero page holds. */
export const zoteroPageSlots = {
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
    // The general section leads without a heading: the database ZotLit reads,
    // and the way into its location when auto-detect gets it wrong.
    ...ctx.slot(zoteroPageSlots.database),
    {
      type: "group",
      id: "settings_zotero_libraries",
      heading: m.settings_zotero_libraries_heading(),
      items: [libraryScopeRow(ctx)],
    },
    // A list cannot sit inside a group, so the selected Libraries follow the
    // Libraries group as their own compact section.
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
