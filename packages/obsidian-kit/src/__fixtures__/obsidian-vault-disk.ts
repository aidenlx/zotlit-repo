import { Effect, Layer } from "effect";

import { VaultDisk } from "#obsidian-vault-disk.ts";

export interface TestVaultDiskOptions {
  readonly basePath?: string;
}

export function testVaultDisk(
  options: TestVaultDiskOptions = {},
): VaultDisk["Service"] {
  const basePath = options.basePath ?? "/vault";
  return VaultDisk.of({
    basePath,
    fullPath: (path) => Effect.succeed(`${basePath}/${path}`),
    reconcileFile: () => Effect.void,
  });
}

export function layerTestVaultDisk(
  options?: TestVaultDiskOptions,
): Layer.Layer<VaultDisk> {
  return Layer.succeed(VaultDisk, testVaultDisk(options));
}
