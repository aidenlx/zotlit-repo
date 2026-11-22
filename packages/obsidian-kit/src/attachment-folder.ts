import { Effect } from "effect";

import type { VaultError } from "@zotlit/plugin-kernel/vault-errors.ts";
import { dirname } from "@zotlit/plugin-kernel/vault-path.ts";

import { normalizeFolderPath } from "#ensure-folder.ts";
import { FileManager } from "#obsidian-file-manager.ts";

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
