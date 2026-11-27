import type {
  FieldHistoryStep,
  HistoryChange,
  HistoryJoin,
  HistoryStep,
  AnnotationHistory,
} from "#obsidian/annotation-repository/history.ts";
import type { TextField } from "#obsidian/annotation-repository/write.ts";
import { Effect } from "effect";

import type {
  AnnotationRecord,
  ConfirmedWrite,
  GroupWrite,
  GroupWrites,
} from "./model.ts";
import { TEXT_FIELD_SPECS, sameText } from "./model.ts";
import type { CoreState } from "./state.ts";

import {
  contentOf,
  historyFieldsOf,
} from "#obsidian/annotation-repository/history.ts";
import {
  annotationTags,
  isTextField,
  noTagChange,
  tagChange,
} from "#obsidian/annotation-repository/write.ts";

function historyChangeOf(
  before: AnnotationRecord,
  applied: ConfirmedWrite,
): { kind: FieldHistoryStep["kind"]; change: HistoryChange } | null {
  if (applied.kind === "deleted") {
    const content = contentOf(before);
    return content
      ? {
          kind: "existence",
          change: {
            annotationKey: applied.annotationKey,
            before: { content },
            after: { content: null },
            ...(applied.lock && { lock: applied.lock }),
          },
        }
      : null;
  }
  if (
    applied.kind !== "record" ||
    applied.write === "tags" ||
    isTextField(applied.write)
  )
    return null;
  const was = historyFieldsOf(applied.write, before);
  const now = historyFieldsOf(applied.write, applied.record);
  return was && now
    ? {
        kind: applied.write,
        change: { annotationKey: applied.record.key, before: was, after: now },
      }
    : null;
}

const recordStep = Effect.fnUntraced(function* (
  core: CoreState,
  before: AnnotationRecord,
  {
    attachmentKey,
    applied,
    join,
  }: { attachmentKey: string; applied: ConfirmedWrite; join?: HistoryJoin },
) {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingWrites.has(before.key)) return;
  if (applied.kind === "record" && applied.write === "tags") {
    yield* recordTagStep(core, history, {
      attachmentKey,
      before,
      record: applied.record,
    });
    return;
  }
  if (applied.kind === "record" && isTextField(applied.write)) {
    yield* recordTextStep(core, history, {
      field: applied.write,
      attachmentKey,
      before,
      record: applied.record,
    });
    return;
  }
  const made = historyChangeOf(before, applied);
  if (!made) return;
  if (made.kind === "existence") {
    yield* recordExistence(core, made.change, { attachmentKey });
    return;
  }
  const joined = history.record({
    kind: made.kind,
    changes: [made.change],
    ...(join && { join }),
  });
  yield* Effect.logDebug("An edit was recorded in the annotation history").pipe(
    Effect.annotateLogs({
      attachmentKey,
      annotationKey: made.change.annotationKey,
      kind: made.kind,
      joined,
    }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

const recordTextStep = Effect.fnUntraced(function* (
  core: CoreState,
  history: AnnotationHistory,
  {
    field,
    attachmentKey,
    before,
    record,
  }: {
    field: TextField;
    attachmentKey: string;
    before: AnnotationRecord;
    record: AnnotationRecord;
  },
) {
  const { valueOf } = TEXT_FIELD_SPECS[field];
  const top = history.peek("undo");
  const open =
    top?.kind === field &&
    top.changes.length === 1 &&
    top.changes[0]!.annotationKey === record.key &&
    sameText(valueOf(before), top.changes[0]!.after[field] ?? null)
      ? top
      : null;
  const origin = open?.changes[0]!.before[field] ?? valueOf(before) ?? "";
  const after = valueOf(record) ?? "";
  const step: HistoryStep | null = sameText(origin, after)
    ? null
    : {
        kind: field,
        changes: [
          {
            annotationKey: record.key,
            before: { [field]: origin },
            after: { [field]: after },
          },
        ],
      };
  if (open) history.reshape(open, step);
  else if (step) history.record(step);
  else return;
  yield* Effect.logDebug(
    "A text editing session moved in the annotation history",
  ).pipe(
    Effect.annotateLogs({
      attachmentKey,
      annotationKey: record.key,
      field,
      recorded: !!step,
    }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

const recordTagStep = Effect.fnUntraced(function* (
  core: CoreState,
  history: AnnotationHistory,
  {
    attachmentKey,
    before,
    record,
  }: {
    attachmentKey: string;
    before: AnnotationRecord;
    record: AnnotationRecord;
  },
) {
  const tags = tagChange(annotationTags(before), annotationTags(record));
  if (noTagChange(tags)) return;
  history.record({
    kind: "tags",
    changes: [{ annotationKey: record.key, tags }],
  });
  yield* Effect.logDebug(
    "A tag session was recorded in the annotation history",
  ).pipe(
    Effect.annotateLogs({
      attachmentKey,
      annotationKey: record.key,
      added: tags.added.length,
      removed: tags.removed.length,
    }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

const recordGroup = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKeys: readonly string[],
  { attachmentKey, kind, writes }: GroupWrites & { attachmentKey: string },
) {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingAttachments.has(attachmentKey)) return;
  const order = (entry: GroupWrite) => annotationKeys.indexOf(entry.before.key);
  const changes: HistoryChange[] = [];
  for (const { before, applied } of writes.toSorted(
    (a, b) => order(a) - order(b),
  )) {
    if (core.steppingWrites.has(before.key)) continue;
    const made = historyChangeOf(before, applied);
    if (!made) continue;
    if (made.kind === kind) {
      changes.push(made.change);
      continue;
    }
    yield* Effect.logError(
      "A write of a group changed another kind of step",
    ).pipe(
      Effect.annotateLogs({
        attachmentKey,
        annotationKey: before.key,
        group: kind,
        write: made.kind,
      }),
    );
  }
  if (changes.length === 0) return;
  history.record({ kind, changes });
  yield* Effect.logDebug(
    "A group write was recorded in the history as one step",
  ).pipe(
    Effect.annotateLogs({ attachmentKey, kind, annotations: changes.length }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

const recordExistence = Effect.fnUntraced(function* (
  core: CoreState,
  change: HistoryChange,
  { attachmentKey, group }: { attachmentKey: string; group?: string },
) {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingAttachments.has(attachmentKey)) return;
  history.record({
    kind: "existence",
    changes: [change],
    ...(group !== undefined && { group }),
  });
  yield* Effect.logDebug(
    "A create or a delete was recorded in the history",
  ).pipe(
    Effect.annotateLogs({
      attachmentKey,
      annotationKey: change.annotationKey,
      restores: change.before.content !== null,
    }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

export { recordStep, recordGroup, recordExistence };
