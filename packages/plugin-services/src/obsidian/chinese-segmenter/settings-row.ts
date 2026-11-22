import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import type { SettingDefinition } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { ChineseSegmenter } from "./service.ts";

import { packBinaryDefinition } from "#obsidian/managed-binary/pack-row.ts";

export function chineseSegmenterDefinition(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  return packBinaryDefinition(ctx.tab, ChineseSegmenter, {
    id: "settings_chinese_segmenter",
    name: m.settings_chinese_segmenter_name(),
    desc: m.settings_chinese_segmenter_desc(),
    fallback: m.settings_chinese_segmenter_fallback(),
  });
}

declare module "#obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    ChineseSegmenter: ChineseSegmenter;
  }
}
