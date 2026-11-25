import type { LockReason } from "#core/annotation-repository/lock.ts";

import type {
  AnnotationPosition,
  ResolvedAnnotationTypeName,
  TagType,
} from "@zotlit/db";
import { fromInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import type { ZoteroMethod } from "@zotlit/plugin-kernel/zotero-http.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { WireTag } from "@zotlit/plugin-services/core/zotero-local-api/wire.ts";
import type { LocalApiFailure } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

import { editingCapabilityCopy } from "./capability-copy.ts";
import type { CopyInstant } from "./capability-copy.ts";
import { capabilityOfFailure } from "./capability.ts";
import type { EditingCapability } from "./capability.ts";

import { lockReasonText } from "#core/annotation-repository/lock-copy.ts";

export type WriteFailure =
  | LocalApiFailure
  | { kind: "db-source" }
  | { kind: "unknown-annotation" }
  | { kind: "position-too-large" }
  | { kind: "locked"; reason: LockReason };

export const TEXT_FIELDS = ["comment", "text"] as const;

export type TextField = (typeof TEXT_FIELDS)[number];

export function isTextField(write: string): write is TextField {
  return (TEXT_FIELDS as readonly string[]).includes(write);
}

export function byTextField<V>(
  build: (field: TextField) => V,
): Record<TextField, V> {
  return Object.fromEntries(
    TEXT_FIELDS.map((field) => [field, build(field)]),
  ) as Record<TextField, V>;
}

export type ConflictedWrite = "color" | "delete" | "geometry" | TextField;

export type WriteConflict =
  | {
      write: Exclude<ConflictedWrite, "geometry">;
      attempted: string | null;
      fresh: string | null;
    }
  | {
      write: "geometry";
      attempted: GeometryEdit;
      input: GeometryInput;
      fresh: { position: AnnotationPosition; text: string | null };
    };

export type PendingWrite = ConflictedWrite | "create" | "tags";

export type MutationState =
  | { kind: "idle" }
  | { kind: "pending"; write: PendingWrite; session?: true }
  | { kind: "conflict"; conflict: WriteConflict }
  | { kind: "failed"; failure: WriteFailure };

export const IDLE: MutationState = { kind: "idle" };

export interface WriteTarget {
  library: string;
  key: string;
  version: number;
}

export interface WriteRequest {
  path: string;
  method: ZoteroMethod;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}

const JSON_CONTENT: Readonly<Record<string, string>> = {
  "Content-Type": "application/json",
};

export function wireColor(color: string): string {
  return color.toLowerCase();
}

export function colorPatch(target: WriteTarget, color: string): WriteRequest {
  return patch(target, { annotationColor: wireColor(color) });
}

export function commentPatch(
  target: WriteTarget,
  comment: string,
): WriteRequest {
  return patch(target, { annotationComment: comment });
}

export function textPatch(target: WriteTarget, text: string): WriteRequest {
  return patch(target, { annotationText: text });
}

export interface AnnotationTag {
  name: string;
  type: number;
}

export const MANUAL_TAG_TYPE = 0 satisfies TagType;

export function annotationTags(record: {
  tags: readonly string[];
  tagDetails?: readonly AnnotationTag[];
}): readonly AnnotationTag[] {
  return (
    record.tagDetails ??
    record.tags.map((name) => ({ name, type: MANUAL_TAG_TYPE }))
  );
}

export interface TagChange<T extends string | AnnotationTag = string> {
  added: readonly T[];
  removed: readonly T[];
}

export function tagChange<T extends string | AnnotationTag>(
  before: readonly T[],
  after: readonly T[],
): TagChange<T> {
  return {
    added: after.filter((tag) => !hasTag(before, tag)),
    removed: before.filter((tag) => !hasTag(after, tag)),
  };
}

export function noTagChange({
  added,
  removed,
}: TagChange<string | AnnotationTag>): boolean {
  return added.length === 0 && removed.length === 0;
}

export function mergeTags(
  current: readonly AnnotationTag[],
  { added, removed }: TagChange<string | AnnotationTag>,
): AnnotationTag[] {
  const kept = current.filter((tag) => !hasTag(removed, tag));
  const fresh = added.filter((tag) => !hasTag(kept, tag)).map(typedTag);
  return [...kept, ...fresh];
}

function hasTag(
  tags: readonly (string | AnnotationTag)[],
  tag: string | AnnotationTag,
): boolean {
  const name = tagName(tag);
  return tags.some((other) => tagName(other) === name);
}

function tagName(tag: string | AnnotationTag): string {
  return typeof tag === "string" ? tag : tag.name;
}

function typedTag(tag: string | AnnotationTag): AnnotationTag {
  return typeof tag === "string" ? { name: tag, type: MANUAL_TAG_TYPE } : tag;
}

export function tagsPatch(
  target: WriteTarget,
  tags: readonly AnnotationTag[],
): WriteRequest {
  return patch(target, {
    tags: tags.map(({ name, type }) => ({ tag: name, type })),
  });
}

export function geometryPatch(
  target: WriteTarget,
  type: ResolvedAnnotationTypeName,
  edit: GeometryEdit,
): WriteRequest {
  const quotes = type === "highlight" || type === "underline";
  return patch(target, {
    annotationPosition: writePosition(edit.position),
    annotationSortIndex: edit.sortIndex,
    ...(quotes && edit.text !== undefined && { annotationText: edit.text }),
  });
}

export const MAX_POSITION_LENGTH = 65_000;

const POSITION_DECIMALS = 1e3;

export interface CreatePosition {
  pageIndex: number;
  rects: readonly (readonly number[])[];
  nextPageRects?: readonly (readonly number[])[];
}

export interface InkPosition {
  pageIndex: number;
  width: number;
  paths: readonly (readonly number[])[];
}

export interface TextPosition {
  pageIndex: number;
  fontSize: number;
  rotation: number;
  rects: readonly (readonly number[])[];
}

export type WritablePosition = CreatePosition | InkPosition | TextPosition;

export function writablePosition(
  position: AnnotationPosition,
): WritablePosition | null {
  switch (position.kind) {
    case "pdf-rects":
    case "pdf-ink":
    case "pdf-text":
      return position;
    default:
      return null;
  }
}

export type GeometryInput = "pointer" | "keyboard";

export interface GeometryEdit {
  position: WritablePosition;
  sortIndex: string;
  text?: string;
}

export interface AnnotationDraft {
  parentKey: string;
  type: ResolvedAnnotationTypeName;
  color: string;
  comment: string;
  text: string;
  pageLabel: string;
  sortIndex: string;
  position: WritablePosition;
  tags?: readonly AnnotationTag[];
}

export interface CreateRequest extends WriteRequest {
  writeToken: string;
}

export function newWriteToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function createRequest(
  library: string,
  draft: AnnotationDraft,
  writeToken: string = newWriteToken(),
): CreateRequest {
  const quotes = draft.type === "highlight" || draft.type === "underline";
  return {
    path: `/api/${library}/items`,
    method: "POST",
    headers: { ...JSON_CONTENT, "Zotero-Write-Token": writeToken },
    writeToken,
    body: JSON.stringify([
      {
        annotationType: draft.type,
        itemType: "annotation",
        parentItem: draft.parentKey,
        ...(quotes && { annotationText: draft.text }),
        annotationComment: draft.comment,
        annotationColor: wireColor(draft.color),
        annotationPageLabel: draft.pageLabel,
        annotationSortIndex: draft.sortIndex,
        annotationPosition: writePosition(draft.position),
        ...(draft.tags?.length && {
          tags: draft.tags.map(({ name, type }) => ({ tag: name, type })),
        }),
      },
    ]),
  };
}

export function roundCoordinate(value: number): number {
  return Math.round(value * POSITION_DECIMALS) / POSITION_DECIMALS;
}

export function writePosition(position: WritablePosition): string {
  const roundAll = (rects: readonly (readonly number[])[]) =>
    rects.map((rect) => rect.map(roundCoordinate));
  if ("paths" in position) {
    return JSON.stringify({
      pageIndex: position.pageIndex,
      width: roundCoordinate(position.width),
      paths: roundAll(position.paths),
    });
  }
  if ("fontSize" in position) {
    return JSON.stringify({
      pageIndex: position.pageIndex,
      fontSize: position.fontSize,
      rotation: position.rotation,
      rects: roundAll(position.rects),
    });
  }
  return JSON.stringify({
    pageIndex: position.pageIndex,
    rects: roundAll(position.rects),
    ...(position.nextPageRects && {
      nextPageRects: roundAll(position.nextPageRects),
    }),
  });
}

export function storedWide([left, bottom, right, top]: readonly [
  number,
  number,
  number,
  number,
]): [number, number, number, number] {
  return [
    Math.floor(left * POSITION_DECIMALS) / POSITION_DECIMALS,
    bottom,
    Math.ceil(right * POSITION_DECIMALS) / POSITION_DECIMALS,
    top,
  ];
}

export function textIdentity(
  position: TextPosition,
  { color, comment }: { color: string | null; comment: string | null },
): string {
  return JSON.stringify([
    color?.toLowerCase(),
    comment,
    writePosition({
      pageIndex: position.pageIndex,
      fontSize: position.fontSize,
      rotation: position.rotation,
      rects: position.rects,
    }),
  ]);
}

export function eraseRequest(target: WriteTarget): WriteRequest {
  return {
    path: itemPath(target),
    method: "DELETE",
    headers: { "If-Unmodified-Since-Version": String(target.version) },
  };
}

export function groupFailureMessages(
  outcomes: readonly MutationState[],
  now: CopyInstant,
  message: (
    failure: WriteFailure,
    now: CopyInstant,
  ) => string = writeFailureMessage,
): string[] {
  return [
    ...new Set(
      outcomes.flatMap((outcome) =>
        outcome.kind === "failed" ? [message(outcome.failure, now)] : [],
      ),
    ),
  ];
}

export function writeFailureMessage(
  failure: WriteFailure,
  now: CopyInstant,
): string {
  if (failure.kind === "locked") return lockReasonText(failure.reason);
  return m.annot_view_write_failed({
    reason: writeFailureReason(failure, now),
  });
}

export function writeFailureReason(
  failure: WriteFailure,
  now: CopyInstant,
): string {
  switch (failure.kind) {
    case "db-source":
      return m.annot_view_write_reason_db_source();
    case "unknown-annotation":
      return m.annot_view_write_reason_unknown_annotation();
    case "position-too-large":
      return m.annot_view_write_reason_position_too_large();
    case "not-found":
      return m.annot_view_write_reason_deleted();
    case "conflict":
    case "write-token-used":
      return m.annot_view_write_reason_conflict();
    case "unknown-outcome":
      return m.annot_view_write_reason_unknown_outcome();
    case "locked":
      return lockReasonText(failure.reason);
    default:
      return blockedReason(capabilityOfFailure(failure, fromInstant(now)), now);
  }
}

export function blockedReason(
  capability: EditingCapability,
  now: CopyInstant,
): string {
  const copy = editingCapabilityCopy(capability, now);
  return copy.detail === null ? copy.label : `${copy.label}. ${copy.detail}`;
}

function patch(
  target: WriteTarget,
  fields: Readonly<Record<string, string | readonly WireTag[]>>,
): WriteRequest {
  return {
    path: itemPath(target),
    method: "PATCH",
    headers: JSON_CONTENT,
    body: JSON.stringify({ version: target.version, ...fields }),
  };
}

function itemPath({ library, key }: WriteTarget): string {
  return `/api/${library}/items/${key}`;
}
