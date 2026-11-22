import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";

import type { ParsedAnnotationSubpath } from "@zotlit/db";
import type { AttachmentResolution } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";

import type { PdfPageAnnotation } from "./render.ts";

export type MarkLandingMiss =
  | "attachment-pending"
  | "attachment-unknown"
  | "annotations-pending"
  | "annotation-unknown"
  | "annotation-unplaced";

export interface MarkLandingTarget {
  annotationKey: string;
  pageIndex: number;
}

export type MarkLanding =
  | { kind: "drop" }
  | { kind: "page"; reason: MarkLandingMiss }
  | ({ kind: "wait" } & MarkLandingTarget)
  | ({ kind: "select" } & MarkLandingTarget);

export interface MarkLandingInput {
  anchor: ParsedAnnotationSubpath;
  attachment: AttachmentResolution;
  read: boolean;
  records: readonly AnnotationRecord[];
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>;
  rendered: ReadonlySet<number>;
}

export function decideMarkLanding({
  anchor,
  attachment,
  read,
  records,
  marks,
  rendered,
}: MarkLandingInput): MarkLanding {
  const annotationKey = anchor.annotation;
  if (annotationKey === null) return { kind: "drop" };
  if (attachment.kind === "pending")
    return { kind: "page", reason: "attachment-pending" };
  if (attachment.kind !== "resolved")
    return { kind: "page", reason: "attachment-unknown" };
  if (!read) return { kind: "page", reason: "annotations-pending" };

  const pageIndex = firstPageOf(marks, annotationKey);
  if (pageIndex === null) {
    return {
      kind: "page",
      reason: records.some((record) => record.key === annotationKey)
        ? "annotation-unplaced"
        : "annotation-unknown",
    };
  }
  return rendered.has(pageIndex)
    ? { kind: "select", annotationKey, pageIndex }
    : { kind: "wait", annotationKey, pageIndex };
}

function firstPageOf(
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>,
  annotationKey: string,
): number | null {
  let first: number | null = null;
  for (const [pageIndex, annotations] of marks) {
    if (!annotations.some(({ annotation }) => annotation.key === annotationKey))
      continue;
    if (first === null || pageIndex < first) first = pageIndex;
  }
  return first;
}
