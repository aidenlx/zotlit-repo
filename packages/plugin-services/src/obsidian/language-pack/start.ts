import { Effect, Layer } from "effect";
import type { App, PluginManifest } from "obsidian";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { layerDeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { layerObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { runtimeServices } from "@zotlit/plugin-kernel/effect-services.ts";

import type { LanguagePackIdentity, LanguagePackStartup } from "./service.ts";
import { startLanguagePack } from "./service.ts";

export function startI18n(
  app: App,
  identity: LanguagePackIdentity,
  manifest: Pick<PluginManifest, "version" | "name">,
): LanguagePackStartup {
  return Effect.runSyncWith(runtimeServices)(
    startLanguagePack(identity, manifest.version, manifest.name).pipe(
      Effect.provide(Layer.merge(layerObsidianEnv, layerDeviceStorage)),
      Effect.provideService(ObsidianApp, app),
    ),
  );
}
