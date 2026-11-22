import type { WorkbenchDocumentKind } from "#core/document/index.ts";
import type { TFile } from "obsidian";

import {
  classifyTemplateFolderFile,
  inTemplateFolder,
} from "@zotlit/notes/core/template/defaults.ts";

export function templateDocumentKind(
  file: TFile | null,
  folder: string,
): WorkbenchDocumentKind {
  const path = file?.path ?? "";
  if (!inTemplateFolder(path, folder)) return "profile";
  const kind = classifyTemplateFolderFile(path)?.kind;
  return kind === "citation" || kind === "partial" ? kind : "profile";
}

export function templatePartialName(
  path: string,
  folder: string,
): string | null {
  if (!inTemplateFolder(path, folder)) return null;
  const classified = classifyTemplateFolderFile(path);
  return classified?.kind === "partial" ? classified.name : null;
}
