// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Context, Effect, Layer, Stream } from "effect";
import type { Plugin } from "obsidian";
import { expect } from "vitest";

import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import {
  layerLibrarySource,
  LIBRARY_SOURCE_KEY,
  WEB_API_KEY_SECRET_KEY,
} from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import { WEB_API_KEY_CONTROL } from "@zotlit/plugin-services/obsidian/library-source/settings-rows.ts";
import { ResourcePackPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ShellSettingTab } from "@zotlit/plugin-shell/obsidian/setting-tab/tab.ts";

import { features } from "@/features.ts";
import { host } from "@/host.ts";
import { settingsRuntimeOf } from "@/services/settings/__fixtures__.ts";

import { scopedSettingTab } from "./__fixtures__.ts";

it.effect(
  "control writes are readable once written and persist through the settings service",
  () =>
    Effect.gen(function* () {
      let disk: unknown;
      const { settings } = yield* settingsRuntimeOf({
        plugin: {
          loadData: async () => null,
          saveData: async (value) => {
            disk = value;
          },
        },
      });
      yield* settings.loaded;
      const { tab } = yield* scopedSettingTab(
        Context.make(PluginSettings, settings),
      );
      const settingTab = new ShellSettingTab(
        stubService<Plugin>("Plugin", {
          app: stubService("App", {}),
          manifest: stubService("PluginManifest", {}),
        }),
        stubService<Pick<SettingTabContext, "tab">>("SettingTabContext", {
          tab,
        }),
        { features, order: host.settingTab },
      );
      const write = (key: string, value: unknown) =>
        Effect.promise(() => settingTab.setControlValue(key, value));

      yield* write("citation.at-trigger", true);
      expect(settingTab.getControlValue("citation.at-trigger")).toBe(true);
      yield* write("template.auto-trim-leading", "keep");
      expect(settingTab.getControlValue("template.auto-trim-leading")).toBe(
        "keep",
      );
      yield* write("log.level", "off");
      expect(settingTab.getControlValue("log.level")).toBe("off");
      yield* write("note-profile:default:folder", "Research");
      expect(settingTab.getControlValue("note-profile:default:folder")).toBe(
        "Research",
      );
      yield* settings.flush;
      expect(disk).toMatchObject({
        __VERSION__: 11,
        "citation.at-trigger": true,
        "template.auto-trim-leading": false,
        "log.level": null,
        "note.default-profile": {
          bindings: { "note.literature-folder": "Research" },
        },
      });
    }),
);

it.effect(
  "keeps the name of the selected key secret on this device, and puts neither the name nor the key in the settings file",
  () =>
    Effect.gen(function* () {
      let disk: unknown;
      const { settings } = yield* settingsRuntimeOf({
        plugin: {
          loadData: async () => null,
          saveData: async (value) => {
            disk = value;
          },
        },
      });
      yield* settings.loaded;
      const key = "invented0key0for0tests00";
      const device = new MemoryDeviceStorage();
      device.saveLocalStorage(LIBRARY_SOURCE_KEY, "web-api");
      const source = yield* Layer.build(
        layerLibrarySource({
          startWeb: () => Effect.succeed({ kind: "pack-absent" }),
          poolDirectory: Effect.succeed("/zotlit/controls-test"),
          systemLanguage: Effect.succeed("en-US"),
          focused: Stream.make(true),
          secrets: {
            getSecret: (id) => (id === "zotero-reading-key" ? key : null),
          },
          removeStoredReplica: () => Effect.void,
          reload: Effect.void,
        }).pipe(
          Layer.provide([
            layerDeviceStorageFrom(device),
            Layer.succeed(PluginSettings, settings),
            Layer.mock(ResourcePackPlatform)({
              locate: Effect.succeed(null),
              changes: Stream.never,
            }),
            Layer.succeed(
              ObsidianEnv,
              stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
                language: "en",
              }),
            ),
          ]),
        ),
      );
      const { tab } = yield* scopedSettingTab(
        Context.make(PluginSettings, settings).pipe(Context.merge(source)),
      );
      const settingTab = new ShellSettingTab(
        stubService<Plugin>("Plugin", {
          app: stubService("App", {}),
          manifest: stubService("PluginManifest", {}),
        }),
        stubService<Pick<SettingTabContext, "tab">>("SettingTabContext", {
          tab,
        }),
        { features, order: host.settingTab },
      );

      yield* Effect.promise(() =>
        settingTab.setControlValue(WEB_API_KEY_CONTROL, "zotero-reading-key"),
      );
      expect(settingTab.getControlValue(WEB_API_KEY_CONTROL)).toBe(
        "zotero-reading-key",
      );
      expect(device.loadLocalStorage(WEB_API_KEY_SECRET_KEY)).toBe(
        "zotero-reading-key",
      );
      expect([...device.values.values()].join("\n")).not.toContain(key);
      yield* settings.update({ "zotero.language": "en-GB" });
      yield* settings.flush;
      const saved = JSON.stringify(disk);
      expect(saved).toContain('"zotero.language":"en-GB"');
      expect(saved).not.toContain("zotero-reading-key");
      expect(saved).not.toContain(key);
    }),
);
