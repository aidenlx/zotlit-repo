// Ported from zotero/reader `src/pdf/selection.js` and `src/pdf/lib/utilities.js`
// at 132bb787937a540a09513415fd507654eb0e88f9. pdf-reader is copyright ©
// 2020–2021 Corporation for Digital Scholarship, Vienna, Virginia, USA, and
// distributed under the GNU Affero General Public License v3; ZotLit's
// AGPL-3.0-or-later grant lets this port be distributed under AGPL v3.

import type { Rect, StructuredChar, StructuredPage } from "#chars.ts";

export interface PdfRectsPosition {
  readonly pageIndex: number;
  readonly rects: readonly Rect[];
  readonly nextPageRects?: readonly Rect[];
}

export interface PdfInkPosition {
  readonly pageIndex: number;
  readonly paths: readonly (readonly number[])[];
  readonly width?: number;
}

export type PdfPosition = PdfInkPosition | PdfRectsPosition;

const hasRects = (position: PdfPosition): position is PdfRectsPosition =>
  "rects" in position && position.rects.length > 0;

function topMostRect(position: PdfRectsPosition): Rect {
  return position.rects.slice().sort((a, b) => b[2] - a[2])[0]!;
}

function pathsBoundingRect(paths: readonly (readonly number[])[]): Rect {
  const [x = 0, y = 0] = paths[0] ?? [];
  const rect: [number, number, number, number] = [x, y, x, y];
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i += 2) {
      rect[0] = Math.min(rect[0], path[i]!);
      rect[1] = Math.min(rect[1], path[i + 1]!);
      rect[2] = Math.max(rect[2], path[i]!);
      rect[3] = Math.max(rect[3], path[i + 1]!);
    }
  }
  return rect;
}

function rectsDist(a: Rect, b: Rect): number {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
  const left = bx2 < ax1;
  const right = ax2 < bx1;
  const bottom = by2 < ay1;
  const top = ay2 < by1;

  if (top && left) return Math.hypot(ax1 - bx2, ay2 - by1);
  if (left && bottom) return Math.hypot(ax1 - bx2, ay1 - by2);
  if (bottom && right) return Math.hypot(ax2 - bx1, ay1 - by2);
  if (right && top) return Math.hypot(ax2 - bx1, ay2 - by1);
  if (left) return ax1 - bx2;
  if (right) return bx1 - ax2;
  if (bottom) return ay1 - by2;
  if (top) return by1 - ay2;
  return 0;
}

function closestOffset(chars: readonly StructuredChar[], rect: Rect): number {
  let dist = Number.POSITIVE_INFINITY;
  let index = 0;
  for (const [i, char] of chars.entries()) {
    const distance = rectsDist(char.rect, rect);
    if (distance < dist) {
      dist = distance;
      index = i;
    }
  }
  return index;
}

export function sortIndexRect(position: PdfPosition): Rect {
  return hasRects(position)
    ? topMostRect(position)
    : pathsBoundingRect("paths" in position ? position.paths : []);
}

const field = (value: number, width: number): string =>
  value.toString().slice(0, width).padStart(width, "0");

export function computeSortIndex(
  page: StructuredPage,
  position: PdfPosition,
): string {
  const rect = sortIndexRect(position);
  const offset = page.chars.length ? closestOffset(page.chars, rect) : 0;
  const pageHeight = page.viewBox[3] - page.viewBox[1];
  const top = Math.max(pageHeight - rect[3], 0);

  return [
    field(position.pageIndex, 5),
    field(offset, 6),
    field(Math.floor(top), 5),
  ].join("|");
}
