import type { SettingsKey } from "#obsidian/setting-tab/context.ts";
import type {
  SettingTabEnv,
  SettingTabShape,
} from "#obsidian/setting-tab/effect-tab.ts";
import { Effect } from "effect";
import type { Setting, SettingDefinition } from "obsidian";

import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { showPluginPage } from "@zotlit/obsidian-kit/plugin-page.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";

import { openResourcePackPage } from "./pack-platform.ts";
import type { PackStatusApi } from "./pack-status.ts";

import { paintEach } from "#obsidian/setting-tab/effect-tab.ts";

export type PackBinaryTag = Effect.Effect<
  Pick<PackStatusApi, "check" | "changes">,
  never,
  SettingTabEnv
>;

export interface PackBinaryCopy {
  id: string;
  name: string;
  desc: string;
  fallback: string;
  licence?: { text: string; source: { text: string; url: string } };
}

export function packBinaryDefinition(
  tab: SettingTabShape,
  binary: PackBinaryTag,
  copy: PackBinaryCopy,
): SettingDefinition<SettingsKey> {
  return {
    id: copy.id,
    name: copy.name,
    desc: copy.desc,
    render: (setting) => renderStatus(setting, { tab, binary, copy }),
  };
}

export function packStatusSentence(status: PackBinaryStatus): string {
  switch (status.kind) {
    case "pack-absent":
      return m.settings_resource_pack_status_absent();
    case "pack-outdated":
      return m.settings_resource_pack_status_pack_outdated();
    case "plugin-outdated":
      return m.settings_resource_pack_status_plugin_outdated();
    case "pack-damaged":
      return m.settings_resource_pack_status_damaged();
    case "ready":
      return m.settings_resource_pack_status_ready({ version: status.version });
    case "failed":
      return m.settings_resource_pack_status_failed({ detail: status.detail });
  }
}

export const packReaderId: Effect.Effect<string, never, PluginHost> =
  Effect.gen(function* () {
    return (yield* PluginHost).manifest.id;
  });

export function openPackStatusPage(
  status: Pick<PackBinaryStatus, "kind"> | null,
  readerId: string,
): void {
  if (status?.kind === "plugin-outdated") window.open(showPluginPage(readerId));
  else openResourcePackPage();
}

function renderStatus(
  setting: Setting,
  {
    tab,
    binary,
    copy,
  }: { tab: SettingTabShape; binary: PackBinaryTag; copy: PackBinaryCopy },
): () => void {
  const statusEl = createDiv({
    attr: { role: "status" },
    text: m.settings_resource_pack_status_checking(),
  });
  const desc = createFragment();
  desc.append(copy.desc);
  if (copy.licence) {
    const { text, source } = copy.licence;
    const licenceEl = desc.createDiv();
    licenceEl.append(
      `${text} `,
      createEl("a", { text: source.text, href: source.url }),
    );
  }
  desc.append(statusEl);
  setting.setDesc(desc);
  let shown: PackBinaryStatus | null = null;
  setting.addButton((button) =>
    button.setButtonText(m.settings_resource_pack_open()).onClick(() => {
      openPackStatusPage(shown, tab.sync(packReaderId));
    }),
  );
  return tab.mount(
    Effect.gen(function* () {
      const api = yield* binary;
      yield* Effect.forkScoped(api.check);
      yield* paintEach(api.changes, (status) => {
        shown = status;
        statusEl.setText(
          status.kind === "ready"
            ? packStatusSentence(status)
            : `${packStatusSentence(status)} ${copy.fallback}`,
        );
      });
    }),
  );
}
