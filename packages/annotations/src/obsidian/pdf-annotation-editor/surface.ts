import { Menu } from "obsidian";

import { menuSections } from "@zotlit/obsidian-kit/menu-events.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { annotationColorMenu, buildColorMenu } from "./color-menu.ts";
import type { PdfPoint } from "./geometry-edit.ts";
import type { PageBox, Point } from "./hit-test.ts";
import type { OverlayPageView } from "./render.ts";
import { pageUnitSize } from "./render.ts";
import { applyTransform, inverseTransform } from "./selection-capture.ts";
import type { InkWidth, TextFontSize } from "./tools.ts";
import { INK_WIDTHS, TEXT_FONT_SIZES } from "./tools.ts";

const SECTION = menuSections(annotationColorMenu);

export function onScreen(containerEl: HTMLElement, { x, y }: Point): boolean {
  const rect = containerEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function pageContentBox(div: HTMLElement): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
} {
  const rect = div.getBoundingClientRect();
  const { clientLeft: x, clientTop: y } = div;
  return {
    left: rect.left + x,
    top: rect.top + y,
    right: rect.right - x,
    bottom: rect.bottom - y,
    width: rect.width - 2 * x,
    height: rect.height - 2 * y,
  };
}

export function selectionCollapsed(containerEl: HTMLElement): boolean {
  const selection = containerEl.win.getSelection();
  if (!selection || selection.isCollapsed) return true;
  return !containerEl.contains(selection.anchorNode);
}

export function colorMenu(
  current: string | null,
  onPick: (hex: string) => void,
): Menu {
  const menu = new Menu();
  buildColorMenu(menu, { colors: [current], onSelect: onPick });
  return menu;
}

export function addInkWidths(
  menu: Menu,
  current: InkWidth,
  onPick: (width: InkWidth) => void,
): void {
  menu.addItem((item) =>
    item
      .setSection(SECTION["ink-width"])
      .setTitle(m.pdf_toolbar_ink_width())
      .setIsLabel(true),
  );
  for (const width of INK_WIDTHS) {
    menu.addItem((item) =>
      item
        .setSection(SECTION["ink-width"])
        .setTitle(m.pdf_toolbar_ink_width_step({ width: String(width) }))
        .setChecked(width === current)
        .onClick(() => onPick(width)),
    );
  }
}

export function addTextFontSizes(
  menu: Menu,
  current: TextFontSize,
  onPick: (size: TextFontSize) => void,
): void {
  menu.addItem((item) =>
    item
      .setSection(SECTION["font-size"])
      .setTitle(m.pdf_toolbar_text_font_size())
      .setIsLabel(true),
  );
  for (const size of TEXT_FONT_SIZES) {
    menu.addItem((item) =>
      item
        .setSection(SECTION["font-size"])
        .setTitle(m.pdf_toolbar_text_font_size_step({ size: String(size) }))
        .setChecked(size === current)
        .onClick(() => onPick(size)),
    );
  }
}

export function pageBoxOf(page: OverlayPageView): PageBox {
  const rect = pageContentBox(page.div);
  const unit = pageUnitSize(page);
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    unitWidth: unit.width,
    unitHeight: unit.height,
  };
}

export function drawnBoxOf(page: OverlayPageView): PageBox {
  const box = pageBoxOf(page);
  const overlay = page.div.querySelector(`.${themeHook.pdfAnnotationOverlay}`);
  if (!overlay) return box;
  const { left, top, width, height } = overlay.getBoundingClientRect();
  return { ...box, left, top, width, height };
}

export function unitsOf(box: PageBox, client: Point): Point {
  return {
    x: ((client.x - box.left) * box.unitWidth) / box.width,
    y: ((client.y - box.top) * box.unitHeight) / box.height,
  };
}

export function pdfPointOf(page: OverlayPageView, { x, y }: Point): PdfPoint {
  const { transform, scale } = page.viewport;
  return applyTransform(inverseTransform(transform)!, x * scale, y * scale);
}

export function pdfPointAt(page: OverlayPageView, client: Point): PdfPoint {
  return pdfPointOf(page, unitsOf(drawnBoxOf(page), client));
}

export function releaseCapture(
  containerEl: HTMLElement,
  held: { pointerId: number } | null,
): null {
  if (held && containerEl.hasPointerCapture(held.pointerId))
    containerEl.releasePointerCapture(held.pointerId);
  return null;
}
