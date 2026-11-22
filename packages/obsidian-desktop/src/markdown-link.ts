import { pathToFileURL } from "node:url";
import { TFile } from "obsidian";

import type { TemplateLink } from "@zotlit/db";

export function fileUrlLink(
  absPath: string,
  defaultAlias: string,
  defaultSubpath = "",
): TemplateLink {
  const href = pathToFileURL(absPath).href;
  return (alias = defaultAlias, subpath = defaultSubpath) =>
    `[${alias}](${href}${subpath})`;
}

export function syntheticFile(filePath: string): TFile {
  const slash = filePath.lastIndexOf("/");
  const name = slash === -1 ? filePath : filePath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0 && dot < name.length - 1;
  // oxlint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- builds a path-only stand-in, not a vault lookup
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    path: filePath,
    name,
    basename: hasExt ? name.slice(0, dot) : name,
    extension: hasExt ? name.slice(dot + 1).toLowerCase() : "",
  });
}
