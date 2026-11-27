import type { IconName } from "obsidian";
import { Menu } from "obsidian";

import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";

export interface WorkbenchMenuItem {
  readonly label: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface WorkbenchMenuRequest {
  readonly anchor: HTMLElement;
  readonly pointerEvent?: MouseEvent;
  readonly items: readonly WorkbenchMenuItem[];
  readonly submenus?: readonly {
    label: string;
    items: readonly WorkbenchMenuItem[];
  }[];
}

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
  if (pointerEvent) {
    menu.showAtMouseEvent(pointerEvent);
    return;
  }
  showMenuAtButton(menu, anchor);
}
