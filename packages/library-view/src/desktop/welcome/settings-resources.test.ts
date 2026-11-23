// @vitest-environment happy-dom
import { Context, Effect } from "effect";
import type { Setting as ObsidianSetting, SettingGroup } from "obsidian";
import { expect, it, onTestFinished, vi } from "vitest";

import {
  ButtonComponent,
  Setting,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import {
  PluginSettings,
  SettingsMutationError,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { resourcesGroup } from "./settings-resources.ts";

import { testSettingTab } from "#__fixtures__/setting-tab.ts";
import { defaults } from "#__fixtures__/settings.ts";
import { openWelcomeView } from "#desktop/library/welcome-register.ts";
import { Release } from "#obsidian/release/service.ts";

vi.mock("#desktop/library/welcome-register.ts", () => ({
  openWelcomeView: vi.fn(async () => {}),
}));

function renderResources(
  ctx: SettingTabContext,
  container = document.createElement("div"),
): Setting[] {
  return resourcesGroup(ctx).items!.flatMap((item) => {
    if (!("render" in item) || !item.render) return [];
    const row = document.createElement("div");
    container.append(row);
    const setting = Object.assign(new Setting(container), { settingEl: row });
    setting.setName(item.name ?? "");
    setting.setDesc(
      typeof item.desc === "string"
        ? item.desc
        : (item.desc?.textContent ?? ""),
    );
    item.render(
      setting as unknown as ObsidianSetting,
      stubService<SettingGroup>("SettingGroup", {}),
    );
    for (const component of setting.components) {
      if (!(component instanceof ButtonComponent)) continue;
      const button = document.createElement("button");
      button.textContent = component.text;
      button.addEventListener("click", () => component.click());
      component.buttonEl = button;
      row.append(button);
    }
    return [setting];
  });
}

function findButton(
  settings: Setting[],
  name: string,
): ButtonComponent | undefined {
  return settings
    .flatMap(({ components }) => components)
    .find(
      (component): component is ButtonComponent =>
        component instanceof ButtonComponent && component.text === name,
    );
}

function resourcesContext<S extends PluginSettings | Release>(
  services: Context.Context<S>,
) {
  return stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(
      services.pipe(
        Context.add(
          LanguagePack,
          stubService<LanguagePack["Service"]>("LanguagePack", {
            situation: Effect.succeed({
              kind: "active" as const,
              pack: { fileName: "en.json", origin: "https://example.com" },
            }),
            plugin: "ZotLit",
            endonym: "English",
          }),
        ),
      ),
    ).tab,
    app: stubService<SettingTabContext["app"]>("App", {}),
    manifest: stubService<SettingTabContext["manifest"]>("PluginManifest", {
      version: "2.3.0",
    }),
  });
}

it("opens conversion review from the pending reminder and removes it after acceptance", () => {
  let current = { ...defaults, "note.template-conversion-pending": true };
  const settings = stubService<PluginSettings["Service"]>("PluginSettings", {
    current: Effect.sync(() => current),
  });
  const ctx = resourcesContext(Context.make(PluginSettings, settings));
  const rendered = renderResources(ctx);
  expect(
    rendered.find(({ name }) => name === m.welcome_template_conversion_title())
      ?.desc,
  ).toBe(m.settings_template_conversion_reminder_desc());
  const label = m.settings_template_conversion_reminder_action();
  const review = findButton(rendered, label);
  expect(review).toBeDefined();
  review!.click();
  expect(openWelcomeView).toHaveBeenCalledWith(ctx.app);

  current = {
    ...defaults,
    "note.template-conversion-pending": false,
  };
  expect(findButton(renderResources(ctx), label)).toBeUndefined();
});

function mountMigrationReminder() {
  const save = Promise.withResolvers<void>();
  let current = { ...defaults, "release.migration-pending": true };
  const settings = stubService<PluginSettings["Service"]>("PluginSettings", {
    current: Effect.sync(() => current),
  });
  const release = stubService<Release["Service"]>("Release", {
    acknowledgeMigration: Effect.tryPromise({
      try: () => save.promise,
      catch: (cause) =>
        new SettingsMutationError({ message: "Save failed", cause }),
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          current = { ...current, "release.migration-pending": false };
        }),
      ),
    ),
  });
  const ctx = resourcesContext(
    Context.make(PluginSettings, settings).pipe(Context.add(Release, release)),
  );
  const run = vi.spyOn(ctx.tab, "run");
  const group = document.createElement("div");
  document.body.append(group);
  onTestFinished(() => group.remove());
  const rows = renderResources(ctx, group);
  const label = m.settings_migration_reminder_mark_done();
  const markDone = findButton(rows, label)!.buttonEl;
  const whatsNew = findButton(
    rows,
    m.settings_resources_whats_new_button(),
  )!.buttonEl;
  return { ctx, group, label, markDone, run, save, whatsNew };
}

it("keeps focus on Mark as done while the setting is pending", async () => {
  const { markDone, run, save } = mountMigrationReminder();
  markDone.focus();
  markDone.click();
  try {
    expect(document.activeElement).toBe(markDone);
  } finally {
    save.resolve();
    await run.mock.results[0]!.value;
  }
});

it("moves focus to What's new when the migration reminder is removed", async () => {
  const { ctx, group, label, markDone, run, save, whatsNew } =
    mountMigrationReminder();
  const reminder = markDone.parentElement!;
  markDone.focus();
  markDone.click();
  save.resolve();
  await run.mock.results[0]!.value;

  expect(findButton(renderResources(ctx), label)).toBeUndefined();
  reminder.remove();
  expect(whatsNew.parentElement?.parentElement).toBe(group);
  expect(document.activeElement).toBe(whatsNew);
});

it("keeps Mark as done focused for another attempt when the setting fails", async () => {
  const { ctx, label, markDone, run, save } = mountMigrationReminder();
  markDone.focus();
  markDone.click();
  save.reject(new Error("Save failed"));
  await run.mock.results[0]!.value;

  expect(findButton(renderResources(ctx), label)).toBeDefined();
  expect(document.activeElement).toBe(markDone);
});
