import { nearStroke } from "./ink-path.ts";
import type { MarkTarget, PageRect } from "./render.ts";

export const CLICK_SLOP = 4;

export const HIT_PAD = 2;

export interface Point {
  x: number;
  y: number;
}

export interface PageBox {
  left: number;
  top: number;
  width: number;
  height: number;
  unitWidth: number;
  unitHeight: number;
}

export interface PagePoint {
  point: Point;
  pad: number;
}

export interface HitPage {
  index: number;
  targets: readonly MarkTarget[];
  at: PagePoint;
}

export interface MarkSelectionPoint {
  key: string;
  pageIndex: number;
  point: Point;
}

export interface MarkClickInput {
  page: HitPage | null;
  travel: number;
  collapsed: boolean;
  onLink: boolean;
  altKey: boolean;
  previous: MarkSelectionPoint | null;
}

export type MarkClick =
  | { kind: "ignore" }
  | { kind: "deselect" }
  | { kind: "select"; key: string; stack: readonly string[] };

export function resolveMarkClick({
  page,
  travel,
  collapsed,
  onLink,
  altKey,
  previous,
}: MarkClickInput): MarkClick {
  if (travel >= CLICK_SLOP || !collapsed) return { kind: "ignore" };
  if (onLink && !altKey) return { kind: "ignore" };
  if (!page) return { kind: "deselect" };

  const hits = marksAtPoint(page.targets, page.at);
  if (hits.length === 0) return { kind: "deselect" };

  const repeat =
    previous !== null &&
    previous.pageIndex === page.index &&
    within(previous.point, page.at);
  const from = repeat ? hits.indexOf(previous.key) : -1;
  return { kind: "select", key: hits[(from + 1) % hits.length]!, stack: hits };
}

export function marksAtPoint(
  targets: readonly MarkTarget[],
  { point, pad }: PagePoint,
): string[] {
  return targets
    .flatMap((target) =>
      hitsTarget(target, point, pad)
        ? [{ key: target.key, area: areaOf(target.rects) }]
        : [],
    )
    .sort((a, b) => a.area - b.area)
    .map(({ key }) => key);
}

export function pagePointOf(box: PageBox, client: Point): PagePoint | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const scaleX = box.unitWidth / box.width;
  const scaleY = box.unitHeight / box.height;
  const point = {
    x: (client.x - box.left) * scaleX,
    y: (client.y - box.top) * scaleY,
  };
  const pad = HIT_PAD * Math.max(scaleX, scaleY);
  const outside =
    point.x < -pad ||
    point.y < -pad ||
    point.x > box.unitWidth + pad ||
    point.y > box.unitHeight + pad;
  return outside ? null : { point, pad };
}

export function markAnchor(
  rects: readonly PageRect[],
  box: PageBox,
): Point | null {
  if (rects.length === 0 || box.width <= 0 || box.height <= 0) return null;
  const left = Math.min(...rects.map((rect) => rect[0]));
  const right = Math.max(...rects.map((rect) => rect[2]));
  const bottom = Math.max(...rects.map((rect) => rect[3]));
  return {
    x: box.left + (((left + right) / 2) * box.width) / box.unitWidth,
    y: box.top + (bottom * box.height) / box.unitHeight,
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function within(point: Point, { point: at, pad }: PagePoint): boolean {
  return distance(point, at) <= pad;
}

function hitsTarget(
  { rects, ink }: MarkTarget,
  point: Point,
  pad: number,
): boolean {
  if (!ink) return rects.some((rect) => covers(rect, point, pad));
  return (
    rects.some((rect) => covers(rect, point, ink.reach)) &&
    nearStroke([point.x, point.y], ink.paths, ink.reach)
  );
}

function covers(
  [left, top, right, bottom]: PageRect,
  point: Point,
  pad: number,
): boolean {
  return (
    point.x >= left - pad &&
    point.x <= right + pad &&
    point.y >= top - pad &&
    point.y <= bottom + pad
  );
}

function areaOf(rects: readonly PageRect[]): number {
  return rects.reduce(
    (total, [left, top, right, bottom]) =>
      total + (right - left) * (bottom - top),
    0,
  );
}
