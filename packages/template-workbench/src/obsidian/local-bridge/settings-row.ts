// The Advanced page's Profile editing row: where a Profile opens for editing,
// in a build with the web workbench.
import type { SettingDefinitionItem } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import {
  profileCustomization,
  saveProfileCustomization,
} from "./preferences.ts";

export function workbenchPreferenceItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  if (!ctx.webWorkbenchEnabled) return [];
  return [
    {
      id: "template_workbench_preference",
      name: m.template_workbench_preference_name(),
      desc: m.template_workbench_preference_desc(),
      render: (setting) => {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOptions({
              ask: m.template_workbench_preference_ask(),
              web: m.template_workbench_preference_web(),
              native: m.template_workbench_name(),
            })
            .setValue(profileCustomization(ctx.app))
            .onChange((value) => {
              if (value === "ask" || value === "web" || value === "native")
                saveProfileCustomization(ctx.app, value);
            }),
        );
      },
    },
  ];
}
