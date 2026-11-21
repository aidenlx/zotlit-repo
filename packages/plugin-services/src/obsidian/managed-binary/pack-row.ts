// The settings row of one Managed Binary that ships in the Resource Pack: what
// the binary is, where it stands, and the way to the pack's page.

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

import type { PackBinaryApi, PackBinaryStatus } from "./pack-binary.ts";
import { openResourcePackPage } from "./pack-platform.ts";

import { paintEach } from "#obsidian/setting-tab/effect-tab.ts";

/** The binary's service as the row reads it: its tag, or a fake in a test. */
export type PackBinaryTag = Effect.Effect<
  Pick<PackBinaryApi<Disposable | AsyncDisposable>, "check" | "changes">,
  never,
  SettingTabEnv
>;

/** The words one binary's row carries, already in the user's language. */
export interface PackBinaryCopy {
  id: string;
  name: string;
  /** What the binary is; the status follows it. */
  desc: string;
  /** What the feature does without the binary; it follows each status but `ready`. */
  fallback: string;
  /**
   * The terms the pack redistributes the binary under, with a link to its
   * source code; shown between the description and the status.
   */
  licence?: { text: string; source: { text: string; url: string } };
}

/**
 * The binary row. It reads the pack each time it is shown, so the status is
 * that of the pack on disk, and shows each later status while it stays open.
 */
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

/** One sentence per arm, in the words of the step that mends it. */
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

/** The id of the plugin that reads the pack, as its manifest states it. */
export const packReaderId: Effect.Effect<string, never, PluginHost> =
  Effect.gen(function* () {
    return (yield* PluginHost).manifest.id;
  });

/**
 * Opens the page of the plugin that mends `status` in Obsidian's community
 * plugin browser: the plugin that reads the pack ({@link packReaderId}) when
 * the pack is newer than it reads, else the Resource Pack.
 */
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
  const statusEl = createDiv({ attr: { role: "status" } });
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
  /** The status the row shows; `null` until the first read ends. */
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
