import { Effect } from "effect";
import type {
  App,
  SettingDefinition,
  SettingDefinitionItem,
  SettingDefinitionPage,
} from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

export type SettingPagePath = readonly SettingDefinitionPage["id"][];

export function openSettingsTab(
  app: App,
  tabId: string,
  pagePath: SettingPagePath = [],
): void {
  app.setting.open();
  const tab = app.setting.openTabById(tabId);
  if (!tab || pagePath.length === 0) return;
  app.setting.navigateToSearchResult({ tab, pagePath: [...pagePath] });
}

export function revealSetting(
  app: App,
  tabId: string,
  settingId: SettingDefinition["id"],
): void {
  app.setting.open();
  const tab = app.setting.openTabById(tabId);
  const hit = tab && locateSetting(tab.settingItems, settingId);
  if (!tab || !hit) {
    Effect.runSyncWith(logServices)(
      Effect.logDebug("A deep link named no row this tab renders").pipe(
        Effect.annotateLogs({
          tabId,
          settingId,
        }),
        withLogCategory("open-settings"),
      ),
    );
    return;
  }
  app.setting.navigateToSearchResult({ tab, pagePath: hit.pagePath });
  app.setting.scrollToDefinition(tab, hit.definition);
}

function locateSetting(
  items: SettingDefinitionItem[],
  settingId: SettingDefinition["id"],
  pagePath: string[] = [],
): { definition: SettingDefinition; pagePath: string[] } | null {
  for (const item of items) {
    if (!("type" in item)) {
      if (item.id === settingId) return { definition: item, pagePath };
      continue;
    }
    const nested = item.type === "page" ? [...pagePath, item.id] : pagePath;
    const hit = item.items && locateSetting(item.items, settingId, nested);
    if (hit) return hit;
  }
  return null;
}
