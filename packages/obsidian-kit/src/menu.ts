import type { Menu } from "obsidian";

export type MenuAlign = "start" | "end";

const ACTIVE_MENU_CLASS = "has-active-menu";

export interface MenuAnchor {
  rect: DOMRectReadOnly;
  doc?: Document;
}

export function hasActiveMenu(el: HTMLElement): boolean {
  return (
    el.hasClass(ACTIVE_MENU_CLASS) ||
    el.querySelector(`.${ACTIVE_MENU_CLASS}`) !== null
  );
}

export function showMenuAtBox(
  menu: Menu,
  anchor: MenuAnchor,
  align: MenuAlign = "start",
): void {
  placeMenu(menu, anchor, align);
}

export function showMenuAtButton(
  menu: Menu,
  trigger: HTMLElement,
  align: MenuAlign = "start",
): void {
  if (trigger.hasClass(ACTIVE_MENU_CLASS)) return;
  menu.setParentElement(trigger);
  placeMenu(
    menu,
    { rect: trigger.getBoundingClientRect(), doc: trigger.doc },
    align,
  );
}

function placeMenu(menu: Menu, anchor: MenuAnchor, align: MenuAlign): void {
  const { rect } = anchor;
  menu.showAtPosition(
    {
      x: rect.x,
      y: rect.bottom,
      width: rect.width,
      overlap: true,
      left: align === "end",
    },
    anchor.doc,
  );
}
