import type { CachedMetadata, MetadataCache, TFile } from "obsidian";

import { itemKeyFromFrontmatter } from "./parse.ts";

export interface LiteratureNoteHost {
  readonly metadataCache: Pick<
    MetadataCache,
    "getCache" | "getFileCache" | "getFirstLinkpathDest"
  >;
}

export function isLiteratureNote(
  file: string | TFile,
  app: LiteratureNoteHost,
): boolean {
  const cache =
    typeof file === "string"
      ? app.metadataCache.getCache(file)
      : app.metadataCache.getFileCache(file);
  return itemKeyFromFrontmatter(cache) !== null;
}

export interface ResolvedLiteratureNote {
  path: string;
  indexedKey: string;
}

export function resolveLiteratureNote(
  linkpath: string,
  sourcePath: string,
  options: { app: LiteratureNoteHost },
): ResolvedLiteratureNote | null {
  const { app } = options;
  const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (!dest) return null;
  return literatureNoteOf(dest, app.metadataCache.getFileCache(dest));
}

export function literatureNoteOf(
  dest: TFile,
  cache: CachedMetadata | null,
): ResolvedLiteratureNote | null {
  const indexedKey = itemKeyFromFrontmatter(cache);
  if (indexedKey === null) return null;
  return {
    path: dest.path,
    indexedKey,
  };
}

export function resolveIndexedKey(
  linkpath: string,
  sourcePath: string,
  app: LiteratureNoteHost,
): string | null {
  const note = resolveLiteratureNote(linkpath, sourcePath, { app });
  return note?.indexedKey ?? null;
}
