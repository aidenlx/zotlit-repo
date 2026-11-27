import type { Workspace } from "obsidian";
import { Menu } from "obsidian";

import {
  menuEvent,
  menuSections,
  raiseMenu,
} from "@zotlit/obsidian-kit/menu-events.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { LiteratureNotes } from "@zotlit/query-views/desktop/query-view/table-notes.ts";

import type { ItemActions } from "./item-actions.ts";

const itemMenu = menuEvent("zotlit:item-menu", [
  "open",
  "insert",
  "clipboard",
  "zotero",
  "",
]);

const SECTION = menuSections(itemMenu);

export interface RowMenuDeps {
  actions: ItemActions;
  literatureNotes: Pick<LiteratureNotes, "find">;
  workspace: Pick<Workspace, "trigger">;
}

export interface MenuItem {
  readonly indexedKey: string;
  readonly pdf: boolean;
}

export function rowMenu(
  deps: RowMenuDeps,
  { indexedKey, pdf }: MenuItem,
): Menu {
  const { actions } = deps;
  const menu = new Menu();
  if (pdf) {
    menu.addItem((item) =>
      item
        .setSection(SECTION.open)
        .setTitle(m.library_view_menu_open_pdf())
        .setIcon("file-text")
        .onClick(() => actions.openPdf(indexedKey, false)),
    );
    menu.addItem((item) =>
      item
        .setSection(SECTION.open)
        .setTitle(m.library_view_menu_open_pdf_right())
        .setIcon("separator-vertical")
        .onClick(() => actions.openPdf(indexedKey, "split")),
    );
  }
  const note = deps.literatureNotes.find(indexedKey);
  menu.addItem((item) =>
    item
      .setSection(SECTION.open)
      .setTitle(
        note
          ? m.library_view_menu_open_note()
          : m.library_view_menu_write_note(),
      )
      .setIcon(note ? "notebook-pen" : "file-plus")
      .onClick(() => actions.openNote(indexedKey, false)),
  );
  menu.addItem((item) =>
    item
      .setSection(SECTION.insert)
      .setTitle(m.library_view_menu_insert_citation())
      .setIcon("quote")
      .onClick(() => actions.insertCitation(indexedKey)),
  );
  menu.addItem((item) =>
    item
      .setSection(SECTION.clipboard)
      .setTitle(m.graph_citations_menu_copy_citekey())
      .setIcon("copy")
      .onClick(() => actions.copyCitationKey(indexedKey)),
  );
  menu.addItem((item) =>
    item
      .setSection(SECTION.zotero)
      .setTitle(m.library_view_menu_show_in_zotero())
      .setIcon("external-link")
      .onClick(() => actions.showInZotero(indexedKey)),
  );
  raiseMenu(menu, {
    workspace: deps.workspace,
    event: itemMenu,
    info: { source: "library-view", indexedKey },
  });
  return menu;
}

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    "zotlit:item-menu": {
      source: "library-view";
      indexedKey: string;
    };
  }
}
