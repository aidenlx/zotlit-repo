import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import { Effect } from "effect";
import type { SettingGroupItem } from "obsidian";

import { requireElectron } from "@zotlit/obsidian-desktop/require.ts";
import { LegacyPortError, portCall } from "@zotlit/obsidian-kit/legacy-port.ts";
import { reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { logFileDisabled, logPath } from "#obsidian/log/settings-rows.ts";

export function openLogFileItem(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_log_open_file",
    name: m.settings_log_open_file_name(),
    desc: m.settings_log_open_file_desc(),
    disabled: logFileDisabled(ctx),
    action: () => void ctx.tab.run(openLogFile(logPath(ctx))),
  };
}

export const openLogFileInSystem = Effect.fnUntraced(function* (path: string) {
  const fullPath = yield* (yield* Vault).fullPath(path);
  if (fullPath === null)
    return yield* Effect.die(new Error("The vault is not on disk"));
  const refused = yield* portCall("open-log-file", () =>
    requireElectron().shell.openPath(fullPath),
  );
  if (refused)
    return yield* new LegacyPortError({
      step: "open-log-file",
      cause: new Error(refused),
    });
});

const openLogFile = Effect.fn("SettingTab.openLogFile")(
  function* (path: string) {
    yield* reportOutcome(openLogFileInSystem(path), {
      success: () => undefined,
      error: () => m.notice_open_log_file_failed(),
    }).pipe(Effect.annotateLogs({ path }));
  },
  withLogCategory("setting-tab", "advanced"),
);
