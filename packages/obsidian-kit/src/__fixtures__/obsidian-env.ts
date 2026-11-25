import { Effect, Layer } from "effect";
import { ObsidianEnv, osOf } from "#obsidian-env.ts";
import type { ObsidianPlatform } from "#obsidian-env.ts";
import type { OperatingSystem } from "@zotlit/shared/platform";

export interface TestObsidianEnvOptions {
  readonly mobile?: boolean;
  readonly platform?: Partial<ObsidianPlatform>;
  readonly os?: OperatingSystem;
  readonly apiVersion?: string;
  readonly language?: string;
  readonly vaultName?: string;
  readonly appId?: string;
  readonly corePlugins?: ReadonlySet<string>;
}

export function testObsidianEnv(
  options: TestObsidianEnvOptions = {},
): ObsidianEnv["Service"] {
  const mobile = options.mobile ?? false;
  return ObsidianEnv.of({
    platform: {
      isDesktop: !mobile,
      isMobile: mobile,
      isDesktopApp: !mobile,
      isMobileApp: mobile,
      isIosApp: false,
      isAndroidApp: mobile,
      isPhone: mobile,
      isTablet: false,
      isMacOS: false,
      isWin: false,
      isLinux: !mobile,
      isSafari: false,
      resourcePathPrefix: mobile ? "file:///" : "app://test/",
      ...options.platform,
    },
    os:
      options.os ?? osOf({
        isWin: false,
        isMacOS: false,
        isIosApp: false,
        isAndroidApp: mobile,
        ...options.platform,
      }),
    apiVersion: options.apiVersion ?? "1.0.0-test",
    language: options.language ?? "en",
    vaultName: options.vaultName ?? "Vault",
    appId: options.appId ?? "test-app-id",
    corePluginEnabled: (id) =>
      Effect.sync(() => options.corePlugins?.has(id) ?? false),
  });
}

export function layerTestObsidianEnv(
  options?: TestObsidianEnvOptions,
): Layer.Layer<ObsidianEnv> {
  return Layer.succeed(ObsidianEnv, testObsidianEnv(options));
}
