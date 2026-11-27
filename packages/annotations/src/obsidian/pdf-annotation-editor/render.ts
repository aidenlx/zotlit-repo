import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import type { InkPosition } from "#obsidian/annotation-repository/write.ts";

import type {
  PdfInkPosition,
  PdfRectsPosition,
  PdfTextPosition,
} from "@zotlit/db";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import type { PageViewport } from "@zotlit/reader-api";

import type {
  PagePoint,
  PageRect,
  TextMeasure,
  Turn,
} from "./free-text-layout.ts";
import {
  freeTextLayout,
  freeTextLines,
  LINE_HEIGHT,
} from "./free-text-layout.ts";
import type { Grip, PdfPoint, TextRotation } from "./geometry-edit.ts";
import {
  capturesImage,
  gripCursor,
  HANDLE_RADIUS,
  handleLayout,
  movesByBody,
  RANGE_HANDLE_PADDING,
  rangeHandles,
} from "./geometry-edit.ts";
import type { Point } from "./hit-test.ts";
import { inkReach } from "./ink-path.ts";
import type { LiveStroke, PendingStroke } from "./reader-surface-state.ts";

import { unionOutlinePath } from "#core/pdf-annotation-editor/rect-union-outline.ts";
import "./style.css";

const SVG_NS = "http://www.w3.org/2000/svg";

const SELECTED_CLASS = "is-selected";

const SELECTION_OUTLINE_PADDING = 1.5;

type PdfPosition = PdfRectsPosition | PdfInkPosition | PdfTextPosition;

type PdfRect = PdfRectsPosition["rects"][number];

export interface PdfPageAnnotation {
  annotation: AnnotationRecord;
  position: PdfPosition;
  rects: readonly PdfRect[];
}

export function groupAnnotationsByPage(
  annotations: readonly AnnotationRecord[],
): ReadonlyMap<number, readonly PdfPageAnnotation[]> {
  const placements = annotations.flatMap((annotation): PdfPagePlacement[] => {
    const { position } = annotation;
    switch (position.kind) {
      case "pdf-ink":
      case "pdf-text":
        return [
          { pageIndex: position.pageIndex, annotation, position, rects: [] },
        ];
      case "pdf-rects": {
        const { pageIndex, rects, nextPageRects } = position;
        const placement = { annotation, position };
        return nextPageRects?.length
          ? [
              { ...placement, pageIndex, rects },
              { ...placement, pageIndex: pageIndex + 1, rects: nextPageRects },
            ]
          : [{ ...placement, pageIndex, rects }];
      }
      default:
        return [];
    }
  });
  return Map.groupBy(placements, (placement) => placement.pageIndex);
}

export type OverlayPageView = { div: HTMLElement } & {
  viewport: Pick<
    PageViewport,
    | "width"
    | "height"
    | "scale"
    | "rotation"
    | "userUnit"
    | "viewBox"
    | "transform"
    | "convertToViewportPoint"
  > &
    Partial<Pick<PageViewport, "clone">>;
};

export interface AnnotationOverlayOptions {
  annotations: readonly PdfPageAnnotation[];
  pending?: readonly PendingStroke[];
  selected?: ReadonlySet<string>;
  handles?: boolean;
  textRotation?: TextRotation;
  font: MeasuredFont;
}

const UPRIGHT: TextRotation = () => 0;

export function renderAnnotationOverlay(
  page: OverlayPageView,
  {
    annotations,
    pending = [],
    selected,
    handles = false,
    textRotation = UPRIGHT,
    font,
  }: AnnotationOverlayOptions,
): void {
  page.div.querySelector(`.${themeHook.pdfAnnotationOverlay}`)?.remove();

  const unitPage = drawingPageOf(page, font);
  const overlay = createOverlay(unitPage);

  for (const stroke of pending) {
    const element = inkStroke(unitPage, stroke);
    element.classList.add(themeHook.pdfPendingStroke);
    overlay.append(element);
  }

  for (const placement of annotations) {
    const { annotation } = placement;
    for (const mark of markNodes(
      unitPage,
      placement,
      handles && selected?.has(annotation.key) === true,
    )) {
      mark.classList.toggle(
        SELECTED_CLASS,
        selected?.has(annotation.key) === true,
      );
      overlay.append(mark);
    }
  }

  for (const placement of annotations) {
    if (selected?.has(placement.annotation.key) !== true) continue;
    const outline = renderSelectionOutline(unitPage, placement);
    if (!outline) continue;
    if (isInk(placement)) overlay.prepend(outline);
    else overlay.append(outline);
  }

  for (const placement of annotations) {
    if (!handles || selected?.has(placement.annotation.key) !== true) continue;
    overlay.append(...renderHandles(page, placement, textRotation));
  }

  if (overlay.childElementCount > 0) page.div.append(overlay);
}

function createOverlay(unitPage: OverlayPage): SVGSVGElement {
  const overlay = unitPage.document.createElementNS(SVG_NS, "svg");
  overlay.classList.add(themeHook.pdfAnnotationOverlay);
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute(
    "viewBox",
    `0 0 ${unitPage.viewport.width} ${unitPage.viewport.height}`,
  );
  overlay.setAttribute("preserveAspectRatio", "none");
  return overlay;
}

export function renderCapture(
  page: OverlayPageView,
  capture: { rect: PdfRect; color: string } | null,
): void {
  const held = page.div.querySelector(`.${themeHook.pdfAnnotationOverlay}`);
  held?.querySelector(`.${themeHook.pdfCaptureRect}`)?.remove();
  if (!capture) {
    if (held?.childElementCount === 0) held.remove();
    return;
  }
  const unitPage = toPageUnits(page);
  const overlay = held ?? page.div.appendChild(createOverlay(unitPage));
  const element = createRect(
    unitPage,
    pdfRectToPage(unitPage.viewport, capture.rect),
  );
  element.classList.add(themeHook.pdfCaptureRect);
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", capture.color);
  element.setAttribute("stroke-width", "3");
  element.setAttribute("vector-effect", "non-scaling-stroke");
  element.setAttribute("opacity", capturesImage(capture.rect) ? "1" : "0.2");
  overlay.append(element);
}

export function renderLiveStroke(
  page: OverlayPageView,
  stroke: Omit<LiveStroke, "pageIndex"> | null,
): void {
  const held = page.div.querySelector(`.${themeHook.pdfAnnotationOverlay}`);
  const drawn = held?.querySelector(`.${themeHook.pdfLiveStroke}`);
  if (!stroke) {
    drawn?.remove();
    if (held?.childElementCount === 0) held.remove();
    return;
  }
  const unitPage = toPageUnits(page);
  const fresh = inkStroke(unitPage, stroke);
  if (drawn) {
    for (const { name, value } of fresh.attributes)
      drawn.setAttribute(name, value);
    return;
  }
  fresh.classList.add(themeHook.pdfLiveStroke);
  const overlay = held ?? page.div.appendChild(createOverlay(unitPage));
  overlay.append(fresh);
}

export function patchSelectedMark(
  page: OverlayPageView,
  placement: PdfPageAnnotation,
  {
    handles,
    textRotation = UPRIGHT,
    font,
  }: Pick<AnnotationOverlayOptions, "textRotation" | "font"> & {
    handles: boolean;
  },
): boolean {
  const overlay = page.div.querySelector(`.${themeHook.pdfAnnotationOverlay}`);
  if (!overlay) return false;
  const unitPage = drawingPageOf(page, font);
  const { key } = placement.annotation;
  const held = [
    ...[
      ...overlay.querySelectorAll<SVGElement>(
        `.${themeHook.pdfAnnotationMark}`,
      ),
    ].filter((mark) => mark.dataset.zoteroAnnotationKey === key),
    ...overlay.querySelectorAll<SVGElement>(
      `.${themeHook.pdfAnnotationSelectionOutline}`,
    ),
    ...overlay.querySelectorAll<SVGElement>(
      `.${themeHook.pdfAnnotationHandle}`,
    ),
  ];
  const outline = renderSelectionOutline(unitPage, placement);
  const fresh = [
    ...markNodes(unitPage, placement, handles).map((mark) => {
      mark.classList.add(SELECTED_CLASS);
      return mark;
    }),
    ...(outline ? [outline] : []),
    ...(handles ? renderHandles(page, placement, textRotation) : []),
  ];
  if (held.length === 0 || held.length !== fresh.length) return false;
  held.forEach((node, index) => mirrorNode(node, fresh[index]!));
  return true;
}

function mirrorNode(node: Element, fresh: Element): void {
  for (const name of node.getAttributeNames()) {
    if (!fresh.hasAttribute(name)) node.removeAttribute(name);
  }
  for (const { name, value } of fresh.attributes)
    node.setAttribute(name, value);
  node.replaceChildren(...fresh.childNodes);
}

function markNodes(
  page: DrawingPage,
  placement: PdfPageAnnotation,
  handles: boolean,
): SVGElement[] {
  const { annotation } = placement;
  const grips = handles && movesByBody(annotation.type);
  return marksFor(page, placement).map((mark) => {
    mark.classList.add(themeHook.pdfAnnotationMark);
    mark.dataset.zoteroAnnotationKey = annotation.key;
    mark.dataset.zoteroAnnotationType = annotation.type;
    if (grips) {
      mark.dataset.ztGrip = "body";
      mark.dataset.ztCursor = gripCursor("body", page.viewport.rotation);
    }
    return mark;
  });
}

function renderHandles(
  view: OverlayPageView,
  placement: PdfPageAnnotation,
  textRotation: TextRotation,
): SVGRectElement[] {
  const page = toPageUnits(view);
  const toUnits = unitsPerPixel(view);
  const half = HANDLE_RADIUS * toUnits;
  const handle = (grip: Grip, rect: PageRect, turn = 0) => {
    const element = createRect(page, rect);
    element.classList.add(themeHook.pdfAnnotationHandle);
    element.setAttribute("vector-effect", "non-scaling-stroke");
    element.dataset.ztGrip = grip;
    element.dataset.ztCursor = gripCursor(grip, page.viewport.rotation + turn);
    return element;
  };
  const { annotation, position } = placement;
  const onPage =
    position.kind === "pdf-rects" && placement.rects === position.nextPageRects
      ? position.pageIndex + 1
      : position.pageIndex;
  const strips = rangeHandles(
    annotation,
    RANGE_HANDLE_PADDING * toUnits,
    textRotation,
  )
    .filter(({ pageIndex }) => pageIndex === onPage)
    .map(({ grip, rect, rotation }) =>
      handle(grip, pdfRectToPage(page.viewport, rect), rotation),
    );
  return [
    ...strips,
    ...handleLayout(annotation).map(({ grip, at }) => {
      const { x, y } = unitPointOf(view, at);
      const element = handle(grip, [x - half, y - half, x + half, y + half]);
      if (position.kind === "pdf-text" && position.rotation % 360 !== 0)
        element.dataset.ztCursor = "move";
      return element;
    }),
  ];
}

export function scrollMarkIntoView(
  page: OverlayPageView,
  annotationKey: string,
): void {
  const marks = page.div.querySelectorAll<SVGElement>(
    `.${themeHook.pdfAnnotationMark}`,
  );
  for (const mark of marks) {
    if (mark.dataset.zoteroAnnotationKey !== annotationKey) continue;
    mark.scrollIntoView({ block: "center", inline: "nearest" });
    return;
  }
}

export function withPosition(
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>,
  key: string,
  position: PdfPageAnnotation["position"],
): ReadonlyMap<number, readonly PdfPageAnnotation[]> {
  const annotation = [...marks.values()]
    .flat()
    .find((placement) => placement.annotation.key === key)?.annotation;
  if (!annotation) return marks;
  const moved = groupAnnotationsByPage([{ ...annotation, position }]);
  const next = new Map<number, readonly PdfPageAnnotation[]>();
  for (const [pageIndex, placements] of marks) {
    const [replacement] = moved.get(pageIndex) ?? [];
    next.set(
      pageIndex,
      placements.flatMap((placement) =>
        placement.annotation.key !== key
          ? [placement]
          : replacement
            ? [replacement]
            : [],
      ),
    );
  }
  for (const [pageIndex, placements] of moved) {
    if (!marks.get(pageIndex)?.some(({ annotation: held }) => held.key === key))
      next.set(pageIndex, [...(next.get(pageIndex) ?? []), ...placements]);
  }
  return next;
}

export interface MarkTarget {
  key: string;
  rects: readonly PageRect[];
  ink?: { paths: readonly (readonly PagePoint[])[]; reach: number };
}

export function markTargets(
  page: OverlayPageView,
  annotations: readonly PdfPageAnnotation[],
): MarkTarget[] {
  const unitPage = toPageUnits(page);
  return annotations.flatMap((placement): MarkTarget[] => {
    if (isInk(placement)) {
      const target = inkTarget(unitPage, placement);
      return target ? [target] : [];
    }
    const rects = hitRectsOf(unitPage, placement);
    return rects.length === 0 ? [] : [{ key: placement.annotation.key, rects }];
  });
}

function inkTarget(
  page: OverlayPage,
  { annotation, position }: PdfPageAnnotation & { position: PdfInkPosition },
): MarkTarget | null {
  const paths = position.paths.map((path) => pagePoints(page, path));
  const points = paths.flat();
  if (points.length === 0) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const width = position.width * page.unitsPerPdfPoint;
  const spill = width / 2;
  return {
    key: annotation.key,
    rects: [
      [
        Math.min(...xs) - spill,
        Math.min(...ys) - spill,
        Math.max(...xs) + spill,
        Math.max(...ys) + spill,
      ],
    ],
    ink: { paths, reach: inkReach(width) },
  };
}

export function unitPointOf(view: OverlayPageView, [x, y]: PdfPoint): Point {
  const [px, py] = viewportPoint(toPageUnits(view).viewport, x, y);
  return { x: px, y: py };
}

export function unitsPerPixel(view: OverlayPageView): number {
  return pageUnitSize(view).width / view.viewport.width;
}

export function pixelsPerPdfPoint(view: OverlayPageView): number {
  const page = toPageUnits(view);
  return (view.viewport.width / page.viewport.width) * page.unitsPerPdfPoint;
}

export function pageUnitSize(page: OverlayPageView): {
  width: number;
  height: number;
} {
  const { viewport } = toPageUnits(page);
  return { width: viewport.width, height: viewport.height };
}

function renderSelectionOutline(
  page: OverlayPage,
  placement: PdfPageAnnotation,
): SVGPathElement | undefined {
  if (isInk(placement)) return renderInkCasing(page, placement.position);

  const { position } = placement;
  const ring =
    position.kind === "pdf-text" ? layoutOf(page, position).ring : undefined;

  const d = ring
    ? unionOutlinePath([ring.rect], 0)
    : unionOutlinePath(hitRectsOf(page, placement), SELECTION_OUTLINE_PADDING);
  if (d.length === 0) return undefined;

  const element = page.document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", d);
  const turn = ring && transformOf(ring.turns);
  if (turn !== undefined && turn !== "") {
    element.setAttribute("transform", turn);
  }
  element.setAttribute("fill", "none");
  element.setAttribute("stroke-linejoin", "round");
  element.setAttribute("vector-effect", "non-scaling-stroke");
  element.classList.add(themeHook.pdfAnnotationSelectionOutline);
  return element;
}

function renderInkCasing(
  page: OverlayPage,
  position: PdfInkPosition,
): SVGPathElement {
  const element = page.document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", inkPathOf(page, position));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  element.style.strokeWidth = String(
    position.width * page.unitsPerPdfPoint + 2 * SELECTION_OUTLINE_PADDING,
  );
  element.classList.add(themeHook.pdfAnnotationSelectionOutline);
  return element;
}

function isInk(
  placement: PdfPageAnnotation,
): placement is PdfPageAnnotation & { position: PdfInkPosition } {
  return placement.rects.length === 0 && placement.position.kind === "pdf-ink";
}

function pagePoints(page: OverlayPage, path: readonly number[]): PagePoint[] {
  const points: PagePoint[] = [];
  for (let index = 0; index + 1 < path.length; index += 2) {
    const [x, y] = viewportPoint(page.viewport, path[index]!, path[index + 1]!);
    points.push([x, y]);
  }
  return points;
}

function layoutOf(page: OverlayPage, position: PdfTextPosition) {
  return freeTextLayout(
    (x, y) => {
      const [left, top] = viewportPoint(page.viewport, x, y);
      return [left, top];
    },
    position,
    SELECTION_OUTLINE_PADDING,
  );
}

function hitRectsOf(
  page: OverlayPage,
  { position, rects }: PdfPageAnnotation,
): PageRect[] {
  if (rects.length > 0) {
    return rects.map((rect) => pdfRectToPage(page.viewport, rect));
  }
  return position.kind === "pdf-text" && position.rects[0]
    ? [layoutOf(page, position).hit]
    : [];
}

interface PdfPagePlacement extends PdfPageAnnotation {
  pageIndex: number;
}

function marksFor(
  page: DrawingPage,
  { annotation, position, rects }: PdfPageAnnotation,
): SVGElement[] {
  switch (annotation.type) {
    case "highlight":
      return rects.map((rect) => renderHighlight(page, annotation, rect));
    case "underline":
      return rects.map((rect) => renderUnderline(page, annotation, rect));
    case "note":
      return rects[0] ? [renderNote(page, annotation, rects[0])] : [];
    case "image":
      return rects[0] ? [renderImage(page, annotation, rects[0])] : [];
    case "ink":
      return position.kind === "pdf-ink"
        ? [renderInk(page, annotation, position)]
        : [];
    case "text":
      return position.kind === "pdf-text" && position.rects.length > 0
        ? [renderText(page, annotation, position)]
        : [];
    default:
      return [];
  }
}

function renderHighlight(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGRectElement {
  const element = createRect(page, pdfRectToPage(page.viewport, rect));
  element.classList.add(themeHook.pdfAnnotationHighlight);
  element.setAttribute("fill", colorOf(annotation));
  return element;
}

function renderUnderline(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGLineElement {
  const [left, , right, bottom] = pdfRectToPage(page.viewport, rect);
  const element = page.document.createElementNS(SVG_NS, "line");
  element.setAttribute("x1", String(left));
  element.setAttribute("y1", String(bottom));
  element.setAttribute("x2", String(right));
  element.setAttribute("y2", String(bottom));
  element.setAttribute("stroke", colorOf(annotation));
  element.setAttribute("stroke-width", "1");
  return element;
}

function renderNote(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGGElement {
  const [left, top, right, bottom] = pdfRectToPage(page.viewport, rect);
  const width = right - left;
  const height = bottom - top;
  const group = page.document.createElementNS(SVG_NS, "g");
  group.setAttribute(
    "transform",
    `translate(${left} ${top}) scale(${width / 24} ${height / 24})`,
  );
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", colorOf(annotation));
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");
  group.classList.add(themeHook.pdfAnnotationNoteIcon);

  const body = page.document.createElementNS(SVG_NS, "path");
  body.setAttribute(
    "d",
    "M 6 3.5 H 18 A 2.5 2.5 0 0 1 20.5 6 V 13.5 L 13.5 20.5 H 6 A 2.5 2.5 0 0 1 3.5 18 V 6 A 2.5 2.5 0 0 1 6 3.5 Z",
  );
  body.setAttribute("fill", colorOf(annotation));
  body.setAttribute("vector-effect", "non-scaling-stroke");
  body.classList.add(themeHook.pdfAnnotationNoteFill);

  const crease = page.document.createElementNS(SVG_NS, "path");
  crease.setAttribute("d", "M 13.5 13.5 H 20.5 M 13.5 13.5 V 20.5");
  crease.setAttribute("vector-effect", "non-scaling-stroke");
  crease.classList.add(themeHook.pdfAnnotationNoteCrease);

  group.append(body, crease);
  return group;
}

function renderImage(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGRectElement {
  const element = createRect(page, pdfRectToPage(page.viewport, rect));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", colorOf(annotation));
  element.setAttribute("stroke-width", "3");
  return element;
}

function renderInk(
  page: OverlayPage,
  annotation: AnnotationRecord,
  position: PdfInkPosition,
): SVGPathElement {
  return inkStroke(page, { ...position, color: colorOf(annotation) });
}

function inkStroke(
  page: OverlayPage,
  { paths, width, color }: Omit<InkPosition, "pageIndex"> & { color: string },
): SVGPathElement {
  const element = page.document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", inkPathOf(page, { paths }));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", darken(color));
  element.setAttribute("stroke-width", String(width * page.unitsPerPdfPoint));
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  return element;
}

function inkPathOf(
  page: OverlayPage,
  position: Pick<InkPosition, "paths">,
): string {
  return position.paths
    .map((path) =>
      pagePoints(page, path)
        .map(
          ([x, y], index) => `${index === 0 ? `M ${x} ${y} ` : ""}L ${x} ${y}`,
        )
        .join(" "),
    )
    .join(" ");
}

const INK_AND_TEXT_DARKEN_PERCENT = 5;

export function darken(color: string): string {
  if (!/^#[\da-f]{6}$/i.test(color)) return color;
  const channels = [1, 3, 5].map((start) =>
    Math.round(
      Number.parseInt(color.slice(start, start + 2), 16) *
        (1 - INK_AND_TEXT_DARKEN_PERCENT / 100),
    ),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function renderText(
  page: DrawingPage,
  annotation: AnnotationRecord,
  position: PdfTextPosition,
): SVGTextElement {
  const { family, measure } = page.font;
  const element = page.document.createElementNS(SVG_NS, "text");
  const { baseline, turns } = layoutOf(page, position);
  const [left, , right] = position.rects[0]!;
  const lines = freeTextLines(freeTextOf(annotation), Math.abs(right - left), {
    fontSize: position.fontSize,
    measure,
  });
  const fontSize = position.fontSize * page.unitsPerPdfPoint;
  element.setAttribute("x", String(baseline[0]));
  element.setAttribute("y", String(baseline[1]));
  element.setAttribute("fill", darken(colorOf(annotation)));
  element.setAttribute("font-size", String(fontSize));
  element.setAttribute("font-family", family);
  element.setAttribute("font-weight", "normal");
  element.setAttribute("font-style", "normal");
  element.setAttribute("letter-spacing", "0");
  const turn = transformOf(turns);
  if (turn !== undefined) element.setAttribute("transform", turn);
  element.append(
    ...lines.map((line, index) => {
      const tspan = page.document.createElementNS(SVG_NS, "tspan");
      tspan.setAttribute("x", String(baseline[0]));
      tspan.setAttribute(
        "y",
        String(baseline[1] + index * LINE_HEIGHT * fontSize),
      );
      tspan.textContent = line;
      return tspan;
    }),
  );
  return element;
}

export function freeTextOf({
  comment,
  text,
}: Pick<AnnotationRecord, "comment" | "text">): string {
  return comment ?? text ?? "";
}

export interface MeasuredFont {
  family: string;
  measure: TextMeasure;
}

const measureContexts = new WeakMap<Document, CanvasRenderingContext2D>();

export function interfaceFont(window_: Window): MeasuredFont {
  const document_ = window_.document;
  const { fontFamily: family } = window_.getComputedStyle(document_.body);
  return {
    family,
    measure: (text, fontSize) => {
      let context = measureContexts.get(document_);
      if (!context) {
        const created = document_.win.createEl("canvas").getContext("2d");
        if (!created) throw new Error("No 2D canvas to measure text with");
        context = created;
        measureContexts.set(document_, context);
      }
      context.font = `${fontSize}px ${family}`;
      return context.measureText(text).width;
    },
  };
}

function transformOf(turns: readonly Turn[]): string | undefined {
  if (turns.length === 0) return undefined;
  return turns
    .map(({ angle, pivot: [x, y] }) => `rotate(${angle} ${x} ${y})`)
    .join(" ");
}

function createRect(
  page: OverlayPage,
  [left, top, right, bottom]: PageRect,
): SVGRectElement {
  const element = page.document.createElementNS(SVG_NS, "rect");
  element.setAttribute("x", String(left));
  element.setAttribute("y", String(top));
  element.setAttribute("width", String(right - left));
  element.setAttribute("height", String(bottom - top));
  return element;
}

function colorOf(annotation: AnnotationRecord): string {
  return annotation.color ?? "currentColor";
}

export type { PageRect } from "./free-text-layout.ts";

function viewportPoint(
  viewport: Pick<PageViewport, "convertToViewportPoint">,
  x: number,
  y: number,
): [number, number] {
  const point = viewport.convertToViewportPoint(x, y);
  return [point[0]!, point[1]!];
}

interface OverlayPage {
  document: Document;
  unitsPerPdfPoint: number;
  viewport: Pick<
    PageViewport,
    "width" | "height" | "rotation" | "convertToViewportPoint"
  >;
}

interface DrawingPage extends OverlayPage {
  font: MeasuredFont;
}

function drawingPageOf(page: OverlayPageView, font: MeasuredFont): DrawingPage {
  return { ...toPageUnits(page), font };
}

function toPageUnits(page: OverlayPageView): OverlayPage {
  const document_ = page.div.ownerDocument;
  const { viewport } = page;
  const base = viewport.clone?.({ scale: 1 });
  if (base)
    return {
      document: document_,
      viewport: base,
      unitsPerPdfPoint: base.userUnit,
    };

  const total = viewport.scale * viewport.userUnit;
  return {
    document: document_,
    unitsPerPdfPoint: 1,
    viewport: {
      width: viewport.width / total,
      height: viewport.height / total,
      rotation: viewport.rotation,
      convertToViewportPoint(x, y) {
        const [pointX, pointY] = viewportPoint(viewport, x, y);
        return [pointX / total, pointY / total];
      },
    },
  };
}

function pdfRectToPage(
  viewport: OverlayPage["viewport"],
  rect: PdfRect,
): PageRect {
  const [x1, y2] = viewportPoint(viewport, rect[0], rect[1]);
  const [x2, y1] = viewportPoint(viewport, rect[2], rect[3]);
  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ];
}
