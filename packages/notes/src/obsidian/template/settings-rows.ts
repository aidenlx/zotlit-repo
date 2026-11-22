import { Effect } from "effect";
import type {
  SettingControl,
  SettingDefinition,
  SettingDefinitionGroup,
  Setting,
  SettingGroupItem,
} from "obsidian";

import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { SettingTab } from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";
import type { AutoTrim } from "@zotlit/templates/constants";

import { reportCitationTemplateOpen } from "./actions.ts";
import { appendCompileError } from "./compile-error.ts";
import { Template } from "./service.ts";
import type { TemplateWorkbenchLauncher } from "./workbench-launcher.ts";

import { templateSettings } from "#core/template/settings.ts";

const TRIM_KEEP = "keep";

export type AutoTrimKey =
  | "template.auto-trim-leading"
  | "template.auto-trim-trailing";

export const AUTO_TRIM_KEYS: ReadonlySet<SettingsKey> = new Set<AutoTrimKey>([
  "template.auto-trim-leading",
  "template.auto-trim-trailing",
]);

export function encodeAutoTrim(value: unknown): string {
  return value === "nl" || value === "slurp" ? value : TRIM_KEEP;
}

export function decodeAutoTrim(value: unknown): AutoTrim {
  return value === "nl" || value === "slurp" ? value : false;
}

const rebuild = SettingTab.use((tab) => tab.update);

function javascriptTemplatesEnabled(ctx: SettingTabContext): () => boolean {
  return () =>
    ctx.tab.sync(
      Template.use((template) => template.javascriptTemplatesEnabled),
    );
}

export function templateEngineGroup(
  ctx: SettingTabContext,
): SettingDefinitionGroup<SettingsKey> {
  return {
    type: "group",
    id: "settings_advanced_template_engine",
    heading: m.settings_advanced_template_engine_heading(),
    items: templateEngineItems(ctx),
  };
}

function templateEngineItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  return [
    {
      id: "settings_template_folder",
      name: m.settings_template_folder_name(),
      desc: m.settings_template_folder_desc(),
      control: {
        type: "folder",
        key: "template.folder",
        placeholder: templateSettings.defaults["template.folder"],
      },
    },
    {
      id: "settings_template_js_enable",
      name: m.settings_template_js_enable_name(),
      desc: m.settings_template_js_enable_desc(),
      render: (setting) => renderJsTemplatesButton(setting, ctx),
    },
    {
      id: "settings_template_trim_leading",
      name: m.settings_template_trim_leading_name(),
      desc: m.settings_template_trim_desc(),
      visible: javascriptTemplatesEnabled(ctx),
      control: trimControl("template.auto-trim-leading"),
    },
    {
      id: "settings_template_trim_trailing",
      name: m.settings_template_trim_trailing_name(),
      desc: m.settings_template_trim_desc(),
      visible: javascriptTemplatesEnabled(ctx),
      control: trimControl("template.auto-trim-trailing"),
    },
    ...unrecognizedFileItems(ctx),
  ];
}

function unrecognizedFileItems(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey>[] {
  const files = ctx.tab.sync(
    Effect.gen(function* () {
      const template = yield* Template;
      return (yield* template.loaded)
        ? yield* template.getUnrecognizedFiles
        : [];
    }),
  );
  return files.map((path) => ({
    id: `settings_template_unrecognized:${path}`,
    name: m.settings_template_unrecognized_name(),
    desc: m.settings_template_unrecognized_desc({ path }),
    searchable: false,
  }));
}

export function citationTextItems(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey>[] {
  if (!ctx.tab.sync(Template.use((template) => template.loaded))) return [];
  return [
    {
      id: "settings_citation_text",
      name: m.settings_citation_text_name(),
      desc: m.settings_citation_text_desc(),
      render: (setting) => renderCitationTextRow(setting, ctx),
    },
  ];
}

function renderCitationTextRow(setting: Setting, ctx: SettingTabContext): void {
  const status = ctx.tab.sync(
    Template.use((template) => template.getCitationTemplateStatus),
  );

  const desc = createFragment();
  desc.append(m.settings_citation_text_desc());
  desc.append(createEl("br"));
  if (status.customized) {
    const code = createEl("code");
    code.textContent = status.path;
    desc.append(code);
  } else {
    desc.append(m.settings_template_using_default());
  }
  if (status.inertPath) {
    const inert = createDiv();
    inert.className = "zt:mt-2 zt:text-(--text-warning)";
    inert.textContent = m.settings_template_inert_eta({
      path: status.inertPath,
    });
    desc.append(inert);
  }
  if (status.compileError) {
    appendCompileError(
      desc,
      status.compileError,
      m.settings_template_compile_error(),
    );
  }
  setting.setDesc(desc);

  setting.addButton((btn) =>
    btn
      .setIcon("pencil")
      .setTooltip(m.settings_citation_text_open())
      .onClick(() => {
        btn.buttonEl.blur();
        void ctx.tab.run(
          reportCitationTemplateOpen().pipe(Effect.ensuring(rebuild)),
        );
      }),
  );

  if (!status.customized) return;
  setting.addButton((btn) =>
    btn
      .setIcon("rotate-ccw")
      .setTooltip(m.settings_template_reset())
      .setDestructive()
      .onClick(() => {
        btn.buttonEl.blur();
        void ctx.tab.run(
          resetCitationText(ctx, status.path),
          m.settings_failed_citation_text_reset(),
        );
      }),
  );
}

function resetCitationText(ctx: SettingTabContext, path: string) {
  return Effect.gen(function* () {
    const confirmed = yield* awaitConfirm(
      {
        title: m.settings_citation_text_reset_confirm_title(),
        content: m.settings_citation_text_reset_confirm_body({ path }),
        action: m.settings_template_reset(),
        destructive: true,
      },
      ctx.app,
    );
    if (!confirmed) return;
    yield* (yield* Template).restoreCitationTemplate;
    yield* (yield* Notifier).show(m.notice_citation_text_reset());
  }).pipe(Effect.ensuring(rebuild));
}

function trimControl(key: AutoTrimKey): SettingControl<SettingsKey> {
  return {
    type: "dropdown",
    key,
    defaultValue: TRIM_KEEP,
    options: {
      [TRIM_KEEP]: m.settings_template_trim_disable(),
      nl: m.settings_template_trim_nl(),
      slurp: m.settings_template_trim_slurp(),
    },
  };
}

function renderJsTemplatesButton(
  setting: Setting,
  ctx: SettingTabContext,
): void {
  const enabled = javascriptTemplatesEnabled(ctx)();
  setting.addButton((btn) => {
    if (enabled) {
      btn.setButtonText(m.settings_template_js_turn_off());
    } else {
      btn.setButtonText(m.settings_template_js_turn_on()).setWarning();
    }
    btn.onClick(() => {
      btn.buttonEl.blur();
      void ctx.tab.run(
        applyJsTemplatesFlag(ctx, !enabled).pipe(Effect.ensuring(rebuild)),
        m.settings_failed_js_templates(),
      );
    });
  });
}

function applyJsTemplatesFlag(ctx: SettingTabContext, enabled: boolean) {
  return Effect.gen(function* () {
    const template = yield* Template;
    if (!enabled) return yield* template.setJavascriptTemplatesEnabled(false);
    const confirmed = yield* awaitConfirm(
      {
        title: m.settings_template_js_confirm_title(),
        content: m.settings_template_js_confirm_body(),
        action: m.settings_template_js_confirm_action(),
        cta: true,
      },
      ctx.app,
    );
    if (confirmed) yield* template.setJavascriptTemplatesEnabled(true);
  });
}

declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    Template: Template;
    TemplateWorkbenchLauncher: TemplateWorkbenchLauncher;
  }
}
