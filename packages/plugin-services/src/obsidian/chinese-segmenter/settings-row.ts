// The settings row of the Chinese Segmenter: its status in the Resource Pack.

import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import type { SettingDefinition } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { ChineseSegmenter } from "./service.ts";

import { packBinaryDefinition } from "#obsidian/managed-binary/pack-row.ts";

/** The segmenter row, in the Chinese Segmenter's own words. */
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

// The services this file's rows read, in the setting tab's context.
declare module "#obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    ChineseSegmenter: ChineseSegmenter;
  }
}
