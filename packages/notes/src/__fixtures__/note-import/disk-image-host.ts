import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FileSystemAdapter } from "obsidian";

import { createObsidianHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";

export function diskImageHost(vaultRoot: string) {
  const host = createObsidianHost();
  const createFolder = host.vault.createFolder.bind(host.vault);
  Object.assign(host.vault, {
    adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
      getFullPath: (path: string) => join(vaultRoot, path),
      reconcileInternalFile: async (path: string) => {
        if (!host.vault.getFileByPath(path)) host.vault.addFile(path, "");
      },
    }),
    createFolder: async (path: string) => {
      await mkdir(join(vaultRoot, path), { recursive: true });
      return createFolder(path);
    },
  });
  Object.assign(host.metadataCache, {
    getFirstLinkpathDest: (path: string) => host.vault.getFileByPath(path),
  });
  return host;
}
