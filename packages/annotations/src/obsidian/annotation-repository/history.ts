import type { LockReason } from "#core/annotation-repository/lock.ts";
import { DateTime, Duration } from "effect";

import type {
  AnnotationPosition,
  ResolvedAnnotationTypeName,
} from "@zotlit/db";

import {
  resolvesSilently,
  sameStoredGeometry,
  storedPosition,
} from "./reconcile.ts";
import { annotationTags, writablePosition, writePosition } from "./write.ts";
import type {
  AnnotationDraft,
  AnnotationTag,
  GeometryEdit,
  TagChange,
  TextField,
  WriteConflict,
  WriteFailure,
} from "./write.ts";

export const MAX_HISTORY_STEPS = 100;

export const JOIN_WINDOW_MS = 500;

export type HistoryDirection = "undo" | "redo";

export type HistoryEditKind =
  | "color"
  | "comment"
  | "existence"
  | "geometry"
  | "tags"
  | "text";

export type HistoryContent = Omit<AnnotationDraft, "parentKey">;

export interface HistoryRestorable extends HistoryRecord {
  pageLabel: string | null;
  tags: readonly string[];
  tagDetails?: readonly AnnotationTag[];
}

export interface HistoryRecord {
  type: ResolvedAnnotationTypeName;
  color: string | null;
  comment: string | null;
  position: AnnotationPosition;
  sortIndex: string;
  text: string | null;
}

export interface HistoryFields {
  color?: string;
  comment?: string;
  geometry?: GeometryEdit;
  text?: string;
  content?: HistoryContent | null;
}

export interface HistoryJoin {
  input: "keyboard";
  at: DateTime.Utc;
}

export interface HistoryChange {
  annotationKey: string;
  before: HistoryFields;
  after: HistoryFields;
  lock?: LockReason;
}

export function isRestore(change: HistoryChange): boolean {
  return !!change.before.content && change.after.content === null;
}

export interface TagHistoryChange {
  annotationKey: string;
  tags: TagChange<AnnotationTag>;
}

export interface FieldHistoryStep {
  kind: Exclude<HistoryEditKind, "tags">;
  changes: readonly HistoryChange[];
  join?: HistoryJoin;
  group?: string;
}

export interface TagHistoryStep {
  kind: "tags";
  changes: readonly [TagHistoryChange];
}

export type HistoryStep = FieldHistoryStep | TagHistoryStep;

export function contentOf(record: HistoryRestorable): HistoryContent | null {
  const position = writablePosition(record.position);
  if (!position) return null;
  return {
    type: record.type,
    color: record.color ?? "",
    comment: record.comment ?? "",
    text: record.text ?? "",
    pageLabel: record.pageLabel ?? "",
    sortIndex: record.sortIndex,
    position,
    tags: annotationTags(record),
  };
}

export function sameContent(
  content: HistoryContent | null,
  record: HistoryRecord | null,
): boolean {
  if (content === null || record === null)
    return content === null && record === null;
  const stored = storedPosition(record.position);
  return (
    content.type === record.type &&
    resolvesSilently("color", content.color, record.color) &&
    sameStringField(content.comment, record.comment) &&
    sameStringField(content.text, record.text) &&
    stored !== null &&
    writePosition(content.position) === stored
  );
}

function sameStringField(written: string, held: string | null): boolean {
  return written === (held ?? "");
}

export function historyFieldsOf(
  kind: FieldHistoryStep["kind"],
  record: HistoryRecord,
): HistoryFields | null {
  switch (kind) {
    case "color":
      return record.color === null ? null : { color: record.color };
    case "existence":
      return null;
    case "comment":
    case "text":
      return { [kind]: record[kind] ?? "" };
    case "geometry": {
      const position = writablePosition(record.position);
      if (!position) return null;
      const quotes = record.type === "highlight" || record.type === "underline";
      return {
        geometry: {
          position,
          sortIndex: record.sortIndex,
          ...(quotes && record.text !== null && { text: record.text }),
        },
      };
    }
  }
}

export function stillHolds(
  fields: HistoryFields,
  record: HistoryRecord,
): boolean {
  return Object.values(FIELD_CHECKS).every((holds) => holds(fields, record));
}

function textHolds(
  field: TextField,
): (fields: HistoryFields, record: HistoryRecord) => boolean {
  return (fields, record) => {
    const held = fields[field];
    return held === undefined || resolvesSilently(field, held, record[field]);
  };
}

const FIELD_CHECKS: {
  readonly [K in keyof Required<HistoryFields>]: (
    fields: HistoryFields,
    record: HistoryRecord,
  ) => boolean;
} = {
  color: (fields, record) =>
    fields.color === undefined ||
    resolvesSilently("color", fields.color, record.color),
  comment: textHolds("comment"),
  content: (fields, record) =>
    fields.content === undefined || sameContent(fields.content, record),
  geometry: (fields, record) =>
    fields.geometry === undefined ||
    sameStoredGeometry(fields.geometry, record),
  text: textHolds("text"),
};

export function stillHeldAfterConflict(
  fields: HistoryFields,
  conflict: WriteConflict,
): boolean {
  switch (conflict.write) {
    case "color":
      return (
        fields.color !== undefined &&
        resolvesSilently("color", fields.color, conflict.fresh)
      );
    case "comment":
    case "text": {
      const held = fields[conflict.write];
      return (
        held !== undefined &&
        resolvesSilently(conflict.write, held, conflict.fresh)
      );
    }
    case "geometry":
      return (
        fields.geometry !== undefined &&
        sameStoredGeometry(fields.geometry, conflict.fresh)
      );
    default:
      return false;
  }
}

export type HistoryOutcome =
  | { kind: "idle" }
  | {
      kind: "stepped";
      annotationKey: string;
      restoredAsCreator?: { count: number };
    }
  | { kind: "removed"; annotationKey: string; pageIndex: number }
  | { kind: "changed"; annotationKey: string }
  | {
      kind: "failed";
      failure: WriteFailure;
      partial?: {
        direction: HistoryDirection;
        annotationKeys: readonly string[];
        total: number;
      };
    }
  | { kind: "blocked" }
  | { kind: "locked"; reason: LockReason };

function joins(standing: FieldHistoryStep, made: FieldHistoryStep): boolean {
  if (made.kind !== "geometry" || standing.kind !== made.kind) return false;
  if (!standing.join || !made.join) return false;
  const [held] = standing.changes;
  const [next] = made.changes;
  if (standing.changes.length !== 1 || made.changes.length !== 1) return false;
  if (!held || !next || held.annotationKey !== next.annotationKey) return false;
  const since = Duration.toMillis(
    DateTime.distance(standing.join.at, made.join.at),
  );
  return since >= 0 && since < JOIN_WINDOW_MS;
}

function joinsGroup(
  standing: FieldHistoryStep,
  made: FieldHistoryStep,
): boolean {
  return (
    standing.kind === made.kind &&
    made.group !== undefined &&
    standing.group === made.group
  );
}

function joinedStep(
  standing: FieldHistoryStep,
  made: FieldHistoryStep,
): FieldHistoryStep {
  const held = standing.changes[0];
  const next = made.changes[0];
  if (!held || !next) return made;
  return {
    kind: made.kind,
    changes: [
      {
        annotationKey: next.annotationKey,
        before: held.before,
        after: next.after,
      },
    ],
    ...(made.join && { join: made.join }),
  };
}

export function opposite(direction: HistoryDirection): HistoryDirection {
  return direction === "undo" ? "redo" : "undo";
}

export class AnnotationHistory {
  #holders = 1;
  readonly #stacks: Record<HistoryDirection, HistoryStep[]> = {
    undo: [],
    redo: [],
  };

  hold(): void {
    this.#holders += 1;
  }

  release(): number {
    this.#holders -= 1;
    return this.#holders;
  }

  holds(direction: HistoryDirection): boolean {
    return this.#stacks[direction].length > 0;
  }

  record(step: HistoryStep): boolean {
    this.#stacks.redo.length = 0;
    const standing = this.peek("undo");
    const stack = this.#stacks.undo;
    if (standing && standing.kind !== "tags" && step.kind !== "tags") {
      if (joinsGroup(standing, step)) {
        stack[stack.length - 1] = {
          ...standing,
          changes: [...standing.changes, ...step.changes],
        };
        return true;
      }
      if (joins(standing, step)) {
        stack[stack.length - 1] = joinedStep(standing, step);
        return true;
      }
    }
    this.push("undo", step);
    return false;
  }

  rename(from: string, to: string): void {
    for (const stack of [this.#stacks.undo, this.#stacks.redo]) {
      for (const [index, step] of stack.entries()) {
        if (!step.changes.some(({ annotationKey }) => annotationKey === from))
          continue;
        const renamed = <C extends { annotationKey: string }>(change: C): C =>
          change.annotationKey === from
            ? { ...change, annotationKey: to }
            : change;
        stack[index] =
          step.kind === "tags"
            ? { ...step, changes: [renamed(step.changes[0])] }
            : { ...step, changes: step.changes.map(renamed) };
      }
    }
  }

  peek(direction: HistoryDirection): HistoryStep | null {
    return this.#stacks[direction].at(-1) ?? null;
  }

  drop(direction: HistoryDirection, step: HistoryStep): void {
    const stack = this.#stacks[direction];
    const at = stack.lastIndexOf(step);
    if (at >= 0) stack.splice(at, 1);
  }

  reshape(step: HistoryStep, next: HistoryStep | null): void {
    const stack = this.#stacks.undo;
    const at = stack.indexOf(step);
    if (at < 0) return;
    stack.splice(at, 1, ...(next ? [next] : []));
    this.#stacks.redo.length = 0;
  }

  push(direction: HistoryDirection, step: HistoryStep): void {
    const stack = this.#stacks[direction];
    stack.push(step);
    if (stack.length > MAX_HISTORY_STEPS) stack.shift();
  }
}
