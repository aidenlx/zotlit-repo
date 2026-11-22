// Ported from zotero/reader `src/pdf/selection.js`, `pdf-view.js` and
// `native-text-selection.js` at 132bb787937a540a09513415fd507654eb0e88f9.
// pdf-reader is copyright © 2020–2021 Corporation for Digital Scholarship,
// Vienna, Virginia, USA, and distributed under the GNU Affero General Public
// License v3; ZotLit's AGPL-3.0-or-later grant lets this port be distributed
// under AGPL v3.

import type { Rect, StructuredChar, StructuredPage } from "#chars.ts";
import type { PdfRectsPosition } from "#sort-index.ts";

import {
  alignTextUnits,
  buildReaderUnitMap,
  getNormalizedUnits,
  selectionTextMatches,
} from "#vendor/native-text-selection-map.js";

export interface TextRange {
  readonly rects: Rect[];
  readonly text: string;
}

export interface TextLayerSelection {
  readonly pageIndex: number;
  readonly layerText: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly rects: readonly Rect[];
}

export interface TextSelection {
  readonly text: string;
  readonly pages: readonly TextLayerSelection[];
}

export interface SelectedText {
  readonly pageIndex: number;
  readonly rects: Rect[];
  readonly nextPageRects?: Rect[];
  readonly text: string;
}

function rectsFromChars(chars: readonly StructuredChar[]): Rect[] {
  const lineRects: Rect[] = [];
  let current: [number, number, number, number] | null = null;
  for (const { inlineRect, lineBreakAfter } of chars) {
    current ??= [...inlineRect];
    current = [
      Math.min(current[0], inlineRect[0]),
      Math.min(current[1], inlineRect[1]),
      Math.max(current[2], inlineRect[2]),
      Math.max(current[3], inlineRect[3]),
    ];
    if (lineBreakAfter) {
      lineRects.push(current);
      current = null;
    }
  }
  if (current) lineRects.push(current);
  return lineRects;
}

function textFromChars(chars: readonly StructuredChar[]): string {
  const text: string[] = [];
  for (const char of chars) {
    if (char.ignorable) continue;
    text.push(char.c);
    if (char.spaceAfter || char.lineBreakAfter) text.push(" ");
    if (char.paragraphBreakAfter) text.push(" ");
  }
  return text.join("").trim();
}

export function textRange(
  chars: readonly StructuredChar[],
  anchorOffset: number,
  headOffset: number,
): TextRange {
  if (anchorOffset === headOffset) return { rects: [], text: "" };
  const rangeChars = chars.slice(
    Math.min(anchorOffset, headOffset),
    Math.max(anchorOffset, headOffset),
  );
  const round = (value: number) => Number.parseFloat(value.toFixed(3));
  return {
    rects: rectsFromChars(rangeChars).map(
      ([x1, y1, x2, y2]) =>
        [round(x1), round(y1), round(x2), round(y2)] as const,
    ),
    text: textFromChars(rangeChars),
  };
}

const intersects = (a: Rect, b: Rect): boolean =>
  !(b[0] > a[2] || b[2] < a[0] || b[1] > a[3] || b[3] < a[1]);

const centreOf = ([x1, y1, x2, y2]: Rect): Rect => {
  const x = x1 + (x2 - x1) / 2;
  const y = y1 + (y2 - y1) / 2;
  return [x, y, x, y];
};

export function offsetsByRects(
  chars: readonly StructuredChar[],
  rects: readonly Rect[],
): { from: number; to: number } | null {
  const [first] = rects;
  const last = rects.at(-1);
  if (!first || !last || !chars.length) return null;
  let from = chars.findIndex((char) => intersects(centreOf(char.rect), first));
  if (from === -1) from = Number.POSITIVE_INFINITY;
  const to =
    chars.findLastIndex((char) => intersects(centreOf(char.rect), last)) + 1;
  return from > to ? null : { from, to };
}

function normalizedPrefix(text: string): { units: string[]; prefix: number[] } {
  const units: string[] = [];
  const prefix = Array.from<number>({ length: text.length + 1 }).fill(0);
  let source = 0;
  for (const character of text) {
    for (let i = 1; i < character.length; i++)
      prefix[source + i] = units.length;
    units.push(...getNormalizedUnits(character));
    source += character.length;
    prefix[source] = units.length;
  }
  return { units, prefix };
}

interface PageRange {
  readonly pageIndex: number;
  readonly chars: readonly StructuredChar[];
  readonly from: number;
  readonly to: number;
}

function mappedRange(
  layer: TextLayerSelection,
  chars: readonly StructuredChar[],
): PageRange | null {
  const dom = normalizedPrefix(layer.layerText);
  const reader = buildReaderUnitMap(chars);
  const toReader = alignTextUnits(dom.units, reader.readerUnits);
  const offset = (at: number, ends: readonly number[]) => {
    const unit = toReader[dom.prefix[at]!];
    return unit === undefined ? undefined : ends[unit];
  };
  const from =
    layer.start === null ? 0 : offset(layer.start, reader.readerStartOffsets);
  const to =
    layer.end === null
      ? chars.length
      : offset(layer.end, reader.readerEndOffsets);
  if (from === undefined || to === undefined) return null;
  return { pageIndex: layer.pageIndex, chars, from, to };
}

function rangesByRects(
  layers: readonly {
    layer: TextLayerSelection;
    chars: readonly StructuredChar[];
  }[],
): PageRange[] | null {
  const covered = layers.flatMap(({ layer, chars }) => {
    const offsets = offsetsByRects(chars, layer.rects);
    return offsets && offsets.from !== offsets.to
      ? [{ index: layer.pageIndex, ...offsets }]
      : [];
  });
  const first = covered[0];
  const last = covered.at(-1);
  if (!first || !last) return null;
  return layers
    .filter(
      ({ layer }) =>
        layer.pageIndex >= first.index && layer.pageIndex <= last.index,
    )
    .map(({ layer, chars }) => ({
      pageIndex: layer.pageIndex,
      chars,
      from: layer.pageIndex === first.index ? first.from : 0,
      to: layer.pageIndex === last.index ? last.to : chars.length,
    }));
}

export function selectText(
  selection: TextSelection,
  pages: ReadonlyMap<number, StructuredPage>,
): SelectedText | null {
  const layers = selection.pages
    .toSorted((a, b) => a.pageIndex - b.pageIndex)
    .flatMap((layer) => {
      const page = pages.get(layer.pageIndex);
      return page ? [{ layer, chars: page.chars }] : [];
    });
  if (!layers.length) return null;

  const quoted = (ranges: readonly PageRange[] | null) => {
    if (!ranges?.length) return null;
    const placed = ranges.map((range) => ({
      pageIndex: range.pageIndex,
      ...textRange(range.chars, range.from, range.to),
    }));
    const text = placed.map((range) => range.text).join("\n");
    return selectionTextMatches(selection.text, text) ? placed : null;
  };
  const mapped = layers.map(({ layer, chars }) => mappedRange(layer, chars));
  const allMapped = mapped.every((range): range is PageRange => range !== null);
  const placed =
    quoted(allMapped ? mapped : null) ?? quoted(rangesByRects(layers));
  if (!placed) return null;

  const [first, spilled] = placed.filter((range) => range.rects.length > 0);
  if (!first) return null;
  const next = spilled?.pageIndex === first.pageIndex + 1 ? spilled : undefined;
  return {
    pageIndex: first.pageIndex,
    rects: first.rects,
    ...(next && { nextPageRects: next.rects }),
    text: next ? `${first.text} ${next.text}` : first.text,
  };
}

export type RangeEnd = "start" | "end";

export interface PagePoint {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
}

export type RangeStep = "left" | "right" | "up" | "down";

export type RangeAdjustment = {
  readonly position: PdfRectsPosition;
  readonly end: RangeEnd;
} & (
  | {
      readonly point: PagePoint;
    }
  | { readonly step: RangeStep }
);

function rectsDist(
  [ax1, ay1, ax2, ay2]: Rect,
  [bx1, by1, bx2, by2]: Rect,
): number {
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

function offsetAtPoint(
  chars: readonly StructuredChar[],
  { x, y }: PagePoint,
): number {
  let closest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, char] of chars.entries()) {
    const d = rectsDist(char.rect, [x, y, x, y]);
    if (d < distance) {
      distance = d;
      closest = index;
    }
  }
  const { rotation, rect } = chars[closest]!;
  const midX = rect[0] + (rect[2] - rect[0]) / 2;
  const midY = rect[1] + (rect[3] - rect[1]) / 2;
  const past =
    (!rotation && x > midX) ||
    (rotation === 90 && y > midY) ||
    (rotation === 180 && x < midX) ||
    (rotation === 270 && y < midY);
  return past ? closest + 1 : closest;
}

function nextLineOffset(
  chars: readonly StructuredChar[],
  offset: number,
): number | null {
  const lineEnd = chars.findIndex(
    (char, index) => index >= offset && char.lineBreakAfter,
  );
  if (lineEnd === -1 || lineEnd === chars.length - 1) return chars.length;
  const nextEnd = chars.findIndex(
    (char, index) => index > lineEnd && char.lineBreakAfter,
  );
  return closestOnLine(chars, chars[offset]!.rect, [lineEnd + 1, nextEnd]);
}

function previousLineOffset(
  chars: readonly StructuredChar[],
  offset: number,
): number | null {
  const at = offset === chars.length ? offset - 1 : offset;
  const previousEnd = chars.findLastIndex(
    (char, index) => index < at && char.lineBreakAfter,
  );
  if (previousEnd === -1) return 0;
  const previousStart =
    chars.findLastIndex(
      (char, index) => index < previousEnd && char.lineBreakAfter,
    ) + 1;
  return closestOnLine(chars, chars[at]!.rect, [previousStart, previousEnd]);
}

function closestOnLine(
  chars: readonly StructuredChar[],
  rect: Rect,
  [start, end]: readonly [number, number],
): number | null {
  let closest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = start; index <= end; index++) {
    const d = rectsDist(chars[index]!.rect, rect);
    if (d < distance) {
      distance = d;
      closest = index;
    }
  }
  return closest;
}

function steppedHead(
  head: number,
  step: RangeStep,
  [first, next]: readonly [
    readonly StructuredChar[],
    readonly StructuredChar[],
  ],
): number {
  const onNext = head > first.length;
  const chars = onNext ? next : first;
  const base = onNext ? first.length : 0;
  const local = head - base;
  if (step === "left" || (step === "up" && local === 0)) return head - 1;
  if (step === "up") {
    const moved = previousLineOffset(chars, local);
    return moved === null ? head : base + moved;
  }
  if (local === chars.length) {
    return !onNext && next.length ? head + 1 : head;
  }
  if (step === "right") return head + 1;
  const moved = nextLineOffset(chars, local);
  return moved === null ? head : base + moved;
}

export function adjustRange(
  adjustment: RangeAdjustment,
  pages: ReadonlyMap<number, StructuredPage>,
): SelectedText | null {
  const { position, end } = adjustment;
  const { pageIndex } = position;
  const point = "point" in adjustment ? adjustment.point : null;
  if (
    point &&
    point.pageIndex !== pageIndex &&
    point.pageIndex !== pageIndex + 1
  )
    return null;
  const first = pages.get(pageIndex)?.chars ?? [];
  const onFirst = offsetsByRects(first, position.rects);
  if (!onFirst) return null;
  const next = pages.get(pageIndex + 1)?.chars ?? [];
  const onNext = position.nextPageRects
    ? offsetsByRects(next, position.nextPageRects)
    : null;

  const from = onFirst.from;
  const to = onNext ? first.length + onNext.to : onFirst.to;
  let start = from;
  let stop = to;
  if (point) {
    let head: number;
    if (point.pageIndex === pageIndex) head = offsetAtPoint(first, point);
    else if (next.length) head = first.length + offsetAtPoint(next, point);
    else return null;
    if (end === "end") stop = Math.max(head, from + 1);
    else {
      if (head >= first.length) return null;
      start = Math.min(head, to - 1);
    }
  } else if ("step" in adjustment) {
    const head = steppedHead(end === "end" ? to : from, adjustment.step, [
      first,
      next,
    ]);
    if (end === "end") {
      if (head <= from) return null;
      stop = head;
    } else {
      if (head < 0 || head >= first.length || head >= to) return null;
      start = head;
    }
  }

  const stored =
    start === from && stop === to
      ? { rects: [...position.rects], nextPageRects: position.nextPageRects }
      : null;
  const onPage = textRange(first, start, Math.min(stop, first.length));
  const spill =
    stop > first.length ? textRange(next, 0, stop - first.length) : null;
  if (!onPage.rects.length) return null;
  return spill?.rects.length
    ? {
        pageIndex,
        rects: stored?.rects ?? onPage.rects,
        nextPageRects: stored?.nextPageRects
          ? [...stored.nextPageRects]
          : spill.rects,
        text: `${onPage.text} ${spill.text}`,
      }
    : { pageIndex, rects: stored?.rects ?? onPage.rects, text: onPage.text };
}

export function rectRotation(
  chars: readonly StructuredChar[],
  rect: Rect,
): number {
  const counts = new Map<number, number>();
  for (const { rect: box, rotation } of chars) {
    const x = box[0] + (box[2] - box[0]) / 2;
    const y = box[1] + (box[3] - box[1]) / 2;
    if (x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3])
      counts.set(rotation, (counts.get(rotation) ?? 0) + 1);
  }
  let common = 0;
  let most = 0;
  for (const [rotation, count] of [...counts].toSorted(([a], [b]) => a - b)) {
    if (count >= most) {
      common = rotation;
      most = count;
    }
  }
  return common;
}
