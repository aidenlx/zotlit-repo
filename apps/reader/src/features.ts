import { FileSystem } from "effect";

import { layerVaultFileSystem } from "@zotlit/obsidian-kit/vault-file-system.ts";
import {
  defineFeature,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import { platformBase } from "@zotlit/plugin-shell/obsidian/platform-base.ts";
import { reader } from "@zotlit/reader-feature/obsidian/feature.ts";

const vaultFileSystem = defineFeature({
  name: "vault file system",
  services: [
    serviceGroup(
      "FileSystem",
      { provides: [FileSystem.FileSystem] },
      layerVaultFileSystem,
    ),
  ],
});

export const features = [platformBase, vaultFileSystem, reader] as const;
