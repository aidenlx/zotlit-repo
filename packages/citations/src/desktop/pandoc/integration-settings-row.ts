import { Effect } from "effect";
import type { Setting, SettingDefinitionGroup } from "obsidian";

import { requireDialog } from "@zotlit/obsidian-desktop/require.ts";
import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import { docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import {
  pandocIntegrationFiles,
  renderPandocGuide,
  savePandocIntegrationFiles,
} from "./integration.ts";

export function pandocIntegrationDefinition(
  ctx: SettingTabContext,
): SettingDefinitionGroup<SettingsKey> {
  return {
    type: "group",
    id: "settings_citation_native_pandoc",
    heading: m.settings_citation_native_pandoc_heading(),
    items: [
      {
        id: "settings_citation_pandoc_tutorial",
        name: m.settings_citation_pandoc_tutorial_name(),
        desc: m.settings_citation_pandoc_tutorial_desc(),
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setButtonText(m.settings_citation_pandoc_tutorial_open())
              .onClick(() =>
                window.open(docsUrl("/docs/how-to/pandoc-citation-workflow")),
              ),
          );
        },
      },
      {
        id: "settings_citation_pandoc_files",
        name: m.settings_citation_pandoc_files_name(),
        desc: m.settings_citation_pandoc_files_desc(),
        render: (setting) => renderSaveAction(setting, ctx),
      },
      {
        id: "settings_citation_pandoc_guide",
        name: m.settings_citation_pandoc_guide_name(),
        desc: guideDescription(ctx.manifest.version),
      },
    ],
  };
}

function guideDescription(pluginVersion: string): DocumentFragment {
  return createFragment((fragment) => {
    fragment.append(m.settings_citation_pandoc_guide_desc());
    const guide = fragment.createEl("pre");
    guide.textContent = renderPandocGuide(pluginVersion);
  });
}

function renderSaveAction(setting: Setting, ctx: SettingTabContext): void {
  setting.addButton((button) =>
    button
      .setButtonText(m.settings_citation_pandoc_files_save())
      .setCta()
      .onClick(() => {
        button.buttonEl.blur();
        void selectAndSave(ctx);
      }),
  );
}

async function selectAndSave(ctx: SettingTabContext): Promise<void> {
  try {
    const selected = await requireDialog().showOpenDialog({
      title: m.settings_citation_pandoc_folder_title(),
      properties: ["openDirectory"],
    });
    if (selected.canceled || selected.filePaths.length === 0) return;

    await ctx.tab.run(
      Effect.gen(function* () {
        const result = yield* savePandocIntegrationFiles({
          folder: selected.filePaths[0]!,
          files: pandocIntegrationFiles(),
          confirmReplacement: (filenames) =>
            awaitConfirm(
              {
                title: m.settings_citation_pandoc_replace_title(),
                content: m.settings_citation_pandoc_replace_body({
                  files: filenames.join(", "),
                }),
                action: m.settings_citation_pandoc_replace_action(),
                destructive: true,
              },
              ctx.app,
            ),
        });

        if (result.kind === "saved") {
          new BaseNotice(
            m.notice_pandoc_integration_saved({ folder: result.folder }),
          );
        } else if (result.kind === "failed") {
          yield* Effect.logError(
            "Failed to save the Pandoc Integration Pair",
          ).pipe(
            Effect.annotateLogs({
              folder: selected.filePaths[0]!,
              error: result.error,
              restored: result.restored,
              backups: result.backups,
            }),
          );
          if (result.backups.length > 0) {
            new BaseNotice(
              BaseNotice.render((renderer) => {
                renderer
                  .setTitle(m.notice_pandoc_integration_restore_failed())
                  .addList(
                    m.notice_pandoc_integration_backups_kept(),
                    result.backups,
                  );
              }),
              0,
            );
          } else {
            new BaseNotice(
              result.restored
                ? m.notice_pandoc_integration_save_failed()
                : m.notice_pandoc_integration_restore_failed(),
            );
          }
        }
      }).pipe(withLogCategory("setting-tab", "pandoc-integration")),
    );
  } catch (error) {
    await ctx.tab.run(
      Effect.logError("Failed to select a Pandoc integration folder").pipe(
        Effect.annotateLogs({
          error,
        }),
        withLogCategory("setting-tab", "pandoc-integration"),
      ),
    );
    new BaseNotice(m.notice_pandoc_integration_save_failed());
  }
}
