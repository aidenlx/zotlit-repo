import type { Settings } from "#core/settings/schema.ts";
import type { SettingTabContext } from "#obsidian/setting-tab/context.ts";
// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Effect, Stream } from "effect";
import type { SettingDefinitionItem } from "obsidian";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { localServerItems } from "./settings-rows.ts";

import { platformDefaults } from "#__fixtures__/platform-settings.ts";
import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";
import { LocalServer } from "#core/local-server/service.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

interface Options {
  settings?: Partial<Settings>;
}

const setup = Effect.fnUntraced(function* ({ settings = {} }: Options = {}) {
  const current: Settings = { ...platformDefaults, ...settings };
  const services = Context.make(
    PluginSettings,
    stubService<PluginSettings["Service"]>("PluginSettings", {
      current: Effect.succeed(current),
    }),
  ).pipe(
    Context.add(
      LocalServer,
      stubService<LocalServer["Service"]>("LocalServer", {
        effectivePort: Effect.succeed(null),
        effectivePortChanges: Stream.empty,
      }),
    ),
  );
  // No feature fills the hosted-services slot here: the Template Workbench's
  // test covers the rows it gives.
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: (yield* scopedSettingTab(services)).tab,
    webWorkbenchEnabled: true,
    slot: () => [],
  });
  return localServerItems(ctx);
});

function visible(item: SettingDefinitionItem): boolean {
  return typeof item.visible === "function"
    ? item.visible()
    : (item.visible ?? true);
}

it.effect(
  "hides everything but the listener toggle while the server is off",
  () =>
    Effect.gen(function* () {
      const items = yield* setup({ settings: { "server.enabled": false } });

      const [listener, ...hosted] = items;
      expect(visible(listener!)).toBe(true);
      expect(hosted.map(visible)).toEqual(hosted.map(() => false));
    }),
);
