import type { SettingDefinitionItem } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

export function updateNoticesItem(): SettingDefinitionItem<SettingsKey> {
  return {
    id: "settings_update_notices",
    name: m.settings_update_notices_name(),
    desc: m.settings_update_notices_desc(),
    control: { type: "toggle", key: "release.notices-enabled" },
  };
}
