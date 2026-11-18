// The Local server group's Web Template Workbench rows: the toggle that lets
// the web workbench reach the listener, and the live Workbench Connection
// under it.
import type { SettingGroupItem } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { serverEnabled } from "@zotlit/plugin-services/obsidian/local-server/settings-rows.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { LocalBridge } from "./service.ts";

/** The workbench rows, in a build with the web workbench. */
export function workbenchServerItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  if (!ctx.webWorkbenchEnabled) return [];
  const enabled = serverEnabled(ctx);
  return [
    {
      id: "settings_local_server_workbench",
      name: m.settings_local_server_workbench_name(),
      desc: m.settings_local_server_workbench_desc(),
      visible: enabled,
      control: {
        type: "toggle" as const,
        key: "server.workbench" as const,
      },
    },
    ...workbenchConnectionRows(ctx, enabled),
  ];
}

/**
 * The live Workbench Connection, named under the toggle that allows it: which
 * website holds it, which template it may save, and the one way to end it from
 * Obsidian. Included structurally — there is no row at all while none stands.
 */
function workbenchConnectionRows(
  ctx: SettingTabContext,
  enabled: () => boolean,
): SettingGroupItem<SettingsKey>[] {
  const connection = ctx.tab.sync(
    LocalBridge.use((bridge) => bridge.connection),
  );
  if (connection === null) return [];
  return [
    {
      id: "settings_local_server_workbench_connection",
      name: m.settings_local_server_workbench_connection_name(),
      desc: m.settings_local_server_workbench_connection_desc({
        website: new URL(connection.origin).host,
        profile: connection.profileName,
      }),
      visible: enabled,
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText(m.settings_local_server_workbench_disconnect())
            .onClick(
              () =>
                void ctx.tab.run(
                  LocalBridge.use((bridge) => bridge.disconnect),
                  m.settings_failed_workbench_disconnect(),
                ),
            ),
        );
      },
    },
  ];
}

declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    LocalBridge: LocalBridge;
  }
}
