import { Effect } from "effect";

import type { Rect, TextLayerSelection } from "@zotlit/pdf-structure";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import type { OverlayPageView } from "./render.ts";
import { pageContentBox } from "./surface.ts";

export interface ClientBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SelectionPage extends TextLayerSelection {
  box: ClientBox;
  clientRects: readonly ClientBox[];
}

export function selectionPagesOf(
  range: Range,
  pages: readonly { pageIndex: number; view: OverlayPageView }[],
): SelectionPage[] {
  return pages.flatMap(({ pageIndex, view }) => {
    const layer = view.div.querySelector(".textLayer");
    const clamped = layer && clampToNode(range, layer);
    if (!layer || !clamped) return [];
    const within = range.cloneRange();
    within.selectNodeContents(layer);
    const box = pageContentBox(view.div);
    const clientRects = textBoxesOf(clamped, layer);
    return [
      {
        pageIndex,
        layerText: layer.textContent ?? "",
        start:
          range.compareBoundaryPoints(range.START_TO_START, within) < 0
            ? null
            : textOffset(layer, clamped.startContainer, clamped.startOffset),
        end:
          range.compareBoundaryPoints(range.END_TO_END, within) > 0
            ? null
            : textOffset(layer, clamped.endContainer, clamped.endOffset),
        rects: pdfRectsOf(box, view.viewport.transform, clientRects),
        box,
        clientRects,
      },
    ];
  });
}

function textOffset(layer: Node, node: Node, offset: number): number {
  const before = layer.doc.createRange();
  before.setStart(layer, 0);
  before.setEnd(node, offset);
  return before.toString().length;
}

function textBoxesOf(range: Range, layer: Node): ClientBox[] {
  const boxes: ClientBox[] = [];
  const walker = layer.doc.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const part = range.cloneRange();
    part.setStart(node, node === range.startContainer ? range.startOffset : 0);
    part.setEnd(
      node,
      node === range.endContainer ? range.endOffset : node.nodeValue!.length,
    );
    for (const rect of part.getClientRects()) boxes.push(boxOf(rect));
  }
  return boxes;
}

function clampToNode(range: Range, node: Node): Range | null {
  const within = range.cloneRange();
  within.selectNodeContents(node);
  if (range.compareBoundaryPoints(range.END_TO_START, within) >= 0) return null;
  if (range.compareBoundaryPoints(range.START_TO_END, within) <= 0) return null;

  const clamped = range.cloneRange();
  if (clamped.compareBoundaryPoints(clamped.START_TO_START, within) < 0) {
    clamped.setStart(within.startContainer, within.startOffset);
  }
  if (clamped.compareBoundaryPoints(clamped.END_TO_END, within) > 0) {
    clamped.setEnd(within.endContainer, within.endOffset);
  }
  return clamped.collapsed ? null : clamped;
}

function boxOf(rect: DOMRect): ClientBox {
  const { left, top, right, bottom } = rect;
  return { left, top, right, bottom };
}

function pdfRectsOf(
  box: ClientBox,
  transform: readonly number[],
  rects: readonly ClientBox[],
): Rect[] {
  const inverse = inverseTransform(transform);
  if (!inverse) {
    Effect.runSyncWith(logServices)(
      Effect.logDebug("PDF page viewport carries no invertible transform").pipe(
        withLogCategory("pdf-annotation-editor"),
      ),
    );
    return [];
  }
  return rects.flatMap((rect) => {
    const clipped = clip(rect, box);
    if (!clipped) return [];
    const [x1, y1] = applyTransform(
      inverse,
      clipped.left - box.left,
      clipped.bottom - box.top,
    );
    const [x2, y2] = applyTransform(
      inverse,
      clipped.right - box.left,
      clipped.top - box.top,
    );
    return [
      [
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2),
      ] as const,
    ];
  });
}

function clip(rect: ClientBox, box: ClientBox): ClientBox | null {
  const clipped = {
    left: Math.max(rect.left, box.left),
    top: Math.max(rect.top, box.top),
    right: Math.min(rect.right, box.right),
    bottom: Math.min(rect.bottom, box.bottom),
  };
  const empty = clipped.right <= clipped.left || clipped.bottom <= clipped.top;
  return empty ? null : clipped;
}

export function inverseTransform(
  transform: readonly number[],
): readonly number[] | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = transform;
  const determinant = a * d - b * c;
  if (determinant === 0) return null;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - e * d) / determinant,
    (e * b - f * a) / determinant,
  ];
}

export function applyTransform(
  [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0]: readonly number[],
  x: number,
  y: number,
): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}
