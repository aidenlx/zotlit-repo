import type { ReaderDocument } from "#/core/document/document.ts";
import type { ReaderHost } from "#/core/host.ts";
import type { PageView } from "#/core/viewer/viewer.ts";

import { PDFDateString } from "@zotlit/pdfjs/lib";

import { IMAGE_RESOURCES } from "#/core/viewer/viewer.ts";
import { annotationIcons } from "#/generated/images.ts";

export interface PdfAnnotation {
  readonly id: string;
  readonly subtype: string;
  readonly rect: readonly number[];
  readonly quadPoints?: ArrayLike<number> | null;
  readonly contentsObj?: { readonly str?: string } | null;
  readonly titleObj?: { readonly str?: string } | null;
  readonly modificationDate?: string | null;
  readonly creationDate?: string | null;
}

const SPACE_GAP = 0.15;

type Box = readonly [number, number, number, number];

function within(box: Box, x: number, y: number): boolean {
  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
}

function rectBox(rect: readonly number[]): Box {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = rect;
  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ];
}

function quadBoxes(quadPoints: ArrayLike<number>): Box[] {
  const boxes: Box[] = [];
  for (let start = 0; start + 8 <= quadPoints.length; start += 8) {
    const xs = [0, 2, 4, 6].map((offset) => quadPoints[start + offset]!);
    const ys = [1, 3, 5, 7].map((offset) => quadPoints[start + offset]!);
    boxes.push([
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ]);
  }
  return boxes;
}

export function pagePoint(
  view: PageView,
  clientX: number,
  clientY: number,
): readonly [number, number] {
  const { div } = view;
  const bounds = div.getBoundingClientRect();
  const [x = 0, y = 0] = view.viewport.convertToPdfPoint(
    clientX - bounds.left - div.clientLeft,
    clientY - bounds.top - div.clientTop,
  ) as number[];
  return [x, y];
}

export class PageAnnotations {
  #cache = new Map<number, Promise<readonly PdfAnnotation[]>>();

  clear(): void {
    this.#cache = new Map();
  }

  async of(view: PageView): Promise<readonly PdfAnnotation[]> {
    const page = view.pdfPage;
    if (!page) return [];
    let cached = this.#cache.get(view.id - 1);
    if (!cached) {
      cached = page
        .getAnnotations()
        .then((list) => list as unknown as readonly PdfAnnotation[])
        .catch(() => []);
      this.#cache.set(view.id - 1, cached);
    }
    return cached;
  }

  async at(
    view: PageView,
    point: readonly [number, number],
  ): Promise<PdfAnnotation | null> {
    const annotations = (await this.of(view)).filter(
      (annotation) => annotation.subtype !== "Popup",
    );
    const [x, y] = point;
    for (const annotation of annotations.toReversed()) {
      if (
        annotation.quadPoints &&
        quadBoxes(annotation.quadPoints).some((box) => within(box, x, y))
      ) {
        return annotation;
      }
    }
    return (
      annotations
        .toReversed()
        .find((annotation) => within(rectBox(annotation.rect), x, y)) ?? null
    );
  }
}

export async function annotatedText(
  document: ReaderDocument,
  pageIndex: number,
  annotation: PdfAnnotation,
): Promise<string | null> {
  if (!annotation.quadPoints?.length) return null;
  const content = await document.textContent(pageIndex);
  if (!content) return null;
  const parts: string[] = [];
  for (const box of quadBoxes(annotation.quadPoints)) {
    let text = "";
    let previous: { readonly end: number; readonly size: number } | null = null;
    for (const item of content.items) {
      if (!("chars" in item) || !item.chars) continue;
      for (const char of item.chars) {
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = char.rect;
        if (!within(box, (x1 + x2) / 2, (y1 + y2) / 2)) continue;
        const start = Math.min(x1, x2);
        if (previous && start - previous.end > previous.size * SPACE_GAP) {
          text += " ";
        }
        text += char.u;
        previous = { end: Math.max(x1, x2), size: char.fontSize };
      }
    }
    if (text) parts.push(text);
  }
  const joined = parts.join(" ").trim();
  return joined || null;
}

export function annotationDate(annotation: PdfAnnotation): string | null {
  const raw = annotation.modificationDate ?? annotation.creationDate;
  if (!raw) return null;
  const date = PDFDateString.toDateObject(raw);
  return date
    ? date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
}

export function showIcons(div: HTMLElement, t: ReaderHost["t"]): void {
  for (const image of div.querySelectorAll<HTMLImageElement>(
    `.annotationLayer img[src^="${IMAGE_RESOURCES}annotation-"]`,
  )) {
    const name = image.getAttribute("src")!.slice(IMAGE_RESOURCES.length);
    const icon = annotationIcons[name];
    if (icon) image.src = icon;
    const args = JSON.parse(image.getAttribute("data-l10n-args") ?? "{}") as {
      readonly type?: string;
    };
    if (args.type) {
      image.alt = t("pdf_reader_annotation_type", { type: args.type });
    }
  }
}
