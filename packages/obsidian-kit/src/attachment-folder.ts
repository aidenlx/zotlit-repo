// The attachment folder a note's imports land in, read through the FileManager tag.
import { Effect } from "effect";

import type { VaultError } from "@zotlit/plugin-kernel/vault-errors.ts";
import { dirname } from "@zotlit/plugin-kernel/vault-path.ts";

import { normalizeFolderPath } from "#ensure-folder.ts";
import { FileManager } from "#obsidian-file-manager.ts";

/**
 * The normalized attachment folder path, read without touching the
 * filesystem: `folderPath`, or Obsidian's own attachment folder for the note
 * at `sourcePath` when the setting is empty. `"/"` names the vault root.
 */
export const attachmentFolderPath = (
  folderPath: string | null,
  sourcePath?: string,
): Effect.Effect<string, VaultError, FileManager> =>
  folderPath
    ? Effect.succeed(normalizeFolderPath(folderPath))
    : FileManager.use((fileManager) =>
        fileManager.getAvailablePathForAttachment(
          "zotlit-attachment",
          sourcePath,
        ),
      ).pipe(Effect.map((path) => normalizeFolderPath(dirname(path))));
