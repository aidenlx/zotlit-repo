import type { Menu } from "obsidian";
import { createContext } from "react";

import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { IndexedKeyCopyTarget } from "@zotlit/plugin-services/obsidian/indexed-key/actions.ts";
import { addCopyIndexedKeyMenuItem } from "@zotlit/plugin-services/obsidian/indexed-key/menu.ts";

export interface ExplorerActions {
  onChooseItem(): void;
  onBackToNoteRoot(): void;
  onToggleSections(): void;
  onRefresh(): void;
  addCopyKeyMenuItem(menu: Menu): boolean;
  addExportMenuItem(menu: Menu): void;
}

export function createExplorerActions(deps: {
  onChooseItem(this: void): void;
  onBackToNoteRoot(this: void): void;
  onToggleSections(this: void): void;
  onRefresh(this: void): void;
  copyTarget(this: void): IndexedKeyCopyTarget | null;
  canExport(this: void): boolean;
  onExport(this: void): void;
  exportLabel?(): string;
}): ExplorerActions {
  return {
    onChooseItem: deps.onChooseItem,
    onBackToNoteRoot: deps.onBackToNoteRoot,
    onToggleSections: deps.onToggleSections,
    onRefresh: deps.onRefresh,
    addCopyKeyMenuItem(menu) {
      return addCopyIndexedKeyMenuItem(menu, deps.copyTarget(), {
        section: MENU_SECTION.info,
      });
    },
    addExportMenuItem(menu) {
      if (!deps.canExport()) return;
      menu.addItem((item) => {
        item
          .setSection(MENU_SECTION.action)
          .setTitle(
            deps.exportLabel?.() ?? m.template_data_explorer_menu_export_json(),
          )
          .setIcon("file-json")
          .onClick(() => deps.onExport());
      });
    },
  };
}

const NOOP_ACTIONS: ExplorerActions = {
  onChooseItem: () => {},
  onBackToNoteRoot: () => {},
  onToggleSections: () => {},
  onRefresh: () => {},
  addCopyKeyMenuItem: () => false,
  addExportMenuItem: () => {},
};

export const ExplorerActionsContext =
  createContext<ExplorerActions>(NOOP_ACTIONS);
