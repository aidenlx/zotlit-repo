import type { Menu, Plugin, WorkspaceLeaf } from "obsidian";
import { TFile, TFolder } from "obsidian";

import {
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "#obsidian/note-index/parse.ts";

export interface FileMenuContext {
  file: TFile;
  source: string;
  leaf: WorkspaceLeaf | undefined;
  itemKey: string | null;
  noteKey: string | null;
}

export type FileMenuSegment = (menu: Menu, ctx: FileMenuContext) => void;

export interface FolderMenuContext {
  folder: TFolder;
  source: string;
}

export type FolderMenuSegment = (menu: Menu, ctx: FolderMenuContext) => void;

export function registerFileMenu(
  plugin: Pick<Plugin, "registerEvent" | "app">,
  segments: readonly FileMenuSegment[],
  folderSegments: readonly FolderMenuSegment[] = [],
): void {
  const { app } = plugin;
  plugin.registerEvent(
    // oxlint-disable-next-line max-params -- Obsidian's own `file-menu` shape.
    app.workspace.on("file-menu", (menu, file, source, leaf) => {
      if (file instanceof TFolder) {
        for (const segment of folderSegments)
          segment(menu, { folder: file, source });
        return;
      }
      if (!(file instanceof TFile)) return;
      const cache =
        file.extension === "md" ? app.metadataCache.getFileCache(file) : null;
      const ctx: FileMenuContext = {
        file,
        source,
        leaf,
        itemKey: itemKeyFromFrontmatter(cache),
        noteKey: noteKeyFromFrontmatter(cache),
      };
      for (const segment of segments) segment(menu, ctx);
    }),
  );
}
