import type {
  Setting,
  SettingDefinition,
  SettingDefinitionGroup,
} from "obsidian";

import { communityUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { toastLanguagePackInstall } from "@zotlit/plugin-services/obsidian/language-pack/notices.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { languagePackSettingCopy } from "@zotlit/plugin-services/obsidian/language-pack/setting-copy.ts";
import { languagePackDefinition } from "@zotlit/plugin-services/obsidian/language-pack/settings-row.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { openWelcomeView } from "#desktop/library/welcome-register.ts";
import { Release } from "#obsidian/release/service.ts";
import {
  BUG_REPORT,
  docsHomeUrl,
  migrationGuideUrl,
} from "#obsidian/welcome/links.ts";

export function migrationReminderItem(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  return {
    id: "settings_migration_reminder",
    name: m.settings_migration_reminder_name(),
    desc: m.welcome_migration_body(),
    render: (setting) => {
      renderMigrationReminderButtons(setting, ctx);
    },
  };
}

export function templateConversionReminderItem(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  return {
    id: "welcome_template_conversion",
    name: m.welcome_template_conversion_title(),
    desc: m.settings_template_conversion_reminder_desc(),
    render: (setting) => {
      setting.addButton((button) =>
        button
          .setButtonText(m.settings_template_conversion_reminder_action())
          .setCta()
          .onClick(() => void openWelcomeView(ctx.app)),
      );
    },
  };
}

function renderMigrationReminderButtons(
  setting: Setting,
  ctx: SettingTabContext,
): void {
  setting.addButton((btn) =>
    btn
      .setButtonText(m.welcome_action_open_migration_guide())
      .setCta()
      .onClick(() => window.open(migrationGuideUrl())),
  );
  setting.addButton((btn) =>
    btn.setButtonText(m.settings_migration_reminder_mark_done()).onClick(() => {
      btn.buttonEl.blur();
      void ctx.tab.run(
        Release.use((release) => release.acknowledgeMigration),
        m.settings_failed_migration_done(),
      );
    }),
  );
}

export function resourcesGroup(
  ctx: SettingTabContext,
): SettingDefinitionGroup<SettingsKey> {
  const current = ctx.tab.sync(
    PluginSettings.use((settings) => settings.current),
  );
  const pending = current["release.migration-pending"] === true;
  const templateConversionPending =
    current["note.template-conversion-pending"] === true;
  const pack = ctx.tab.sync(LanguagePack);
  const languagePack = languagePackSettingCopy({
    plugin: pack.plugin,
    endonym: pack.endonym,
    situation: ctx.tab.sync(pack.situation),
    install: () =>
      void ctx.tab.run(
        toastLanguagePackInstall,
        m.settings_failed_language_pack_install(),
      ),
  });
  return {
    type: "group",
    id: "settings_resources",
    items: [
      ...(pending ? [migrationReminderItem(ctx)] : []),
      ...(templateConversionPending
        ? [templateConversionReminderItem(ctx)]
        : []),
      ...(languagePack ? [languagePackDefinition(languagePack)] : []),
      ...resourcesItems(ctx),
    ],
  };
}

function resourcesItems(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey>[] {
  return [
    {
      id: "settings_resources_whats_new",
      name: m.settings_resources_whats_new_name({
        version: ctx.manifest.version,
      }),
      desc: m.settings_resources_whats_new_desc(),
      render: (setting) => {
        setting.addButton((btn) =>
          btn.setButtonText(m.settings_resources_whats_new_button()).onClick(
            () =>
              void ctx.tab.run(
                Release.use((release) => release.openReleaseNote),
                m.settings_failed_release_note(),
              ),
          ),
        );
      },
    },
    {
      id: "settings_resources_docs",
      name: m.settings_resources_docs_name(),
      desc: m.settings_resources_docs_desc(),
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(m.settings_resources_docs_button())
            .onClick(() => window.open(docsHomeUrl())),
        );
      },
    },
    {
      id: "settings_resources_help",
      name: m.settings_resources_help_name(),
      desc: m.settings_resources_help_desc(),
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(m.settings_resources_help_button())
            .onClick(() => window.open(communityUrl())),
        );
      },
    },
    {
      id: "settings_resources_bug_report",
      name: m.settings_resources_bug_report_name(),
      desc: m.settings_resources_bug_report_desc(),
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(m.settings_resources_bug_report_button())
            .onClick(() => window.open(BUG_REPORT)),
        );
      },
    },
  ];
}

declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    LanguagePack: LanguagePack;
    Release: Release;
  }
}
