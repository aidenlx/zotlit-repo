import type { SettingsKey } from "#obsidian/setting-tab/context.ts";
import type { SettingDefinition } from "obsidian";

import type { LanguagePackSettingCopy } from "./setting-copy.ts";

export function languagePackDefinition(
  copy: LanguagePackSettingCopy,
): SettingDefinition<SettingsKey> {
  const { name, desc, install } = copy;
  if (install === undefined)
    return { id: "settings_language_pack", name, desc };

  return {
    id: "settings_language_pack",
    name,
    desc,
    render: (setting) => {
      setting.addButton((button) =>
        button
          .setButtonText(install.label)
          .setCta()
          .setDisabled(install.disabled)
          .onClick(() => install.run()),
      );
    },
  };
}
