// Items for the "Reader" sub-page: what ZotLit does around Obsidian's own PDF
// reader once it puts a Zotero Attachment there.

import type { ReaderConnection } from "#obsidian/reader-connection/service.ts";
import { Effect, Stream } from "effect";
import type {
  ButtonComponent,
  Setting,
  SettingDefinitionItem,
  SettingGroupItem,
} from "obsidian";

import type { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import {
  readerStatusChanges,
  readerStatusCopy,
} from "#obsidian/reader-connection/status.ts";

export function readerStatusRow(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_reader_status",
    name: m.settings_reader_status_name(),
    render: (setting) => renderReaderStatus(setting, ctx),
  };
}

function renderReaderStatus(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const statusEl = createDiv({ attr: { role: "status" } });
  const desc = createFragment();
  desc.append(statusEl);
  setting.setDesc(desc);
  let actionButton: ButtonComponent | undefined;
  let actionUrl: string | null = null;
  setting.addButton((button) => {
    actionButton = button.setCta().onClick(() => {
      if (actionUrl) window.open(actionUrl);
    });
  });
  return ctx.tab.mount(
    Stream.unwrap(readerStatusChanges).pipe(
      Stream.runForEach((status) => {
        const copy = readerStatusCopy(status);
        statusEl.setText(copy.text);
        actionUrl = copy.action?.url ?? null;
        if (copy.action) actionButton?.setButtonText(copy.action.label);
        actionButton?.buttonEl.toggle(copy.action !== null);
        return Effect.void;
      }),
    ),
  );
}

export function readerPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    readerStatusRow(ctx),
    {
      id: "settings_reader_focus_annot_view",
      name: m.settings_reader_focus_annot_view_name(),
      desc: m.settings_reader_focus_annot_view_desc(),
      control: { type: "toggle", key: "reader.focus-annot-view" },
    },
    {
      id: "settings_reader_open_file_links",
      name: m.settings_reader_open_file_links_name(),
      desc: m.settings_reader_open_file_links_desc(),
      control: { type: "toggle", key: "reader.open-file-links" },
    },
    {
      id: "settings_reader_open_annotation_links",
      name: m.settings_reader_open_annotation_links_name(),
      desc: m.settings_reader_open_annotation_links_desc(),
      control: { type: "toggle", key: "reader.open-annotation-links" },
    },
  ];
}

declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    ReaderConnection: ReaderConnection;
    ObsidianApp: ObsidianApp;
  }
}
