// The menu of a Library View row: every action the row's Item has, the keys'
// own first. Listeners add to it through `zotlit:item-menu`.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { Menu } from "obsidian";
import type { Workspace } from "obsidian";

import {
  menuEvent,
  menuSections,
  raiseMenu,
} from "@zotlit/obsidian-kit/menu-events.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { LiteratureNotes } from "@zotlit/query-views/desktop/query-view/table-notes.ts";

import type { ItemActions } from "./item-actions.ts";

/** A row's menu in the Library View. */
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

/** The Item a menu acts on. */
export interface MenuItem {
  readonly indexedKey: string;
  /** Whether the Item has a PDF to open; the menu offers none without one. */
  readonly pdf: boolean;
}

/** The menu of the row that lists the Item `indexedKey`. */
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
    /** A row's menu in the Library View: the Item the row lists. */
    "zotlit:item-menu": {
      source: "library-view";
      /** The Item's Indexed Key. */
      indexedKey: string;
    };
  }
}
