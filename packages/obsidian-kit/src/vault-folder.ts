import { Effect } from "effect";
import { TFile, TFolder } from "obsidian";

import { VaultFolderBlockedError } from "@zotlit/plugin-kernel/vault-errors.ts";
import { dirname } from "@zotlit/plugin-kernel/vault-path.ts";

import { normalizeFolderPath } from "#ensure-folder.ts";
import { Vault } from "#obsidian-vault.ts";

export const ensureVaultFolder = Effect.fnUntraced(function* (path: string) {
  if (path === "/") return;
  const vault = yield* Vault;
  const existing = yield* vault.getAbstractFileByPathInsensitive(path);
  if (existing instanceof TFolder) return;
  if (existing instanceof TFile)
    return yield* new VaultFolderBlockedError({ path });
  yield* vault.createFolder(path);
});

export const ensureVaultParentFolder = (filePath: string) =>
  ensureVaultFolder(normalizeFolderPath(dirname(filePath)));
