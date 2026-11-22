import type { AnnotationPositionRaw } from "#drizzle/schema.ts";
import * as v from "valibot";

const RectSchema = v.tuple([v.number(), v.number(), v.number(), v.number()]);

const PdfInkSchema = v.pipe(
  v.object({
    pageIndex: v.number(),
    width: v.number(),
    paths: v.array(v.array(v.number())),
  }),
  v.transform((o) => ({ kind: "pdf-ink" as const, ...o })),
);
export type PdfInkPosition = v.InferOutput<typeof PdfInkSchema>;

const PdfTextSchema = v.pipe(
  v.object({
    pageIndex: v.number(),
    rects: v.array(RectSchema),
    fontSize: v.number(),
    rotation: v.number(),
  }),
  v.transform((o) => ({ kind: "pdf-text" as const, ...o })),
);
export type PdfTextPosition = v.InferOutput<typeof PdfTextSchema>;

const PdfRectsSchema = v.pipe(
  v.object({
    pageIndex: v.number(),
    rects: v.array(RectSchema),
    nextPageRects: v.optional(v.array(RectSchema)),
  }),
  v.transform((o) => ({ kind: "pdf-rects" as const, ...o })),
);
export type PdfRectsPosition = v.InferOutput<typeof PdfRectsSchema>;

const EpubCfiSchema = v.pipe(
  v.object({
    type: v.literal("FragmentSelector"),
    value: v.string(),
  }),
  v.transform(({ value }) => ({ kind: "epub-cfi" as const, value })),
);
export type EpubCfiPosition = v.InferOutput<typeof EpubCfiSchema>;

const SnapshotCssSchema = v.pipe(
  v.object({
    type: v.literal("CssSelector"),
    value: v.string(),
    refinedBy: v.optional(v.object({ start: v.number(), end: v.number() })),
  }),
  v.transform(({ value, refinedBy }) => ({
    kind: "snapshot-css" as const,
    value,
    ...(refinedBy && { refinedBy }),
  })),
);
export type SnapshotCssPosition = v.InferOutput<typeof SnapshotCssSchema>;

const SnapshotTextSchema = v.pipe(
  v.object({
    type: v.literal("TextPositionSelector"),
    start: v.number(),
    end: v.number(),
  }),
  v.transform(({ start, end }) => ({
    kind: "snapshot-text" as const,
    start,
    end,
  })),
);
export type SnapshotTextPosition = v.InferOutput<typeof SnapshotTextSchema>;

export interface UnknownPosition {
  kind: "unknown";
  raw: unknown;
}

const PdfPositionSchema = v.union([
  PdfTextSchema,
  PdfInkSchema,
  PdfRectsSchema,
]);

const SnapshotPositionSchema = v.union([SnapshotCssSchema, SnapshotTextSchema]);

export type AnnotationPosition =
  | PdfRectsPosition
  | PdfInkPosition
  | PdfTextPosition
  | EpubCfiPosition
  | SnapshotCssPosition
  | SnapshotTextPosition
  | UnknownPosition;

export function parseAnnotationPosition(
  rawPos: AnnotationPositionRaw,
  contentType: string,
): AnnotationPosition {
  const schema = schemaForContentType(contentType);
  if (!schema) return { kind: "unknown", raw: rawPos };

  const result = v.safeParse(schema, rawPos);
  return result.success ? result.output : { kind: "unknown", raw: rawPos };
}

function schemaForContentType(contentType: string) {
  switch (contentType) {
    case "application/pdf":
      return PdfPositionSchema;
    case "application/epub+zip":
      return EpubCfiSchema;
    case "text/html":
    case "application/xhtml+xml":
      return SnapshotPositionSchema;
    default:
      return null;
  }
}
