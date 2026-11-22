import type { LogLevel } from "#core/log/settings.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import { Effect } from "effect";
import { strToU8, zipSync } from "fflate";
import type { SettingGroupItem } from "obsidian";

import { exportTimestamp, saveFile } from "@zotlit/obsidian-kit/file-save.ts";
import { reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { isLogLevel, LOG_LEVELS } from "#core/log/settings.ts";
import { LOG_FILENAME } from "#obsidian/log/service.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

declare module "#obsidian/setting-tab/context.ts" {
  interface SettingTabSlots {
    "advanced.log-file": unknown;
  }
}

const LOG_LEVEL_OFF_KEY = "off";

export const logPath = (ctx: SettingTabContext) =>
  `${ctx.manifest.dir}/${LOG_FILENAME}`;

export function logFileDisabled(ctx: SettingTabContext): () => boolean {
  return () =>
    !ctx.tab.sync(PluginSettings.use((settings) => settings.current))[
      "log.to-file"
    ];
}

export const LOG_LEVEL_KEY: SettingsKey = "log.level";

export function encodeLogLevel(value: unknown): string {
  const level = value as LogLevel | null;
  return level ?? LOG_LEVEL_OFF_KEY;
}

export function decodeLogLevel(value: unknown): LogLevel | null {
  const key = value as string;
  if (key === LOG_LEVEL_OFF_KEY) return null;
  if (isLogLevel(key)) return key;
  throw new Error(`Unknown log level dropdown key: ${key}`);
}

const LOG_LEVEL_OPTIONS: Record<string, string> = (() => {
  const opts: Record<string, string> = {
    [LOG_LEVEL_OFF_KEY]: m.settings_log_level_off(),
  };
  for (const level of LOG_LEVELS) opts[level] = level;
  return opts;
})();

export function loggingItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  return [
    {
      id: "settings_log_level",
      name: m.settings_log_level_name(),
      desc: m.settings_log_level_desc(),
      control: {
        type: "dropdown",
        key: "log.level",
        defaultValue: LOG_LEVEL_OFF_KEY,
        options: LOG_LEVEL_OPTIONS,
      },
    },
    {
      id: "settings_log_to_file",
      name: m.settings_log_to_file_name(),
      desc: m.settings_log_to_file_desc(),
      control: { type: "toggle", key: "log.to-file" },
    },
    ...(ctx.slot("advanced.log-file") as SettingGroupItem<SettingsKey>[]),
    {
      id: "settings_log_export",
      name: m.settings_log_export_name(),
      desc: m.settings_log_export_desc(),
      disabled: logFileDisabled(ctx),
      action: () => void ctx.tab.run(exportLogArchive(logPath(ctx))),
    },
  ];
}

export const saveLogArchive = Effect.fnUntraced(function* (path: string) {
  const text = yield* (yield* Vault).readPath(path);
  yield* Effect.sync(() => {
    const zipBytes = zipSync({ [LOG_FILENAME]: strToU8(text) });
    const blob = new Blob([zipBytes], {
      type: "application/zip",
    });
    saveFile(blob, `zotlit-logs-${exportTimestamp()}.zip`);
  });
});

const exportLogArchive = Effect.fn("SettingTab.exportLogArchive")(
  function* (path: string) {
    yield* reportOutcome(saveLogArchive(path), {
      success: () => undefined,
      error: () => m.notice_export_log_file_failed(),
    }).pipe(Effect.annotateLogs({ path }));
  },
  withLogCategory("setting-tab", "advanced"),
);
