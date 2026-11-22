import type { Attachment } from "@zotlit/db";
import {
  attachmentAbsPath,
  isCaseInsensitivePlatform,
  normalizeAbsolutePath,
} from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { EXTERNAL_FILE_PREFIX } from "@zotlit/plugin-kernel/constants.ts";
import { isPdfAttachment } from "@zotlit/plugin-services/core/attachment-resolver/pdf-attachment.ts";

export interface ObsidianOpenableAttachment {
  indexedKey: string;
  label: string;
  openPath: string;
  absolutePath: string;
  subpath?: string;
}

export function filename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function vaultRelativePath(
  absolutePath: string,
  vaultBasePath: string,
  platform: NodeJS.Platform,
): string | null {
  const normalizedPath = normalizeAbsolutePath(absolutePath);
  const normalizedBase = normalizeAbsolutePath(vaultBasePath);
  const folds = isCaseInsensitivePlatform(platform);
  const foldedPath = folds ? normalizedPath.toLowerCase() : normalizedPath;
  const foldedBase = folds ? normalizedBase.toLowerCase() : normalizedBase;
  const prefix = `${foldedBase}/`;
  if (!foldedPath.startsWith(prefix)) return null;
  return normalizedPath.slice(prefix.length);
}

export function obsidianOpenPath(
  absolutePath: string,
  vaultBasePath: string,
  platform: NodeJS.Platform,
): string {
  const relative = vaultRelativePath(absolutePath, vaultBasePath, platform);
  return relative ?? EXTERNAL_FILE_PREFIX + normalizeAbsolutePath(absolutePath);
}

export function toObsidianOpenableAttachments(
  attachments: readonly Attachment[],
  ctx: {
    pathContext: AttachmentPathContext;
    vaultBasePath: string;
    platform: NodeJS.Platform;
  },
): ObsidianOpenableAttachment[] {
  const openable: ObsidianOpenableAttachment[] = [];
  for (const attachment of attachments) {
    const absolutePath = attachmentAbsPath(attachment, ctx.pathContext);
    if (absolutePath === null) continue;
    if (!isPdfAttachment(attachment.contentType, absolutePath)) continue;
    openable.push({
      indexedKey: attachment.indexedKey,
      label: filename(absolutePath),
      openPath: obsidianOpenPath(absolutePath, ctx.vaultBasePath, ctx.platform),
      absolutePath,
    });
  }
  return openable;
}
