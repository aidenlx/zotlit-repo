// Items for the "Attachments" sub-page: whether an attachment is imported,
// where in the vault it lands, and which external source folders are approved.

import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import type { SettingDefinitionItem } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { approvedFoldersPage } from "./approved-folders.ts";

import { PluginSettings } from "#obsidian/settings/service.ts";

export function attachmentPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      id: "settings_attachment_import",
      name: m.settings_attachment_import_name(),
      desc: m.settings_attachment_import_desc(),
      control: { type: "toggle", key: "attachment.import" },
    },
    {
      id: "settings_attachment_folder",
      name: m.settings_attachment_folder_name(),
      desc: m.settings_attachment_folder_desc(),
      visible: () =>
        ctx.tab.sync(PluginSettings.use((settings) => settings.current))[
          "attachment.import"
        ],
      // Empty value falls back to Obsidian's default attachment folder.
      control: {
        type: "folder",
        key: "attachment.folder-path",
        defaultValue: "",
      },
    },
    approvedFoldersPage(ctx),
  ];
}
