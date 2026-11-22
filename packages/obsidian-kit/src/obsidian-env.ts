import { Context, Effect, Layer } from "effect";
import { apiVersion, getLanguage, Platform } from "obsidian";
import type { FileSystemAdapter } from "obsidian";

import { ObsidianApp } from "#obsidian-app.ts";

export type ObsidianPlatform = Readonly<typeof Platform>;

export class ObsidianEnv extends Context.Service<
  ObsidianEnv,
  {
    readonly platform: ObsidianPlatform;
    readonly apiVersion: string;
    readonly language: string;
    readonly vaultName: string;
    readonly basePath: string;
    readonly appId: string;
    corePluginEnabled(id: string): Effect.Effect<boolean>;
  }
>()("zotlit/obsidian/ObsidianEnv") {}

export const layerObsidianEnv: Layer.Layer<ObsidianEnv, never, ObsidianApp> =
  Layer.effect(
    ObsidianEnv,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      return ObsidianEnv.of({
        platform: { ...Platform },
        apiVersion,
        language: getLanguage(),
        vaultName: app.vault.getName(),
        basePath: (app.vault.adapter as FileSystemAdapter).getBasePath(),
        appId: app.appId,
        corePluginEnabled: Effect.fn("ObsidianEnv.corePluginEnabled")((id) =>
          Effect.sync(() =>
            Boolean(app.internalPlugins.getEnabledPluginById(id)),
          ),
        ),
      });
    }),
  );
