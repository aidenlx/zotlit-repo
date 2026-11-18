// The Language Pack's edge outside Effect: its start in `onload`, ahead of
// the service graph.

import { Effect, Layer } from "effect";
import type { App } from "obsidian";

import { runtimeServices } from "@/lib/effect-services.ts";
import { ObsidianApp } from "@/lib/obsidian-app.ts";
import { layerDeviceStorage } from "@/lib/obsidian-device-storage.ts";
import { layerObsidianEnv } from "@/lib/obsidian-env.ts";
import { startLanguagePack } from "@/services/language-pack/service.ts";
import type { LanguagePackStartup } from "@/services/language-pack/service.ts";

/**
 * Apply the Language Pack before any copy shows: `onload`'s own notices (an
 * old installer, a service that failed to start) read `m.*` before the
 * service graph builds. Runs with the plugin's run services, as the graph does.
 *
 * @throws the storage failure that stops startup.
 */
export function startI18n(
  app: App,
  pluginVersion: string,
): LanguagePackStartup {
  return Effect.runSyncWith(runtimeServices)(
    startLanguagePack(pluginVersion).pipe(
      Effect.provide(Layer.merge(layerObsidianEnv, layerDeviceStorage)),
      Effect.provideService(ObsidianApp, app),
    ),
  );
}
