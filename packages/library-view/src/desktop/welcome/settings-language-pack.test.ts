// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Stream } from "effect";
import type { SettingDefinition } from "obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import {
  ButtonComponent,
  renderRow,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  fakeDevice,
  startOn,
} from "@zotlit/plugin-services/obsidian/language-pack/__fixtures__.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { resourcesGroup } from "./settings-resources.ts";

import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";
import { defaults } from "#__fixtures__/settings.ts";

/** The Language Pack row of the resources group, when it stands. */
const languagePackRow = (ctx: SettingTabContext) =>
  resourcesGroup(ctx).items?.find(
    (item): item is SettingDefinition<SettingsKey> =>
      "id" in item && item.id === "settings_language_pack",
  );

it.effect(
  "installs from the setting row, and the row then names the restart",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pack = yield* startOn(fakeDevice(), { language: "zh" });
        const services = (yield* Layer.build(testNotifier().layer)).pipe(
          Context.add(LanguagePack, pack),
          Context.add(
            PluginSettings,
            stubService<PluginSettings["Service"]>("PluginSettings", {
              current: Effect.succeed(defaults),
            }),
          ),
        );
        const ctx = stubService<SettingTabContext>("SettingTabContext", {
          tab: (yield* scopedSettingTab(services)).tab,
          manifest: stubService<SettingTabContext["manifest"]>(
            "PluginManifest",
            { version: "2.0.0" },
          ),
        });

        const row = languagePackRow(ctx);
        if (!row)
          throw new Error("Expected the Language Pack row to offer an install");
        const setting = renderRow(row);
        const install = setting.components.find(
          (control) => control instanceof ButtonComponent,
        );
        if (!(install instanceof ButtonComponent))
          throw new Error("No install button");
        install.click();

        yield* pack.changes.pipe(
          Stream.filter((situation) => situation.kind === "restart-pending"),
          Stream.runHead,
        );
        expect(languagePackRow(ctx)?.desc).toBe(
          m.notice_language_pack_restart(),
        );
      }),
    ),
);
