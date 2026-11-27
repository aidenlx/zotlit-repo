import { it } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, Stream } from "effect";
import type { App, PluginManifest } from "obsidian";
import { Events } from "obsidian";
import { expect, vi } from "vitest";

import { MemoryVault } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { layerVaultFrom } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import {
  layerResourcePackPlatform,
  ResourcePackPlatform,
} from "./pack-platform.ts";

import { RESOURCE_PACK_ID } from "#core/managed-binary/resource-pack.ts";

it.effect.each(["app://vault/", "capacitor://localhost/_capacitor_file_/"])(
  "locates an installed pack under %s and reloads its manifest",
  (prefix) =>
    Effect.gen(function* () {
      const events = new Events();
      const manifests: Record<string, PluginManifest> = {};
      const plugins = stubService<App["plugins"]>("Plugins", {
        manifests,
        on: events.on.bind(events),
        offref: events.offref.bind(events),
      });
      const source = new MemoryVault();
      using resourcePath = vi
        .spyOn(source.adapter, "getResourcePath")
        .mockImplementation((path) => `${prefix}${path}?mtime=42`);
      const context = yield* Layer.build(
        layerResourcePackPlatform.pipe(
          Layer.provide(layerVaultFrom(source)),
          Layer.provide(
            Layer.succeed(ObsidianApp, stubService<App>("App", { plugins })),
          ),
        ),
      );
      const pack = Context.get(context, ResourcePackPlatform);
      expect(yield* pack.locate).toBeNull();

      const dir = ".obsidian/plugins/zotlit-resources";
      manifests[RESOURCE_PACK_ID] = stubService<PluginManifest>("Manifest", {
        dir,
        version: "1.0.0",
      });
      const changed = yield* Effect.forkChild(Stream.runHead(pack.changes), {
        startImmediately: true,
      });
      events.trigger("changed");
      yield* Fiber.join(changed);
      expect(yield* pack.locate).toEqual({
        version: "1.0.0",
        url: `${prefix}${dir}/main.js`,
      });
      expect(resourcePath).toHaveBeenCalledWith(`${dir}/main.js`);
    }),
);
