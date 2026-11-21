import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
// The Advanced page's Local server group: the one loopback listener and the
// port it actually bound. The live update switch sits on the Zotero page
// beside the Companion it answers.
import { Effect, Stream } from "effect";
import type { SettingGroupItem } from "obsidian";

import { companionDocsUrl, docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { LocalServer } from "#core/local-server/service.ts";
import { serverSettings } from "#core/local-server/settings.ts";
import { paintEach } from "#obsidian/setting-tab/effect-tab.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

const currentSettings = PluginSettings.use((settings) => settings.current);

/**
 * The Local server rows: the listener toggle, the configured address, and the
 * port in use.
 */
export function localServerItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  const enabled = () => ctx.tab.sync(currentSettings)["server.enabled"];
  const port = ctx.tab.sync(LocalServer.use((server) => server.effectivePort));
  return [
    {
      id: "settings_local_server_enabled",
      name: m.settings_local_server_enabled_name(),
      desc: m.settings_local_server_enabled_desc(),
      control: { type: "toggle", key: "server.enabled" },
    },
    {
      id: "settings_live_updates_port",
      name: m.settings_live_updates_port_name(),
      desc: m.settings_live_updates_port_desc({
        label: m["zotero.prefs_notify_url"](),
      }),
      visible: enabled,
      control: {
        type: "number",
        key: "server.port",
        placeholder: String(serverSettings.defaults["server.port"]),
        min: 1024,
        max: 65535,
      },
    },
    {
      id: "settings_local_server_active_port",
      name: m.settings_local_server_active_port_name(),
      desc:
        port === null
          ? m.settings_local_server_active_port_none()
          : m.settings_local_server_active_port_desc({ port }),
      visible: enabled,
    },
    {
      id: "settings_live_updates_hostname",
      name: m.settings_live_updates_hostname_name(),
      desc: m.settings_live_updates_hostname_desc(),
      visible: enabled,
      control: {
        type: "text",
        key: "server.hostname",
        placeholder: serverSettings.defaults["server.hostname"],
      },
    },
  ];
}

/**
 * The Zotero page's Companion rows: the switch that answers the Companion, and
 * the local server it rides on. The server hosts more than live updates, so
 * its controls stay on the Advanced page; this row reports its state and links
 * there. Turning the server off keeps the live update choice as it is.
 */
export function liveUpdatesItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  return [
    {
      id: "settings_live_updates_enabled",
      name: m.settings_live_updates_enabled_name(),
      desc: liveUpdateDescription(),
      control: { type: "toggle", key: "server.live-update" },
    },
    {
      id: "settings_zotero_local_server",
      name: m.settings_advanced_local_server_heading(),
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText(m.settings_zotero_local_server_open())
            .onClick(() =>
              revealSetting(
                ctx.app,
                ctx.manifest.id,
                "settings_local_server_enabled",
              ),
            ),
        );
        // The server also turns on from the annotation view, and
        // a bind can fail while it stays on, so the state line follows both
        // the setting and the listener while the row is on screen.
        return ctx.tab.mount(
          Effect.gen(function* () {
            const server = yield* LocalServer;
            const settings = yield* PluginSettings;
            const state = Effect.all({
              port: server.effectivePort,
              enabled: Effect.map(
                settings.current,
                (current) => current["server.enabled"],
              ),
            });
            yield* paintEach(
              Stream.merge(
                settings.changes,
                Stream.drop(server.effectivePortChanges, 1),
              ).pipe(Stream.mapEffect(() => state)),
              ({ port, enabled }) => {
                const listening = port !== null;
                setting.setDesc(
                  listening
                    ? m.settings_zotero_local_server_on({ port })
                    : enabled
                      ? m.settings_zotero_local_server_not_listening()
                      : m.settings_zotero_local_server_off(),
                );
                setting.descEl.toggleClass("mod-warning", !listening);
              },
            );
          }),
        );
      },
    },
  ];
}

function liveUpdateDescription(): DocumentFragment {
  const frag = createFragment();
  frag.append(m.settings_live_updates_enabled_desc());

  const hint = createDiv({ cls: "zt:mt-2 zt:text-(--text-warning)" });
  hint.append(
    m.settings_live_updates_companion_desc({
      section: m["zotero.prefs_notify_section"](),
      label: m["zotero.prefs_notify_enable.label"](),
    }),
    " ",
    createEl("a", {
      href: companionDocsUrl(),
      text: m.settings_live_updates_companion_install(),
      attr: { target: "_blank", rel: "noopener" },
    }),
    " · ",
    createEl("a", {
      href: docsUrl("/docs/how-to/set-up-live-updates"),
      text: m.settings_live_updates_companion_setup(),
      attr: { target: "_blank", rel: "noopener" },
    }),
  );
  frag.append(hint);
  return frag;
}

declare module "#obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    LocalServer: LocalServer;
  }
}
