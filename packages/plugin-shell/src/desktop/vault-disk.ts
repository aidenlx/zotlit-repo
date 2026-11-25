import { Effect, Layer } from "effect";
import type { FileSystemAdapter } from "obsidian";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { vaultError } from "@zotlit/plugin-kernel/vault-errors.ts";

export const layerVaultDisk: Layer.Layer<VaultDisk, never, ObsidianApp> =
  Layer.effect(
    VaultDisk,
    Effect.gen(function* () {
      const adapter = (yield* ObsidianApp).vault.adapter as FileSystemAdapter;
      return VaultDisk.of({
        basePath: adapter.getBasePath(),
        fullPath: Effect.fn("VaultDisk.fullPath")((path) =>
          Effect.sync(() => adapter.getFullPath(path)),
        ),
        reconcileFile: Effect.fn("VaultDisk.reconcileFile")((path) =>
          Effect.tryPromise({
            try: () => adapter.reconcileInternalFile(path),
            catch: vaultError("reconcileFile", path),
          }),
        ),
      });
    }),
  );
