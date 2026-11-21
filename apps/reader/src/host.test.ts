// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer } from "effect";
import type { App, SettingDefinitionItem } from "obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { MemoryVault } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import {
  fakeDevice,
  startOn,
} from "@zotlit/plugin-services/obsidian/language-pack/__fixtures__.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { featureServices } from "@zotlit/plugin-shell/obsidian/compose.ts";
import { makeGraphBuilt } from "@zotlit/plugin-shell/obsidian/graph-built.ts";
import {
  settingDefinitions,
  settingTabContext,
} from "@zotlit/plugin-shell/obsidian/setting-tab/tab.ts";
import * as m from "@zotlit/reader-messages/messages.ts";

import { host } from "./host.ts";

const vault = new MemoryVault();
vault.add("notes/a.md", "text");

const base = Layer.mergeAll(
  layerHost({ vault }),
  layerTestObsidianEnv(),
  testNotifier().layer,
  testPluginHost({ onViewCreated: () => Effect.succeed(false) }).layer,
  Layer.succeed(LanguagePack, stubService("LanguagePack", {})),
  makeGraphBuilt().layer,
  Layer.succeed(
    ObsidianApp,
    stubService<App>("App", {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    }),
  ),
  layerPluginSettings(
    { loadData: async () => null, saveData: async () => {} },
    host.settings,
  ),
);

it.effect(
  "builds the Reader's services from its features over the shell base, with the log settings at their defaults and the file system over the vault",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(featureServices(host.features, base));
      const fs = Context.get(context, FileSystem.FileSystem);
      expect(yield* fs.readFileString("notes/a.md")).toBe("text");
      expect(yield* fs.exists("notes/a.md")).toBe(true);
      expect(yield* fs.exists("notes/b.md")).toBe(false);
      const missing = yield* Effect.flip(fs.readFileString("notes/b.md"));
      expect(missing.reason._tag).toBe("NotFound");
      const settings = yield* Context.get(context, PluginSettings).current;
      expect(settings["log.to-file"]).toBe(false);
    }).pipe(Effect.scoped),
);

function pageNames(items: readonly SettingDefinitionItem[]): string[] {
  return items.flatMap((item) => [
    ...("name" in item && typeof item.name === "string" ? [item.name] : []),
    ...("heading" in item && typeof item.heading === "string"
      ? [item.heading]
      : []),
    ...("type" in item && item.items ? pageNames(item.items) : []),
  ]);
}

it("shows the Reader page, then the Advanced page with the log rows and the Language Pack reset", () => {
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: stubService<SettingTabContext["tab"]>("SettingTab", {}),
    app: stubService<App>("App", {}),
    manifest: stubService<SettingTabContext["manifest"]>("PluginManifest", {
      dir: "plugins/zotlit-reader",
    }),
  });
  const tree = settingDefinitions(
    settingTabContext(ctx, ctx, host.features),
    host.features,
    host.settingTab,
  );
  expect(pageNames(tree)).toEqual([
    m.reader_settings_page(),
    m.reader_settings_open_all_pdfs_name(),
    m.settings_page_advanced(),
    m.settings_advanced_logging_heading(),
    m.settings_log_level_name(),
    m.settings_log_to_file_name(),
    m.settings_log_export_name(),
    m.settings_advanced_recovery_heading(),
    m.settings_language_pack_reset_name(),
  ]);
});

it.effect(
  "downloads the Reader's Language Packs from its own Resource Release and keeps them under its own namespace",
  () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      const pack = yield* startOn(device, {
        language: "zh",
        pluginVersion: "0.1.0",
        identity: host.languagePack,
      });

      yield* pack.install;

      expect(device.requests).toEqual([
        "https://github.com/aidenlx/zotlit-reader/releases/download/res-0.1.0/zh-CN.json",
      ]);
      expect([...device.storage.keys()].sort()).toEqual([
        "zotlit-reader:i18n:consent:zh-CN",
        "zotlit-reader:i18n:pack:0.1.0:zh-CN",
      ]);
    }),
);
