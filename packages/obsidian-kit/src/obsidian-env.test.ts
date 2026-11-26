import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { App, DataAdapter, Vault } from "obsidian";
import { afterEach, describe, expect } from "vitest";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { layerTestObsidianEnv } from "./__fixtures__/obsidian-env.ts";
import { layerObsidianEnv, ObsidianEnv } from "./obsidian-env.ts";

import { resetMockPlatform, setMockPlatform } from "#__mocks__/obsidian.ts";
import { ObsidianApp } from "#obsidian-app.ts";

afterEach(() => {
  resetMockPlatform();
});

describe("layerObsidianEnv", () => {
  it.effect(
    "reads the platform, version, language, vault name and app id once",
    () =>
      Effect.gen(function* () {
        setMockPlatform({ isMacOS: true, isWin: false, isDesktopApp: true });
        const app = stubService<App>("App", {
          appId: "0123456789abcdef",
          vault: stubService<Vault>("Vault", { getName: () => "Research" }),
        });
        const env = yield* ObsidianEnv.pipe(
          Effect.provide(
            layerObsidianEnv.pipe(
              Layer.provide(Layer.succeed(ObsidianApp, app)),
            ),
          ),
        );

        expect(env).toMatchObject({
          platform: { isMacOS: true, isWin: false, isDesktopApp: true },
          apiVersion: "1.0.0-test",
          language: "en",
          vaultName: "Research",
          appId: "0123456789abcdef",
        });
        resetMockPlatform();
        expect(env.platform.isMacOS).toBe(true);
      }),
  );
});

describe("layerObsidianEnv on Obsidian Mobile", () => {
  it.effect("reads no member of the vault adapter", () =>
    Effect.gen(function* () {
      setMockPlatform({
        isIosApp: true,
        isDesktopApp: false,
        isWin: false,
        isMacOS: false,
      });
      const app = stubService<App>("App", {
        appId: "0123456789abcdef",
        vault: stubService<Vault>("Vault", {
          getName: () => "Research",
          adapter: stubService<DataAdapter>("CapacitorAdapter", {}),
        }),
      });
      const env = yield* ObsidianEnv.pipe(
        Effect.provide(
          layerObsidianEnv.pipe(Layer.provide(Layer.succeed(ObsidianApp, app))),
        ),
      );

      expect(env).toMatchObject({ os: "ios", vaultName: "Research" });
    }),
  );
});

describe("ObsidianEnv.os", () => {
  it.effect.each([
    [{ isWin: true, isMacOS: false }, "win32"],
    [{ isWin: false, isMacOS: true }, "darwin"],
    [{ isWin: false, isMacOS: false }, "linux"],
    [{ isWin: false, isMacOS: true, isIosApp: true }, "ios"],
    [{ isWin: false, isMacOS: false, isAndroidApp: true }, "android"],
  ] as const)("names the operating system of %o as %s", ([flags, os]) =>
    Effect.gen(function* () {
      setMockPlatform({ ...flags, isDesktopApp: true });
      const app = stubService<App>("App", {
        appId: "0123456789abcdef",
        vault: stubService<Vault>("Vault", {
          getName: () => "Research",
        }),
      });
      const env = yield* ObsidianEnv.pipe(
        Effect.provide(
          layerObsidianEnv.pipe(Layer.provide(Layer.succeed(ObsidianApp, app))),
        ),
      );

      expect(env.os).toBe(os);
    }),
  );
});

describe("ObsidianEnv.corePluginEnabled", () => {
  it.effect("reads the enabled core plugins on each run", () =>
    Effect.gen(function* () {
      setMockPlatform({ isMacOS: true, isWin: false, isDesktopApp: true });
      const enabled = new Set(["graph"]);
      const app = stubService<App>("App", {
        appId: "0123456789abcdef",
        vault: stubService<Vault>("Vault", {
          getName: () => "Research",
        }),
        internalPlugins: {
          getEnabledPluginById: (id: string) => (enabled.has(id) ? {} : null),
        },
      });
      const env = yield* ObsidianEnv.pipe(
        Effect.provide(
          layerObsidianEnv.pipe(Layer.provide(Layer.succeed(ObsidianApp, app))),
        ),
      );

      expect(yield* env.corePluginEnabled("graph")).toBe(true);
      expect(yield* env.corePluginEnabled("canvas")).toBe(false);
      enabled.delete("graph");
      expect(yield* env.corePluginEnabled("graph")).toBe(false);
    }),
  );
});

describe("layerTestObsidianEnv", () => {
  it.effect("is a desktop app unless the test sets mobile", () =>
    Effect.gen(function* () {
      const desktop = yield* ObsidianEnv.pipe(
        Effect.provide(layerTestObsidianEnv()),
      );
      const mobile = yield* ObsidianEnv.pipe(
        Effect.provide(layerTestObsidianEnv({ mobile: true })),
      );

      expect(desktop.platform).toMatchObject({
        isDesktopApp: true,
        isMobileApp: false,
      });
      expect(mobile.platform).toMatchObject({
        isDesktopApp: false,
        isMobile: true,
        isMobileApp: true,
      });
    }),
  );
});
