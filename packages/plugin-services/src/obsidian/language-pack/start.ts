// The Language Pack's edge outside Effect: its start in `onload`, ahead of
// the service graph.

import { Effect, Layer } from "effect";
import type { App, PluginManifest } from "obsidian";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { layerDeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { layerObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { runtimeServices } from "@zotlit/plugin-kernel/effect-services.ts";

import { startLanguagePack } from "./service.ts";
import type { LanguagePackIdentity, LanguagePackStartup } from "./service.ts";

/**
 * Apply the Language Pack before any copy shows: `onload`'s own notices (an
 * old installer, a service that failed to start) read `m.*` before the
 * service graph builds. Runs with the plugin's run services, as the graph does.
 *
 * @throws the storage failure that stops startup.
 */
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
