// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer } from "effect";
import type { App } from "obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { featureServices } from "@zotlit/plugin-shell/obsidian/compose.ts";
import { makeGraphBuilt } from "@zotlit/plugin-shell/obsidian/graph-built.ts";

import { host } from "./host.ts";

const base = Layer.mergeAll(
  layerHost(),
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
  "builds the Reader's services from its features over the shell base, with the log settings at their defaults",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(featureServices(host.features, base));
      expect(context.mapUnsafe.has(FileSystem.FileSystem.key)).toBe(true);
      const settings = yield* Context.get(context, PluginSettings).current;
      expect(settings["log.to-file"]).toBe(false);
    }).pipe(Effect.scoped),
);
