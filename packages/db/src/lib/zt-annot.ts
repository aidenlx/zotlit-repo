import type { AnnotationPositionRaw } from "#drizzle/schema.ts";

import { logLibrary } from "@zotlit/shared/logging";

import type { TagType } from "./zt-tag.ts";

const ANNOT_TYPE = {
  1: "highlight",
  2: "note",
  3: "image",
  4: "ink",
  5: "underline",
  6: "text",
} as const;

export type AnnotationType = keyof typeof ANNOT_TYPE;
export type AnnotationTypeName = (typeof ANNOT_TYPE)[AnnotationType];
/**
 * A resolved annotation type name: one Zotero declares, or `"unknown"` for a
 * type id Zotero added after this mapping was written.
 */
export type ResolvedAnnotationTypeName =
  /** Text marked with a highlight color. */
  | "highlight"
  /** A note pinned to a spot on the page. */
  | "note"
  /** A rectangular area selection, saved with an excerpt image. */
  | "image"
  /** A freehand drawing, saved with an excerpt image. */
  | "ink"
  /** Underlined text. */
  | "underline"
  /** Free text typed onto the page. */
  | "text"
  /** A type id Zotero added after this mapping was written. */
  | "unknown";

type Expect<T extends true> = T;
type Equals<A, B> = [A, B] extends [B, A] ? true : false;

type _ResolvedNameStaysDerived = Expect<
  Equals<ResolvedAnnotationTypeName, AnnotationTypeName | "unknown">
>;

export interface Annotation {
  groupID: number | null;
  itemID: number;
  key: string;
  indexedKey: string;
  libraryID: number;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;
  version: number;
  type: AnnotationType;
  text: string | null;
  comment: string | null;
  color: string | null;
  pageLabel: string | null;
  tags: string[];
  tagDetails?: { name: string; type: TagType }[];
  sortIndex: string;
  position: AnnotationPositionRaw;
  authorName: string | null;
  isExternal: boolean;
  createdByUserID: number | null;
  parentItemID: number;
  parentKey: string;
}

export function annotationTypeIDs(): readonly AnnotationType[] {
  return Object.keys(ANNOT_TYPE).map(Number) as AnnotationType[];
}

export function annotationTypeToName(
  type: AnnotationType,
): ResolvedAnnotationTypeName {
  const name = ANNOT_TYPE[type];
  if (name) return name;

  logLibrary({
    level: "warn",
    category: ["zotlit", "db", "annotations"],
    message: "Unknown annotation type {type}",
    properties: { type },
  });
  return "unknown";
}

export function annotationHasCacheImage(
  type: AnnotationType | ResolvedAnnotationTypeName,
): boolean {
  const name = typeof type === "number" ? ANNOT_TYPE[type] : type;
  return name === "image" || name === "ink";
}
