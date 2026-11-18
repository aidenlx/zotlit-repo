// The "Advanced" page: the rows a user touches once — update notices, the
// template engine, the local server, logging, and recovery actions. The
// features that own a row give it through the page's slots.
import type {
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingGroupItem,
} from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { languagePackResetItem } from "@zotlit/plugin-services/obsidian/language-pack/reset.ts";
import { localServerItems } from "@zotlit/plugin-services/obsidian/local-server/settings-rows.ts";
import { loggingItems } from "@zotlit/plugin-services/obsidian/log/settings-rows.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

declare module "@zotlit/plugin-services/obsidian/setting-tab/context.ts" {
  interface SettingTabSlots {
    /** The Advanced page's lead rows, above the groups. */
    "advanced.general": unknown;
    /** The Advanced page, after the lead rows: the template engine group. */
    "advanced.template-engine": unknown;
    /** The Recovery group, above the Language Pack reset. */
    "advanced.recovery": unknown;
  }
}

/** The slots the Advanced page holds. */
export const advancedPageSlots = {
  general: "advanced.general",
  templateEngine: "advanced.template-engine",
  recovery: "advanced.recovery",
} as const;

export function advancedPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    id: "settings_page_advanced",
    name: m.settings_page_advanced(),
    desc: m.settings_page_advanced_desc(),
    items: advancedPageItems(ctx),
  };
}

function advancedPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    ...ctx.slot(advancedPageSlots.general),
    ...ctx.slot(advancedPageSlots.templateEngine),
    {
      type: "group",
      id: "settings_advanced_local_server",
      heading: m.settings_advanced_local_server_heading(),
      items: localServerItems(ctx),
    },
    {
      type: "group",
      id: "settings_advanced_logging",
      heading: m.settings_advanced_logging_heading(),
      items: loggingItems(ctx),
    },
    {
      type: "group",
      id: "settings_advanced_recovery",
      heading: m.settings_advanced_recovery_heading(),
      items: [
        ...(ctx.slot(
          advancedPageSlots.recovery,
        ) as SettingGroupItem<SettingsKey>[]),
        languagePackResetItem(ctx),
      ],
    },
  ];
}
