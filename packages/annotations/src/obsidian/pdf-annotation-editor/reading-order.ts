import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";

interface Seat {
  key: string;
  pageIndex: number;
  top: number;
  left: number;
}

export function readingOrder(
  annotations: readonly AnnotationRecord[],
): string[] {
  return annotations
    .flatMap((annotation) => seatOf(annotation) ?? [])
    .sort(
      (a, b) => a.pageIndex - b.pageIndex || b.top - a.top || a.left - b.left,
    )
    .map(({ key }) => key);
}

export function stepReadingOrder(
  order: readonly string[],
  selected: string | null,
  step: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  const from = selected === null ? -1 : order.indexOf(selected);
  if (from === -1) return (step === 1 ? order.at(0) : order.at(-1)) ?? null;
  return order[(from + step + order.length) % order.length] ?? null;
}

function seatOf({ key, position }: AnnotationRecord): Seat | null {
  switch (position.kind) {
    case "pdf-rects":
    case "pdf-text": {
      const rects = position.rects;
      if (rects.length === 0) return null;
      return {
        key,
        pageIndex: position.pageIndex,
        top: Math.max(...rects.map((rect) => Math.max(rect[1], rect[3]))),
        left: Math.min(...rects.map((rect) => Math.min(rect[0], rect[2]))),
      };
    }
    case "pdf-ink": {
      const points = position.paths.flatMap((path) => path);
      if (points.length < 2) return null;
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      return {
        key,
        pageIndex: position.pageIndex,
        top: Math.max(...ys),
        left: Math.min(...xs),
      };
    }
    default:
      return null;
  }
}
