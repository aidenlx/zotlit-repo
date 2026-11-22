import type { TFile } from "obsidian";

import {
  joinFolderPath,
  normalizeFolderPath,
} from "@zotlit/obsidian-kit/ensure-folder.ts";

import type { ResolvedProfile } from "./bindings.ts";

export function relocatedNotePath(
  file: Pick<TFile, "path" | "name">,
  options: {
    from: ResolvedProfile | undefined;
    to: ResolvedProfile;
    imported: boolean;
  },
): string {
  const key = options.imported
    ? "note.import-folder"
    : "note.literature-folder";
  const sourceFolder =
    options.from && normalizeFolderPath(options.from.bindings[key]);
  const remainder =
    sourceFolder === "/"
      ? file.path
      : sourceFolder && file.path.startsWith(`${sourceFolder}/`)
        ? file.path.slice(sourceFolder.length + 1)
        : file.name;
  return joinFolderPath(
    normalizeFolderPath(options.to.bindings[key]),
    remainder,
  );
}
