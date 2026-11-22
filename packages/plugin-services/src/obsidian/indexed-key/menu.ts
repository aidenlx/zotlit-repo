import type { FileMenuSegment } from "#obsidian/file-menu.ts";
import type { Menu } from "obsidian";

import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { copyIndexedKey } from "./actions.ts";
import type { IndexedKeyCopyTarget, IndexedKeyKind } from "./actions.ts";

const COPY_LABEL: Record<IndexedKeyKind, () => string> = {
  item: m.command_copy_item_key_name,
  annotation: m.indexed_key_menu_copy_annotation,
};

export function addCopyIndexedKeyMenuItem(
  menu: Menu,
  target: IndexedKeyCopyTarget | null,
  options?: { section: string },
): boolean {
  if (!target) return false;
  menu.addItem((item) => {
    if (options) item.setSection(options.section);
    item
      .setTitle(COPY_LABEL[target.kind]())
      .setIcon("key-round")
      .onClick(() => {
        void copyIndexedKey(target.indexedKey);
      });
  });
  return true;
}

export function indexedKeyFileMenu(): FileMenuSegment {
  return (menu, { itemKey }) => {
    addCopyIndexedKeyMenuItem(
      menu,
      itemKey ? { indexedKey: itemKey, kind: "item" } : null,
      { section: MENU_SECTION.info },
    );
  };
}
