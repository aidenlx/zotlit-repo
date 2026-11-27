import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";

import type {
  AnnotationPosition,
  PdfInkPosition,
  PdfRectsPosition,
  PdfTextPosition,
} from "@zotlit/db";

import type { Corner, FitMode, TextMeasure } from "./free-text-layout.ts";
import {
  anchorCorner,
  fitStoredTextBox,
  turnAbout,
  turnBy,
  turnedBounds,
} from "./free-text-layout.ts";
import type { Point } from "./hit-test.ts";

import { writePosition } from "#obsidian/annotation-repository/write.ts";

export type Handle = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

export type RangeGrip = "start" | "end";

export type Grip = Handle | "body" | RangeGrip;

export function isRangeGrip(grip: Grip): grip is RangeGrip {
  return grip === "start" || grip === "end";
}

export type PdfPoint = readonly [number, number];

export type EditablePosition =
  | PdfRectsPosition
  | PdfInkPosition
  | PdfTextPosition;

export interface FreeTextContent {
  comment: string;
  measure: TextMeasure;
}

export type PdfRect = [number, number, number, number];

export type TextRotation = (pageIndex: number, rect: PdfRect) => number;

export function isEditablePosition(
  position: AnnotationPosition,
): position is EditablePosition {
  return (
    position.kind === "pdf-rects" ||
    position.kind === "pdf-ink" ||
    position.kind === "pdf-text"
  );
}

export const RANGE_HANDLE_PADDING = 3;

export const MIN_IMAGE_ANNOTATION_SIZE = 10;

export const HANDLE_RADIUS = 5;

export const INK_BOX_PADDING = 5;

export const MIN_TEXT_ANNOTATION_WIDTH = 10;

export const MIN_INK_SIZE = 1;

const PRIORITY: readonly Handle[] = [
  "tr",
  "tl",
  "br",
  "bl",
  "l",
  "r",
  "t",
  "b",
];

export function handleLayout({
  type,
  position,
}: Pick<AnnotationRecord, "type" | "position">): {
  grip: Handle;
  at: PdfPoint;
}[] {
  if (type === "ink" && position.kind === "pdf-ink") {
    const box = inkBox(position);
    if (!box || box[0] === box[2] || box[1] === box[3]) return [];
    const [x1, y1, x2, y2] = pad(box);
    return [
      { grip: "tl", at: [x1, y2] },
      { grip: "tr", at: [x2, y2] },
      { grip: "br", at: [x2, y1] },
      { grip: "bl", at: [x1, y1] },
    ];
  }
  if (type === "text" && position.kind === "pdf-text") {
    const rect = position.rects[0];
    if (!rect) return [];
    const [x1, y1, x2, y2] = pad([rect[0], rect[1], rect[2], rect[3]]);
    const turned = turnAbout([x1, y1, x2, y2], position.rotation);
    const ym = (y1 + y2) / 2;
    return (
      [
        ["tl", [x1, y2]],
        ["tr", [x2, y2]],
        ["br", [x2, y1]],
        ["bl", [x1, y1]],
        ["l", [x1, ym]],
        ["r", [x2, ym]],
      ] as const
    ).map(([grip, at]) => ({ grip, at: turned(at) }));
  }
  if (type !== "image" || position.kind !== "pdf-rects") return [];
  const rect = position.rects[0];
  if (!rect) return [];
  const [x1, y1, x2, y2] = rect;
  const xm = (x1 + x2) / 2;
  const ym = (y1 + y2) / 2;
  return [
    { grip: "tl", at: [x1, y2] },
    { grip: "t", at: [xm, y2] },
    { grip: "tr", at: [x2, y2] },
    { grip: "r", at: [x2, ym] },
    { grip: "br", at: [x2, y1] },
    { grip: "b", at: [xm, y1] },
    { grip: "bl", at: [x1, y1] },
    { grip: "l", at: [x1, ym] },
  ];
}

export function rangeHandles(
  { type, position }: Pick<AnnotationRecord, "type" | "position">,
  padding: number,
  rotationOf: TextRotation,
): { grip: RangeGrip; pageIndex: number; rect: PdfRect; rotation: number }[] {
  if (type !== "highlight" && type !== "underline") return [];
  if (position.kind !== "pdf-rects") return [];
  const first = position.rects[0];
  const spilled = position.nextPageRects?.length
    ? position.nextPageRects
    : undefined;
  const last = (spilled ?? position.rects).at(-1);
  if (!first || !last) return [];
  const handle = (
    grip: RangeGrip,
    pageIndex: number,
    held: readonly number[],
  ) => {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = held;
    const rotation = rotationOf(pageIndex, [x1, y1, x2, y2]);
    const edge = grip === "start" ? rotation : (rotation + 180) % 360;
    const rect: PdfRect =
      edge === 90
        ? [x1, y1 - padding, x2, y1 + padding]
        : edge === 180
          ? [x2 - padding, y1, x2 + padding, y2]
          : edge === 270
            ? [x1, y2 - padding, x2, y2 + padding]
            : [x1 - padding, y1, x1 + padding, y2];
    return { grip, pageIndex, rect, rotation };
  };
  return [
    handle("start", position.pageIndex, first),
    handle("end", position.pageIndex + (spilled ? 1 : 0), last),
  ];
}

export function rangeGripAt(
  handles: readonly { grip: RangeGrip; pageIndex: number; rect: PdfRect }[],
  pointOn: (pageIndex: number) => PdfPoint | null,
): RangeGrip | null {
  for (const { grip, pageIndex, rect } of handles) {
    const point = pointOn(pageIndex);
    if (
      point &&
      point[0] >= rect[0] &&
      point[0] <= rect[2] &&
      point[1] >= rect[1] &&
      point[1] <= rect[3]
    )
      return grip;
  }
  return null;
}

const GEOMETRY_EDITS = {
  highlight: { moves: false, resizes: false },
  underline: { moves: false, resizes: false },
  note: { moves: true, resizes: false },
  text: { moves: true, resizes: true },
  image: { moves: true, resizes: true },
  ink: { moves: true, resizes: true },
  unknown: { moves: false, resizes: false },
} as const satisfies Record<
  AnnotationRecord["type"],
  { moves: boolean; resizes: boolean }
>;

export function movesByBody(type: AnnotationRecord["type"]): boolean {
  return GEOMETRY_EDITS[type].moves;
}

export function resizes(type: AnnotationRecord["type"]): boolean {
  return GEOMETRY_EDITS[type].resizes;
}

export function bodyRect({
  type,
  position,
}: Pick<AnnotationRecord, "type" | "position">): PdfRect | null {
  if (!movesByBody(type)) return null;
  if (position.kind === "pdf-ink") {
    const box = inkBox(position);
    return box && pad(box);
  }
  const rect =
    position.kind === "pdf-rects" || position.kind === "pdf-text"
      ? position.rects[0]
      : undefined;
  if (!rect) return null;
  const box: PdfRect = [rect[0], rect[1], rect[2], rect[3]];
  return position.kind === "pdf-text"
    ? [...turnedBounds(pad(box), position.rotation)]
    : box;
}

export function gripAt({
  handles,
  body,
  point,
  radius,
}: {
  handles: readonly { grip: Handle; at: Point }[];
  body: readonly [number, number, number, number] | null;
  point: Point;
  radius: number;
}): Grip | null {
  for (const grip of PRIORITY) {
    const handle = handles.find((candidate) => candidate.grip === grip);
    if (
      handle &&
      Math.abs(point.x - handle.at.x) <= radius &&
      Math.abs(point.y - handle.at.y) <= radius
    )
      return grip;
  }
  if (!body) return null;
  const [left, top, right, bottom] = body;
  const inside =
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  return inside ? "body" : null;
}

function bodyMoveBounds(position: EditablePosition, box: Readonly<PdfRect>) {
  return position.kind === "pdf-text"
    ? turnedBounds(box, position.rotation)
    : box;
}

export function proposePosition({
  confirmed,
  grip,
  from,
  to,
  viewBox,
  text,
}: {
  confirmed: EditablePosition;
  grip: Grip;
  from: PdfPoint;
  to: PdfPoint;
  viewBox: readonly number[];
  text: FreeTextContent;
}): EditablePosition {
  if (isRangeGrip(grip)) return confirmed;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (confirmed.kind === "pdf-ink")
    return proposeInk(confirmed, { grip, travel: [dx, dy], viewBox });
  const rect = confirmed.rects[0];
  if (!rect) return confirmed;
  const [left = 0, bottom = 0, right = 0, top = 0] = viewBox;
  const [x1, y1, x2, y2] = rect;
  if (grip === "body") {
    const [bx1, by1, bx2, by2] = bodyMoveBounds(confirmed, rect);
    const mx = clamp(dx, left - bx1, right - bx2);
    const my = clamp(dy, bottom - by1, top - by2);
    return { ...confirmed, rects: [[x1 + mx, y1 + my, x2 + mx, y2 + my]] };
  }
  if (confirmed.kind === "pdf-text") {
    const [along] = turnBy(-confirmed.rotation)(dx, dy);
    return resizeText(confirmed, {
      grip,
      along,
      round: Math.floor,
      viewBox,
      text,
    });
  }
  const next: [number, number, number, number] = [x1, y1, x2, y2];
  const min = MIN_IMAGE_ANNOTATION_SIZE;
  if (grip.includes("l")) next[0] = Math.max(Math.min(x1 + dx, x2 - min), left);
  else if (grip.includes("r"))
    next[2] = Math.min(Math.max(x2 + dx, x1 + min), right);
  if (grip.includes("b"))
    next[1] = Math.max(Math.min(y1 + dy, y2 - min), bottom);
  else if (grip.includes("t"))
    next[3] = Math.min(Math.max(y2 + dy, y1 + min), top);
  return { ...confirmed, rects: [next] };
}

export function releasedPosition({
  proposal,
  grip,
  viewBox,
  text,
}: {
  proposal: EditablePosition;
  grip: Grip;
  viewBox: readonly number[];
  text: FreeTextContent;
}): EditablePosition {
  if (proposal.kind !== "pdf-text" || (grip !== "l" && grip !== "r"))
    return proposal;
  return {
    ...proposal,
    rects: [fitText(proposal, { text, viewBox, mode: "single-line" })],
  };
}

export function captureRect({
  from,
  to,
  viewBox,
}: {
  from: PdfPoint;
  to: PdfPoint;
  viewBox: readonly number[];
}): PdfRect {
  const [left = 0, bottom = 0, right = 0, top = 0] = viewBox;
  return [
    Math.max(Math.min(from[0], to[0]), left),
    Math.max(Math.min(from[1], to[1]), bottom),
    Math.min(Math.max(from[0], to[0]), right),
    Math.min(Math.max(from[1], to[1]), top),
  ];
}

export function capturesImage([x1, y1, x2, y2]: readonly number[]): boolean {
  return (
    x2! - x1! >= MIN_IMAGE_ANNOTATION_SIZE &&
    y2! - y1! >= MIN_IMAGE_ANNOTATION_SIZE
  );
}

export type Arrow = "left" | "right" | "up" | "down";

export const KEY_STEP = 5;

export const KEY_PADDING = 5;

export type KeyEdit =
  | { kind: "range"; end: RangeGrip }
  | { kind: "resize" }
  | { kind: "nudge" };

export function keyEdit(
  type: AnnotationRecord["type"],
  { shift, alt, mod }: { shift: boolean; alt: boolean; mod: boolean },
): KeyEdit | null {
  if (type === "highlight" || type === "underline") {
    return shift && !alt ? { kind: "range", end: mod ? "start" : "end" } : null;
  }
  if (!movesByBody(type) || mod || shift === alt) return null;
  if (!shift) return { kind: "nudge" };
  return resizes(type) ? { kind: "resize" } : null;
}

export function keyedPosition({
  confirmed,
  edit,
  arrow,
  viewBox,
  text,
}: {
  confirmed: EditablePosition;
  edit: "resize" | "nudge";
  arrow: Arrow;
  viewBox: readonly number[];
  text: FreeTextContent;
}): { grip: Grip; proposal: EditablePosition } | null {
  const box =
    confirmed.kind === "pdf-ink"
      ? inkBox(confirmed)
      : (confirmed.rects[0] ?? null);
  if (!box) return null;
  const step = KEY_STEP;
  const propose = (grip: Grip, [dx, dy]: PdfPoint) => ({
    grip,
    proposal: proposePosition({
      confirmed,
      grip,
      from: [0, 0],
      to: [dx, dy],
      viewBox,
      text,
    }),
  });
  if (edit === "nudge") {
    const [x1, y1, x2, y2] = bodyMoveBounds(confirmed, box);
    const [left = 0, bottom = 0, right = 0, top = 0] = viewBox;
    const room = step + KEY_PADDING;
    const allowed =
      arrow === "left"
        ? x1 - left >= room
        : arrow === "right"
          ? right - x2 >= room
          : arrow === "down"
            ? y1 - bottom >= room
            : top - y2 >= room;
    if (!allowed) return null;
    const [dx, dy] = ARROW_TRAVEL[arrow];
    return propose("body", [dx * step, dy * step]);
  }
  if (confirmed.kind === "pdf-text") {
    const grip = arrow === "left" || arrow === "right" ? "r" : "br";
    const along = arrow === "left" || arrow === "up" ? -step : step;
    return {
      grip,
      proposal: resizeText(confirmed, {
        grip,
        along,
        round: Math.round,
        viewBox,
        text,
      }),
    };
  }
  if (confirmed.kind === "pdf-ink") {
    const [x1, y1, x2, y2] = box;
    const ratio = (x2 - x1) / (y2 - y1);
    const width =
      arrow === "right"
        ? step
        : arrow === "left"
          ? -step
          : arrow === "down"
            ? step * ratio
            : -step * ratio;
    return propose("br", [width, 0]);
  }
  const [dx, dy] = ARROW_TRAVEL[arrow];
  return arrow === "left" || arrow === "right"
    ? propose("r", [dx * step, 0])
    : propose("b", [0, dy * step]);
}

const ARROW_TRAVEL: Record<Arrow, PdfPoint> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
};

function proposeInk(
  confirmed: PdfInkPosition,
  {
    grip,
    travel: [dx, dy],
    viewBox,
  }: { grip: Grip; travel: PdfPoint; viewBox: readonly number[] },
): PdfInkPosition {
  const box = inkBox(confirmed);
  if (!box) return confirmed;
  const [x1, y1, x2, y2] = box;
  if (grip === "body") {
    const [left = 0, bottom = 0, right = 0, top = 0] = viewBox;
    const mx = clamp(dx, left - x1, right - x2);
    const my = clamp(dy, bottom - y1, top - y2);
    return transformInk(confirmed, [1, 0, 0, 1, mx, my]);
  }
  const width = x2 - x1;
  const height = y2 - y1;
  if (width === 0 || height === 0 || grip.length !== 2) return confirmed;
  const left = grip.includes("l");
  const reached = left ? width - dx : width + dx;
  const scale = Math.max(
    reached / width,
    MIN_INK_SIZE / width,
    MIN_INK_SIZE / height,
  );
  const ax = left ? x2 : x1;
  const ay = grip.includes("b") ? y2 : y1;
  return transformInk(confirmed, [
    scale,
    0,
    0,
    scale,
    ax - ax * scale,
    ay - ay * scale,
  ]);
}

function resizeText(
  confirmed: PdfTextPosition,
  {
    grip,
    along,
    round,
    viewBox,
    text,
  }: {
    grip: Handle;
    along: number;
    round: (value: number) => number;
    viewBox: readonly number[];
    text: FreeTextContent;
  },
): PdfTextPosition {
  const rect = confirmed.rects[0];
  if (!rect) return confirmed;
  const [x1, y1, x2, y2] = rect;
  const width = x2 - x1;
  const reached = Math.max(
    grip.includes("l") ? width - along : width + along,
    MIN_TEXT_ANNOTATION_WIDTH,
  );
  const { rotation, fontSize } = confirmed;
  const old: PdfRect = [x1, y1, x2, y2];
  if (grip.length === 2) {
    const scaled = round(fontSize * (reached / width) * 2) / 2;
    return {
      ...confirmed,
      fontSize: scaled || fontSize,
      rects: [
        anchorCorner(old, [reached, (reached * (y2 - y1)) / width], {
          rotation,
          corner: OPPOSITE[grip as Corner],
        }),
      ],
    };
  }
  const moved = anchorCorner(old, [reached, y2 - y1], {
    rotation,
    corner: grip === "l" ? "br" : "tl",
  });
  const sided = { ...confirmed, rects: [moved] };
  return {
    ...sided,
    rects: [fitText(sided, { text, viewBox, mode: "keep-width" })],
  };
}

const OPPOSITE: Record<Corner, Corner> = {
  tl: "br",
  tr: "bl",
  br: "tl",
  bl: "tr",
};

function fitText(
  position: PdfTextPosition,
  {
    text,
    viewBox,
    mode,
  }: { text: FreeTextContent; viewBox: readonly number[]; mode: FitMode },
): PdfRect {
  return fitStoredTextBox(text.comment, position, {
    measure: text.measure,
    pageBox: viewBox,
    mode,
  });
}

function transformInk(
  position: PdfInkPosition,
  [a, b, c, d, e, f]: readonly [number, number, number, number, number, number],
): PdfInkPosition {
  return {
    ...position,
    paths: position.paths.map((path) => {
      const next: number[] = [];
      for (let index = 0; index + 1 < path.length; index += 2) {
        const x = path[index]!;
        const y = path[index + 1]!;
        next.push(a * x + c * y + e, b * x + d * y + f);
      }
      return next;
    }),
    width: position.width * Math.sqrt(Math.abs(a * d - b * c)),
  };
}

function inkBox({ paths }: PdfInkPosition): PdfRect | null {
  let box: PdfRect | null = null;
  for (const path of paths) {
    for (let index = 0; index + 1 < path.length; index += 2) {
      const x = path[index]!;
      const y = path[index + 1]!;
      box = box
        ? [
            Math.min(box[0], x),
            Math.min(box[1], y),
            Math.max(box[2], x),
            Math.max(box[3], y),
          ]
        : [x, y, x, y];
    }
  }
  return box;
}

function pad([x1, y1, x2, y2]: PdfRect): PdfRect {
  const p = INK_BOX_PADDING;
  return [x1 - p, y1 - p, x2 + p, y2 + p];
}

export function sameGeometry(
  a: EditablePosition,
  b: EditablePosition,
): boolean {
  return writePosition(a) === writePosition(b);
}

export function gripCursor(grip: Grip, rotation: number): string {
  if (grip === "body") return "move";
  const turned = rotation % 180 !== 0;
  if (isRangeGrip(grip)) return turned ? "ns-resize" : "ew-resize";
  if (grip.length === 1) {
    const horizontal = grip === "l" || grip === "r";
    return horizontal !== turned ? "ew-resize" : "ns-resize";
  }
  const falling = grip === "tl" || grip === "br";
  return falling !== turned ? "nwse-resize" : "nesw-resize";
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
