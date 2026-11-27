import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { App, Vault } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import { expect, vi } from "vitest";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { layerVaultDisk } from "./vault-disk.ts";

it.effect(
  "gives the vault's folder and full paths on disk, and adds a file written to disk",
  () =>
    Effect.gen(function* () {
      const reconcileInternalFile = vi.fn(async (_path: string) => {});
      const app = stubService<App>("App", {
        vault: stubService<Vault>("Vault", {
          adapter: Object.assign(new FileSystemAdapter(), {
            getBasePath: () => "/Users/me/vault",
            getFullPath: (path: string) => `/Users/me/vault/${path}`,
            reconcileInternalFile,
          }),
        }),
      });
      const disk = yield* VaultDisk.pipe(
        Effect.provide(
          layerVaultDisk.pipe(Layer.provide(Layer.succeed(ObsidianApp, app))),
        ),
      );

      expect(disk.basePath).toBe("/Users/me/vault");
      expect(yield* disk.fullPath("Images/a.png")).toBe(
        "/Users/me/vault/Images/a.png",
      );
      yield* disk.reconcileFile("Images/a.png");
      expect(reconcileInternalFile).toHaveBeenCalledExactlyOnceWith(
        "Images/a.png",
      );
      const rejected = new Error("not a file");
      reconcileInternalFile.mockRejectedValueOnce(rejected);
      expect(yield* Effect.flip(disk.reconcileFile("b.png"))).toMatchObject({
        _tag: "VaultError",
        operation: "reconcileFile",
        path: "b.png",
        cause: rejected,
      });
    }),
);
