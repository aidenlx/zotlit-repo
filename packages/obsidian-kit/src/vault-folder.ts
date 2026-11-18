// Folder creation over the Vault tag, for Effect code that writes into a folder.
import { Effect } from "effect";
import { TFile, TFolder } from "obsidian";

import { VaultFolderBlockedError } from "@zotlit/plugin-kernel/vault-errors.ts";
import { dirname } from "@zotlit/plugin-kernel/vault-path.ts";

import { normalizeFolderPath } from "#ensure-folder.ts";
import { Vault } from "#obsidian-vault.ts";

/**
 * Make sure the folder at the normalized vault path `path` exists: the vault
 * root and a folder already there, in any case, succeed; a file there fails
 * with {@link VaultFolderBlockedError}; and otherwise the folder is created.
 */
export const ensureVaultFolder = Effect.fnUntraced(function* (path: string) {
  if (path === "/") return;
  const vault = yield* Vault;
  const existing = yield* vault.getAbstractFileByPathInsensitive(path);
  if (existing instanceof TFolder) return;
  if (existing instanceof TFile)
    return yield* new VaultFolderBlockedError({ path });
  yield* vault.createFolder(path);
});

/**
 * Make sure the parent folder of the vault file path `filePath` exists, as
 * {@link ensureVaultFolder} does: `Vault.create` makes no missing parents.
 */
export const ensureVaultParentFolder = (filePath: string) =>
  ensureVaultFolder(normalizeFolderPath(dirname(filePath)));
