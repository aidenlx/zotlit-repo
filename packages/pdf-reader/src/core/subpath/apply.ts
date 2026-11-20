import type { Subpath } from "#/core/subpath/parse.ts";
import type { ReaderPage } from "#/core/types.ts";
import type { Destination, PageView } from "#/core/viewer/viewer.ts";

import { integerOf } from "#/core/subpath/parse.ts";

const HIGHLIGHT_LAYER = "zpr-highlight";
const SCROLL_MARGIN = 50;

export function pageDestination(subpath: Subpath): Destination | null {
  if (subpath.page === null) return null;
  const parts = subpath.params.get("offset")?.split(",") ?? [];
  const [left, top, zoom] = [0, 1, 2].map((index) => integerOf(parts[index]));
  return zoom === null
    ? [subpath.page - 1, { name: "FitBH" }, top]
    : [subpath.page - 1, { name: "XYZ" }, left, top, zoom];
}

export function viewerHash(subpath: Subpath): string | null {
  const kept: string[] = [];
  for (const key of ["zoom", "search"] as const) {
    const value = subpath[key];
    if (value) kept.push(`${key}=${value}`);
  }
  return kept.length > 0 ? kept.join("&") : null;
}

export type HighlightTarget =
  | {
      readonly kind: "text";
      readonly pageIndex: number;
      readonly range: readonly [number, number, number, number];
    }
  | {
      readonly kind: "annotation";
      readonly pageIndex: number;
      readonly id: string;
    };

export function highlightOf(subpath: Subpath): HighlightTarget | null {
  if (subpath.page === null) return null;
  const pageIndex = subpath.page - 1;
  if (subpath.annotation !== null) {
    return { kind: "annotation", pageIndex, id: subpath.annotation };
  }
  if (subpath.selection !== null) {
    return { kind: "text", pageIndex, range: subpath.selection };
  }
  return null;
}

export function revealIn(container: HTMLElement, element: Element): void {
  const offset =
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    SCROLL_MARGIN;
  container.scrollTop += offset;
}

export function scrollNearest(
  container: HTMLElement,
  element: Element,
  behavior: ScrollBehavior = "auto",
): void {
  const box = container.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const above = rect.top - box.top - container.clientTop;
  const below = above + rect.height - container.clientHeight;
  const top = above < 0 ? above : below > 0 ? Math.min(above, below) : 0;
  if (top !== 0) container.scrollBy({ top, behavior });
}

export interface Painted {
  readonly first: Element | null;
  clear(): void;
}

export function paintText(
  view: PageView,
  range: readonly [number, number, number, number],
): Painted {
  const [startDiv, startOffset, endDiv, endOffset] = range;
  const divs = view._textHighlighter.textDivs ?? [];
  const saved: [HTMLElement, string][] = [];
  let first: Element | null = null;
  for (let index = startDiv; index <= endDiv; index++) {
    const div = divs[index];
    if (!div?.isConnected) continue;
    const text = div.textContent ?? "";
    const start = index === startDiv ? startOffset : 0;
    const end = index === endDiv ? endOffset : text.length;
    if (start >= end) continue;
    const mark = div.ownerDocument.createElement("span");
    mark.dataset.zprHighlight = "text";
    mark.textContent = text.slice(start, end);
    saved.push([div, text]);
    div.replaceChildren(text.slice(0, start), mark, text.slice(end));
    first ??= mark;
  }
  return {
    first,
    clear: () => {
      for (const [div, text] of saved) div.textContent = text;
    },
  };
}

export async function paintAnnotation(
  page: ReaderPage,
  view: PageView,
  id: string,
): Promise<Painted | null> {
  const annotations = (await view.pdfPage?.getAnnotations()) as
    | readonly { readonly id: string; readonly rect: readonly number[] }[]
    | undefined;
  const annotation = annotations?.find((entry) => entry.id === id);
  if (!annotation) return null;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = annotation.rect;
  const box = page.toBox([x1, y1, x2, y2]);
  const layer = page.layer(HIGHLIGHT_LAYER);
  const mark = layer.ownerDocument.createElement("div");
  mark.dataset.zprHighlight = "annotation";
  mark.className =
    "zpr:absolute zpr:left-(--zpr-box-left) zpr:top-(--zpr-box-top) zpr:w-(--zpr-box-width) zpr:h-(--zpr-box-height)";
  mark.style.setProperty("--zpr-box-left", box.left);
  mark.style.setProperty("--zpr-box-top", box.top);
  mark.style.setProperty("--zpr-box-width", box.width);
  mark.style.setProperty("--zpr-box-height", box.height);
  layer.replaceChildren(mark);
  return {
    first: mark,
    clear: () => {
      mark.remove();
    },
  };
}
