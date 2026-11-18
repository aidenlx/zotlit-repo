// @vitest-environment happy-dom
import { Context, Effect } from "effect";
import type { Setting as ObsidianSetting, SettingGroup } from "obsidian";
import { expect, it, vi } from "vitest";

import {
  ButtonComponent,
  Setting,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { resourcesGroup } from "./settings-resources.ts";

import { testSettingTab } from "#__fixtures__/setting-tab.ts";
import { defaults } from "#__fixtures__/settings.ts";
import { openWelcomeView } from "#desktop/library/welcome-register.ts";

vi.mock("#desktop/library/welcome-register.ts", () => ({
  openWelcomeView: vi.fn(async () => {}),
}));

function renderResources(ctx: SettingTabContext): Setting[] {
  const container = document.createElement("div");
  return resourcesGroup(ctx).items!.flatMap((item) => {
    if (!("render" in item) || !item.render) return [];
    const setting = new Setting(container);
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
    return [setting];
  });
}

function reviewButton(settings: Setting[]): ButtonComponent | undefined {
  return settings
    .flatMap(({ components }) => components)
    .find(
      (component): component is ButtonComponent =>
        component instanceof ButtonComponent &&
        component.text === m.settings_template_conversion_reminder_action(),
    );
}

it("opens conversion review from the pending reminder and removes it after acceptance", () => {
  let current = { ...defaults, "note.template-conversion-pending": true };
  const settings = stubService<PluginSettings["Service"]>("PluginSettings", {
    current: Effect.sync(() => current),
  });
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(
      Context.make(PluginSettings, settings).pipe(
        Context.add(
          LanguagePack,
          stubService<LanguagePack["Service"]>("LanguagePack", {
            situation: Effect.succeed({
              kind: "active" as const,
              pack: { fileName: "en.json", origin: "https://example.com" },
            }),
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
  const rendered = renderResources(ctx);
  expect(
    rendered.find(({ name }) => name === m.welcome_template_conversion_title())
      ?.desc,
  ).toBe(m.settings_template_conversion_reminder_desc());
  const review = reviewButton(rendered);
  expect(review).toBeDefined();
  review!.click();
  expect(openWelcomeView).toHaveBeenCalledWith(ctx.app);

  current = {
    ...defaults,
    "note.template-conversion-pending": false,
  };
  expect(reviewButton(renderResources(ctx))).toBeUndefined();
});
