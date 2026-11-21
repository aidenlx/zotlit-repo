// The Workbench's native menus: a control's menu under the control, and a
// right-click's menu at the pointer.
import { Menu } from "obsidian";
import type { IconName } from "obsidian";

import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";

export interface WorkbenchMenuItem {
  readonly label: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface WorkbenchMenuRequest {
  /** The element the menu opens from. */
  readonly anchor: HTMLElement;
  /**
   * The pointer event when a right-click opened the menu. A right-click anchors
   * the menu at the pointer, the way Obsidian's own context menus do; a control
   * leaves this out, and the menu anchors under `anchor`.
   */
  readonly pointerEvent?: MouseEvent;
  readonly items: readonly WorkbenchMenuItem[];
  readonly submenus?: readonly {
    label: string;
    items: readonly WorkbenchMenuItem[];
  }[];
}

/**
 * The Workbench's rows on a native menu, each with the icon it names. A menu
 * whose rows name no icon drops the icon column, so a list of names reads flush.
 */
function addWorkbenchMenuItems(
  menu: Menu,
  items: readonly WorkbenchMenuItem[],
): void {
  if (!items.some((item) => item.icon)) menu.setNoIcon();
  for (const item of items)
    menu.addItem((entry) =>
      entry
        .setTitle(item.label)
        .setIcon(item.icon ?? null)
        .setDisabled(item.disabled ?? false)
        .onClick(item.onSelect),
    );
}

export function showWorkbenchMenu({
  anchor,
  pointerEvent,
  items,
  submenus,
}: WorkbenchMenuRequest): void {
  const menu = new Menu();
  addWorkbenchMenuItems(menu, items);
  for (const group of submenus ?? [])
    menu.addItem((entry) => {
      entry.setTitle(group.label);
      addWorkbenchMenuItems(entry.setSubmenu(), group.items);
    });
  // A right-click belongs at the pointer, where the reader clicked; a
  // control's menu belongs under the control, so a keyboard activation
  // lands there too.
  if (pointerEvent) {
    menu.showAtMouseEvent(pointerEvent);
    return;
  }
  showMenuAtButton(menu, anchor);
}
