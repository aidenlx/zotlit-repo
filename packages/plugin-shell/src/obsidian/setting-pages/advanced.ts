import type {
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingGroupItem,
} from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { languagePackResetItem } from "@zotlit/plugin-services/obsidian/language-pack/reset.ts";
import { loggingItems } from "@zotlit/plugin-services/obsidian/log/settings-rows.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

declare module "@zotlit/plugin-services/obsidian/setting-tab/context.ts" {
  interface SettingTabSlots {
    "advanced.general": unknown;
    "advanced.template-engine": unknown;
    "advanced.local-server": unknown;
    "advanced.online-library": unknown;
    "advanced.recovery": unknown;
  }
}

export const advancedPageSlots = {
  general: "advanced.general",
  templateEngine: "advanced.template-engine",
  localServer: "advanced.local-server",
  onlineLibrary: "advanced.online-library",
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
    ...ctx.slot(advancedPageSlots.localServer),
    ...ctx.slot(advancedPageSlots.onlineLibrary),
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
