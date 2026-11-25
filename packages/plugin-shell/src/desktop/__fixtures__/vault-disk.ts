import { Layer } from "effect";
import type { App, FileSystemAdapter, Vault } from "obsidian";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import type { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { layerVaultDisk } from "#desktop/vault-disk.ts";

export function layerVaultDiskOver(vault: {
  readonly adapter: object;
}): Layer.Layer<VaultDisk> {
  return layerVaultDisk.pipe(
    Layer.provide(
      Layer.succeed(
        ObsidianApp,
        stubService<App>("App", {
          vault: stubService<Vault>("Vault", {
            adapter: vault.adapter as FileSystemAdapter,
          }),
        }),
      ),
    ),
  );
}
