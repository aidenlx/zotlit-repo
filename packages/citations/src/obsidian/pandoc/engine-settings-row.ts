// Install and uninstall controls for the device-wide Pandoc engine binary.

import type { SettingDefinition } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { managedBinaryDefinition } from "@zotlit/plugin-services/obsidian/managed-binary/settings-rows.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { PandocEngine } from "./service.ts";

/** The engine row, in the Pandoc engine's own words. */
export function pandocEngineDefinition(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  return managedBinaryDefinition(ctx.tab, PandocEngine, {
    id: "settings_citation_engine",
    name: m.settings_citation_engine_name(),
    desc: m.settings_citation_engine_desc(),
    status: {
      absent: m.settings_citation_engine_status_absent(),
      installing: m.settings_citation_engine_status_installing(),
      installed: (version) =>
        m.settings_citation_engine_status_installed({ version }),
      downloadFailed: (detail) =>
        m.settings_citation_engine_status_download_failed({ detail }),
      hashMismatch: m.settings_citation_engine_status_hash_mismatch(),
      initFailed: (detail) =>
        m.settings_citation_engine_status_init_failed({ detail }),
    },
    actions: {
      install: m.settings_citation_engine_install(),
      installing: m.settings_citation_engine_installing(),
      retry: m.settings_citation_engine_retry(),
      uninstall: m.settings_citation_engine_uninstall(),
    },
    notices: {
      downloading: m.notice_pandoc_engine_downloading(),
      installed: m.notice_pandoc_engine_installed(),
      installFailed: m.notice_pandoc_engine_install_failed(),
      removed: m.notice_pandoc_engine_removed(),
      removeFailed: m.notice_pandoc_engine_remove_failed(),
    },
  });
}

// The services this file's rows read, in the setting tab's context.
declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    PandocEngine: PandocEngine;
  }
}
