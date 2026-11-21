// Adapts Obsidian services to the shared side-effect-free resolver core.

import type { ExcerptImageContext } from "#core/template/inert-resolvers.ts";
import { normalizePath } from "obsidian";
import type { FileManager, TFile, Vault } from "obsidian";
import TurndownService from "turndown";

import type { NoteResolvers } from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import { fileUrlLink } from "@zotlit/obsidian-desktop/markdown-link.ts";
import { creatorSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import {
  commentToMarkdown,
  createCommentTurndown,
} from "@zotlit/plugin-kernel/turndown/comment.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import { attachmentFileLink } from "./annotation-render.ts";

import {
  buildInertNoteResolvers,
  findExistingLitNote,
} from "#core/template/inert-resolvers.ts";

export { findExistingLitNote };
export type { ExcerptImageContext };

export interface ObsidianInertNoteResolverDeps {
  noteIndex: {
    getNotesByItemKey(indexedKey: string): TFile[];
    getImportedNoteByNoteKey(noteKey: string): TFile[];
  };
  fileManager: Pick<FileManager, "generateMarkdownLink">;
  vault: Pick<Vault, "getFileByPath">;
  zoteroPref: Pick<ZoteroPrefSnapshot, "dataDir" | "baseAttachmentPath">;
  sourcePath: string;
  excerptImages: ExcerptImageContext;
}

export function buildObsidianInertNoteResolvers(
  deps: ObsidianInertNoteResolverDeps,
): NoteResolvers {
  const { dataDir, baseAttachmentPath } = deps.zoteroPref;
  let turndown: ReturnType<typeof createCommentTurndown> | null = null;

  return buildInertNoteResolvers<TFile>({
    noteIndex: deps.noteIndex,
    getFileByPath: (path) => deps.vault.getFileByPath(path),
    generateMarkdownLink: ({ file, sourcePath, subpath, alias }) =>
      deps.fileManager.generateMarkdownLink(file, sourcePath, subpath, alias),
    sourcePath: deps.sourcePath,
    excerptImages: deps.excerptImages,
    notImportedReason: m.template_data_explorer_not_imported,
    attachmentAbsPath: (attachment) =>
      attachmentAbsPath(attachment, { dataDir, baseAttachmentPath }),
    attachmentFileLink: (attachment, anchor) =>
      attachmentFileLink(attachment, { dataDir, baseAttachmentPath }, anchor),
    annotationCachePath: (annotation) =>
      resolveAnnotCachePath(annotation, {
        dataDir,
        groupID: annotation.groupID,
      }),
    commentToMarkdown: (html) => {
      turndown ??= createCommentTurndown(TurndownService);
      return commentToMarkdown(turndown, html);
    },
    authorsShort: creatorSummary,
    fileUrlLink,
    normalizeVaultPath: normalizePath,
  });
}
