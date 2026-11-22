import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import type { SettingDefinitionItem, SettingDefinitionPage } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { AttachmentImport } from "./service.ts";

import {
  appendDeviceOverrideNote,
  browseForDir,
} from "#desktop/setting-tab/device-override.ts";

export function approvedFoldersPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    id: "settings_attachment_approved",
    name: m.settings_attachment_approved_name(),
    desc: approvedFoldersDesc(),
    items: approvedFolderItems(ctx),
  };
}

function approvedFoldersDesc(): DocumentFragment {
  const desc = createFragment();
  desc.append(m.settings_attachment_approved_desc());
  appendDeviceOverrideNote(desc);
  return desc;
}

function approvedFoldersPolicy(): SettingDefinitionItem<SettingsKey> {
  return {
    id: "settings_attachment_approved_policy",
    name: m.settings_attachment_approved_policy_name(),
    desc: m.settings_attachment_approved_policy_desc(),
  };
}

function approvedFolderItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const folders = ctx.tab.sync(
    AttachmentImport.use((service) => service.approvedFolders),
  );
  return [
    approvedFoldersPolicy(),
    {
      id: "settings_attachment_approved_list",
      type: "list",
      emptyState: m.settings_attachment_approved_empty(),
      addItem: {
        name: m.settings_attachment_approved_add(),
        action: () => pickApprovedFolder(ctx),
      },
      onDelete: (index) => {
        const folder = folders[index];
        if (folder === undefined) return;
        void ctx.tab.run(
          AttachmentImport.use((service) => service.revokeFolder(folder)),
          m.settings_failed_revoke_folder(),
        );
      },
      items: folders.map((folder) => ({
        id: `settings_attachment_approved_entry:${folder}`,
        name: folder,
        searchable: false,
      })),
    },
  ];
}

function pickApprovedFolder(ctx: SettingTabContext): void {
  void browseForDir({
    title: m.settings_attachment_approved_dialog_title(),
    startPath: undefined,
    onPick: (folder) => {
      void ctx.tab.run(
        AttachmentImport.use((service) => service.approveFolder(folder)),
        m.settings_failed_approve_folder(),
      );
    },
  });
}

declare module "#obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    AttachmentImport: AttachmentImport;
  }
}
