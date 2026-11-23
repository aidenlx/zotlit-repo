import type { PdfTextPosition } from "@zotlit/db";

import type { PdfRect } from "./geometry-edit.ts";

import { storedWide } from "#obsidian/annotation-repository/write.ts";

export type PagePoint = readonly [number, number];

type Box = readonly [number, number, number, number];

export type PageRect = Box;

export type ToPagePoint = (x: number, y: number) => PagePoint;

export interface Turn {
  angle: number;
  pivot: PagePoint;
}

export interface FreeTextLayout {
  baseline: PagePoint;
  turns: readonly Turn[];
  ring: { rect: PageRect; turns: readonly Turn[] };
  hit: PageRect;
}

export function freeTextLayout(
  toPagePoint: ToPagePoint,
  position: PdfTextPosition,
  padding: number,
): FreeTextLayout {
  const stored = position.rects[0]!;
  const left = Math.min(stored[0], stored[2]);
  const top = Math.max(stored[1], stored[3]);

  const rect = toPageRect(toPagePoint, stored);
  const angle = -position.rotation;
  const storedTurn: Turn[] =
    angle === 0 ? [] : [{ angle, pivot: centreOf(rect) }];

  const baseline = toPagePoint(left, top - position.fontSize);
  const reading = readingAngle(toPagePoint, left, top);

  return {
    baseline,
    turns:
      reading === 0
        ? storedTurn
        : [...storedTurn, { angle: reading, pivot: baseline }],
    ring: { rect: grow(rect, padding), turns: storedTurn },
    hit: turnedBounds(rect, angle),
  };
}

export function readingAngle(
  toPagePoint: ToPagePoint,
  left: number,
  top: number,
): number {
  const [ox, oy] = toPagePoint(left, top);
  const [ux, uy] = toPagePoint(left + 1, top);
  return Math.round((Math.atan2(uy - oy, ux - ox) * 180) / Math.PI);
}

export function turnedBounds(box: Box, angle: number): Box {
  if (angle === 0) return box;
  const turn = turnAbout(box, angle);
  const [x1, y1, x2, y2] = box;
  const corners = (
    [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ] as const
  ).map(turn);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function turnAbout(box: Box, angle: number) {
  const turn = turnBy(angle);
  const [cx, cy] = centreOf(box);
  return ([x, y]: PagePoint): [number, number] => {
    const [tx, ty] = turn(x - cx, y - cy);
    return [cx + tx, cy + ty];
  };
}

function toPageRect(
  toPagePoint: ToPagePoint,
  [x1, y1, x2, y2]: readonly number[],
): PageRect {
  const [ax, ay] = toPagePoint(x1!, y1!);
  const [bx, by] = toPagePoint(x2!, y2!);
  return [
    Math.min(ax, bx),
    Math.min(ay, by),
    Math.max(ax, bx),
    Math.max(ay, by),
  ];
}

function centreOf([x1, y1, x2, y2]: Box): readonly [number, number] {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

function grow([left, top, right, bottom]: PageRect, by: number): PageRect {
  return [left - by, top - by, right + by, bottom + by];
}

export type TextMeasure = (text: string, fontSize: number) => number;

interface SizedMeasure {
  fontSize: number;
  measure: TextMeasure;
}

export const LINE_HEIGHT = 1.2;

export function freeTextLines(
  text: string,
  width: number,
  { fontSize, measure }: SizedMeasure,
): string[] {
  const fits = (run: string) => measure(run, fontSize) <= width;
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (fits(line + word)) {
        line += `${word} `;
        continue;
      }
      const finished = line.trim();
      if (finished) lines.push(finished);
      if (fits(word)) {
        line = `${word} `;
        continue;
      }
      let part = "";
      for (const char of word) {
        if (fits(part + char)) {
          part += char;
        } else {
          lines.push(part);
          part = char;
        }
      }
      line = `${part} `;
    }
    lines.push(line.trim());
    return lines;
  });
}

const PAGE_INSET = 5;

const MAX_LINE_WIDTH = 300;

const LINE_PADDING = 5;

export function fitFreeTextBox(
  text: string,
  {
    rects,
    rotation,
    fontSize,
  }: Pick<PdfTextPosition, "rects" | "rotation" | "fontSize">,
  {
    measure,
    pageBox,
    mode = "single-line-capped",
  }: {
    measure: TextMeasure;
    pageBox: readonly number[];
    mode?: FitMode;
  },
): PdfRect {
  const old: PdfRect = rects[0]!;
  const [left, bottom, right, top] = old;
  const font = { fontSize, measure };
  const measured = text || "A";
  const widest = () =>
    Math.max(...measured.split("\n").map((line) => measure(line, fontSize)));
  const heightAt = (width: number) =>
    freeTextLines(measured, width, font).length * LINE_HEIGHT * fontSize;

  const keepsWidth = mode === "keep-width" || top - bottom >= 2 * fontSize;
  let width = keepsWidth ? right - left : widest();
  let height = heightAt(width);
  if (height < 2 * fontSize && !keepsWidth) {
    width = widest() + LINE_PADDING;
    if (width > MAX_LINE_WIDTH && mode === "single-line-capped") {
      width = MAX_LINE_WIDTH;
      height = heightAt(width);
    }
  }

  const anchored = anchorCorner(old, [width, height], {
    rotation,
    corner: "tl",
  });
  const [dx, dy] = backInside(turnedBounds(anchored, rotation), boxOf(pageBox));
  if (keepsWidth) {
    return [
      anchored[0] + dx,
      anchored[1] + dy,
      anchored[2] + dx,
      anchored[3] + dy,
    ];
  }
  width += dx;
  return anchorCorner(old, [width, heightAt(width)], {
    rotation,
    corner: "tl",
  });
}

export function fitStoredTextBox(
  ...args: Parameters<typeof fitFreeTextBox>
): PdfRect {
  return storedWide(fitFreeTextBox(...args));
}

export type FitMode = "single-line-capped" | "keep-width" | "single-line";

function boxOf([x1, y1, x2, y2]: readonly number[]): Box {
  return [x1!, y1!, x2!, y2!];
}

export type Corner = "tl" | "tr" | "br" | "bl";

export function anchorCorner(
  old: Readonly<PdfRect>,
  [width, height]: readonly [number, number],
  { rotation, corner }: { rotation: number; corner: Corner },
): PdfRect {
  const turn = turnBy(rotation);
  const [oldX, oldY] = centreOf(old);
  const right = corner.includes("r");
  const top = corner.includes("t");
  const [ax, ay] = turn(
    (right ? old[2] : old[0]) - oldX,
    (top ? old[3] : old[1]) - oldY,
  );
  const [cx, cy] = turn(
    ((right ? 1 : -1) * width) / 2,
    ((top ? 1 : -1) * height) / 2,
  );
  const [x, y] = [oldX + ax - cx, oldY + ay - cy];
  return [x - width / 2, y - height / 2, x + width / 2, y + height / 2];
}

function backInside(
  [left, bottom, right, top]: Readonly<PdfRect>,
  pageBox: Readonly<PdfRect>,
): [number, number] {
  const [pageLeft, pageBottom, pageRight, pageTop] = grow(pageBox, -PAGE_INSET);
  const dx =
    left < pageLeft
      ? pageLeft - left
      : right > pageRight
        ? pageRight - right
        : 0;
  const dy =
    bottom < pageBottom
      ? pageBottom - bottom
      : top > pageTop
        ? pageTop - top
        : 0;
  return [dx, dy];
}

export function turnBy(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return (x: number, y: number): [number, number] => [
    x * cos - y * sin,
    x * sin + y * cos,
  ];
}
