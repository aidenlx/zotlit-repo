import { Context, Effect, Layer } from "effect";
import { apiVersion, getLanguage, Platform } from "obsidian";

import type { OperatingSystem } from "@zotlit/shared/platform";

import { ObsidianApp } from "#obsidian-app.ts";

export type ObsidianPlatform = Readonly<typeof Platform>;

export class ObsidianEnv extends Context.Service<
  ObsidianEnv,
  {
    readonly platform: ObsidianPlatform;
    readonly os: OperatingSystem;
    readonly apiVersion: string;
    readonly language: string;
    readonly vaultName: string;
    readonly appId: string;
    corePluginEnabled(id: string): Effect.Effect<boolean>;
  }
>()("zotlit/obsidian/ObsidianEnv") {}

export function osOf(
  platform: Pick<
    ObsidianPlatform,
    "isWin" | "isMacOS" | "isIosApp" | "isAndroidApp"
  >,
): OperatingSystem {
  if (platform.isIosApp) return "ios";
  if (platform.isAndroidApp) return "android";
  if (platform.isWin) return "win32";
  if (platform.isMacOS) return "darwin";
  return "linux";
}

export const layerObsidianEnv: Layer.Layer<ObsidianEnv, never, ObsidianApp> =
  Layer.effect(
    ObsidianEnv,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      return ObsidianEnv.of({
        platform: { ...Platform },
        os: osOf(Platform),
        apiVersion,
        language: getLanguage(),
        vaultName: app.vault.getName(),
        appId: app.appId,
        corePluginEnabled: Effect.fn("ObsidianEnv.corePluginEnabled")((id) =>
          Effect.sync(() =>
            Boolean(app.internalPlugins.getEnabledPluginById(id)),
          ),
        ),
      });
    }),
  );
