import { Scope } from "obsidian";
import type { App } from "obsidian";

import { holdScopeWhileFocused } from "@zotlit/obsidian-kit/focus-scope.ts";
import type { FocusScope } from "@zotlit/obsidian-kit/focus-scope.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import { composing } from "@zotlit/ui";

import { readingAngle } from "./free-text-layout.ts";
import type { TextDraft } from "./reader-surface-state.ts";
import { darken, pageUnitSize, unitPointOf, unitsPerPixel } from "./render.ts";
import type { MeasuredFont, OverlayPageView } from "./render.ts";

export interface TextDraftEvents {
  input: (text: string) => void;
  finish: () => void;
}

const holds = new WeakMap<HTMLTextAreaElement, FocusScope>();

export function createTextDraftArea(
  document_: Document,
  { input, finish }: TextDraftEvents,
  keys: Pick<App, "scope" | "keymap">,
): HTMLTextAreaElement {
  const area = document_.win.createEl("textarea");
  area.classList.add(themeHook.pdfTextDraft);
  area.dir = "auto";
  area.spellcheck = false;
  area.addEventListener("input", () => input(area.value));
  const scope = new Scope(keys.scope);
  scope.register([], "Escape", (event) => {
    if (composing(event)) return;
    finish();
    return false;
  });
  holds.set(area, holdScopeWhileFocused(area, scope, { keymap: keys.keymap }));
  area.addEventListener("blur", () => {
    queueMicrotask(() => {
      if (area.isConnected) finish();
    });
  });
  for (const type of ["pointerdown", "pointerup", "click"] as const)
    area.addEventListener(type, (event) => event.stopPropagation());
  return area;
}

export function placeTextDraft(
  area: HTMLTextAreaElement,
  page: OverlayPageView,
  { draft, font }: { draft: TextDraft; font: MeasuredFont },
): void {
  const scale = 1 / unitsPerPixel(page);
  const unit = pageUnitSize(page);
  const [left, bottom, right, top] = draft.box;
  const corner = unitPointOf(page, [left, top]);
  const angle = readingAngle(
    (x, y) => {
      const { x: px, y: py } = unitPointOf(page, [x, y]);
      return [px, py];
    },
    left,
    top,
  );
  area.setCssProps({
    "--zt-text-draft-left": `${(corner.x / unit.width) * 100}%`,
    "--zt-text-draft-top": `${(corner.y / unit.height) * 100}%`,
    "--zt-text-draft-width": `${right - left}px`,
    "--zt-text-draft-height": `${top - bottom}px`,
    "--zt-text-draft-angle": `${angle}deg`,
    "--zt-text-draft-scale": String(scale),
    "--zt-text-draft-font-family": font.family,
    "--zt-text-draft-font-size": `${draft.fontSize}px`,
    "--zt-text-draft-color": darken(draft.color),
  });
  if (area.value !== draft.text) area.value = draft.text;
  area.readOnly = draft.phase === "saving";
}

export function removeTextDraftArea(area: HTMLTextAreaElement): void {
  const focused = area.doc.activeElement === area;
  const textLayer =
    area.parentElement?.querySelector<HTMLElement>(".textLayer");
  holds.get(area)?.[Symbol.dispose]();
  holds.delete(area);
  area.remove();
  if (focused) textLayer?.focus({ preventScroll: true });
}
