import type { TFile } from "obsidian";

import type { ChildNote, TemplateNoteLink } from "@zotlit/db";
import { zoteroNoteLink } from "@zotlit/db";
import type { MarkdownLinker } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";

export interface ChildNoteLinkDeps {
  importedNote: (noteKey: string) => TFile | undefined;
  link: MarkdownLinker;
}

export function childNoteLink(
  deps: ChildNoteLinkDeps,
  note: ChildNote,
  sourcePath: string,
): TemplateNoteLink {
  return {
    key: note.key,
    indexedKey: note.indexedKey,
    title: note.title,
    noteLink: (alias, subpath) => {
      const imported = deps.importedNote(note.indexedKey);
      if (imported)
        return deps.link(imported, sourcePath, {
          subpath,
          alias: alias ?? note.title ?? undefined,
        });
      return zoteroNoteLink(note, alias);
    },
  };
}
