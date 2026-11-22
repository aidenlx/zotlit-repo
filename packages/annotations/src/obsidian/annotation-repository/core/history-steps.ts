import type {
  FieldHistoryStep,
  HistoryChange,
  HistoryDirection,
  HistoryFields,
  HistoryOutcome,
  HistoryStep,
  TagHistoryStep,
} from "#obsidian/annotation-repository/history.ts";
import type {
  AnnotationTag,
  MutationState,
  TagChange,
} from "#obsidian/annotation-repository/write.ts";
import { Effect } from "effect";

import { autosaveDue, draftFor } from "./draft-store.ts";
import { holding, writeHolding } from "./lists.ts";
import { DRAFT_FIELDS, proposedTags } from "./model.ts";
import type { AnnotationRecord } from "./model.ts";
import type { CoreState } from "./state.ts";
import {
  command,
  createAnnotation,
  deleteAnnotation,
  discardConflict,
  firstHeldLockRefusal,
  patchColor,
  patchGeometry,
  writeBlocked,
  writeText,
} from "./writes.ts";
import type { WriteReadError, WriteRunFailed } from "./writes.ts";

import {
  AnnotationHistory,
  contentOf,
  historyFieldsOf,
  isRestore,
  opposite,
  sameContent,
  stillHeldAfterConflict,
  stillHolds,
} from "#obsidian/annotation-repository/history.ts";
import {
  annotationTags,
  IDLE,
  mergeTags,
  noTagChange,
  tagChange,
  tagsPatch,
  TEXT_FIELDS,
} from "#obsidian/annotation-repository/write.ts";

type StepError = WriteRunFailed | WriteReadError;

const openHistory = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  const standing = core.histories.get(attachmentKey);
  if (standing) {
    standing.hold();
    return;
  }
  core.histories.set(attachmentKey, new AnnotationHistory());
  yield* Effect.logDebug("An annotation history opened").pipe(
    Effect.annotateLogs({ attachmentKey }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

const closeHistory = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  const standing = core.histories.get(attachmentKey);
  if (!standing || standing.release() > 0) return;
  core.histories.delete(attachmentKey);
  yield* Effect.logDebug("An annotation history closed").pipe(
    Effect.annotateLogs({ attachmentKey }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

function canUndo(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<boolean> {
  return stepStands(core, attachmentKey, "undo");
}

function canRedo(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<boolean> {
  return stepStands(core, attachmentKey, "redo");
}

function undo(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<HistoryOutcome, StepError> {
  return stepHistory(core, attachmentKey, "undo");
}

function redo(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<HistoryOutcome, StepError> {
  return stepHistory(core, attachmentKey, "redo");
}

const stepHistory = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  direction: HistoryDirection,
): Effect.fn.Return<HistoryOutcome, StepError> {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingAttachments.has(attachmentKey))
    return { kind: "idle" };
  if (savePending(core, attachmentKey)) return { kind: "idle" };
  const step = history.peek(direction);
  if (!step || (yield* beingEdited(core, step))) return { kind: "idle" };
  if (yield* writeBlocked(core, attachmentKey)) return { kind: "blocked" };
  const locked = yield* firstHeldLockRefusal(
    core,
    step.changes.map(({ annotationKey }) => annotationKey),
    step.kind,
  );
  if (locked) return { kind: "locked", reason: locked.failure.reason };

  return yield* Effect.acquireUseRelease(
    Effect.sync(() => core.steppingAttachments.add(attachmentKey)),
    () => takeStep(core, step, { attachmentKey, direction, history }),
    () =>
      Effect.sync(() => {
        core.steppingAttachments.delete(attachmentKey);
        core.publish({ _tag: "history-changed", attachmentKey });
      }),
  );
});

const stepStands = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  direction: HistoryDirection,
) {
  const step = core.histories.get(attachmentKey)?.peek(direction);
  return !!step && !(yield* beingEdited(core, step));
});

const beingEdited = Effect.fnUntraced(function* (
  core: CoreState,
  step: HistoryStep,
) {
  for (const { annotationKey } of step.changes) {
    for (const field of DRAFT_FIELDS) {
      if (yield* draftFor(core, field, annotationKey)) return true;
    }
  }
  return false;
});

const takeStep = Effect.fnUntraced(function* (
  core: CoreState,
  step: HistoryStep,
  {
    attachmentKey,
    direction,
    history,
  }: {
    attachmentKey: string;
    direction: HistoryDirection;
    history: AnnotationHistory;
  },
): Effect.fn.Return<HistoryOutcome, StepError> {
  if (step.kind === "existence") {
    return yield* takeExistenceStep(core, step, {
      attachmentKey,
      direction,
      history,
    });
  }
  if (step.kind === "tags") {
    return yield* takeTagStep(core, step, {
      attachmentKey,
      direction,
      history,
    });
  }
  const checked: { change: HistoryChange; record: AnnotationRecord }[] = [];
  for (const change of step.changes) {
    const record = yield* heldRecord(core, change.annotationKey);
    if (record && stillHolds(change.after, record)) {
      checked.push({ change, record });
      continue;
    }
    yield* Effect.logDebug(
      "A history step was dropped: Zotero holds another value",
    ).pipe(
      Effect.annotateLogs({
        attachmentKey,
        annotationKey: change.annotationKey,
        kind: step.kind,
        missing: !record,
      }),
    );
    history.drop(direction, step);
    return { kind: "changed", annotationKey: change.annotationKey };
  }

  const left: HistoryChange[] = [];
  for (const { change, record } of checked) {
    const { annotationKey } = change;
    const before = historyFieldsOf(step.kind, record) ?? change.after;
    let outcome = yield* stepWrite(core, annotationKey, change.before);
    if (
      outcome.kind === "conflict" &&
      stillHeldAfterConflict(change.after, outcome.conflict)
    ) {
      outcome = yield* stepWrite(core, annotationKey, change.before);
    }
    if (outcome.kind === "failed") {
      history.drop(direction, step);
      return { kind: "failed", failure: outcome.failure };
    }
    if (outcome.kind !== "idle") {
      yield* discardConflict(core, annotationKey);
      history.drop(direction, step);
      return { kind: "changed", annotationKey };
    }
    const settled = (yield* holding(core, annotationKey))?.record;
    left.push({
      annotationKey,
      before,
      after:
        (settled ? historyFieldsOf(step.kind, settled) : null) ?? change.before,
    });
  }

  history.drop(direction, step);
  history.push(opposite(direction), { kind: step.kind, changes: left });
  return { kind: "stepped", annotationKey: left[0]!.annotationKey };
});

const heldRecord = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  const held = yield* writeHolding(core, annotationKey);
  return held === "server-changed" ? undefined : held?.record;
});

function stepWrite(
  core: CoreState,
  annotationKey: string,
  fields: HistoryFields,
): Effect.Effect<MutationState, WriteRunFailed> {
  return Effect.acquireUseRelease(
    Effect.sync(() => core.steppingWrites.add(annotationKey)),
    () => fieldWrite(core, annotationKey, fields),
    () => Effect.sync(() => core.steppingWrites.delete(annotationKey)),
  );
}

function fieldWrite(
  core: CoreState,
  annotationKey: string,
  fields: HistoryFields,
): Effect.Effect<MutationState, WriteRunFailed> {
  if (fields.color !== undefined) {
    return patchColor(core, annotationKey, fields.color);
  }
  for (const field of TEXT_FIELDS) {
    const value = fields[field];
    if (value !== undefined) {
      return writeText(core, annotationKey, { field, value });
    }
  }
  if (fields.geometry !== undefined) {
    return patchGeometry(core, annotationKey, {
      edit: fields.geometry,
      input: "pointer",
    });
  }
  return Effect.succeed(IDLE);
}

const takeTagStep = Effect.fnUntraced(function* (
  core: CoreState,
  step: TagHistoryStep,
  {
    attachmentKey,
    direction,
    history,
  }: {
    attachmentKey: string;
    direction: HistoryDirection;
    history: AnnotationHistory;
  },
): Effect.fn.Return<HistoryOutcome, StepError> {
  const [{ annotationKey, tags }] = step.changes;
  const record = yield* heldRecord(core, annotationKey);
  if (!record) {
    yield* Effect.logDebug(
      "A history step was dropped: Zotero no longer holds it",
    ).pipe(
      Effect.annotateLogs({ attachmentKey, annotationKey, kind: step.kind }),
    );
    history.drop(direction, step);
    return { kind: "changed", annotationKey };
  }
  const reverse: TagChange<AnnotationTag> = {
    added: tags.removed,
    removed: tags.added,
  };
  const current = annotationTags(record);
  if (noTagChange(tagChange(current, mergeTags(current, reverse)))) {
    yield* Effect.logDebug(
      "A tag step had nothing to write: Zotero holds its names",
    ).pipe(Effect.annotateLogs({ attachmentKey, annotationKey }));
    history.drop(direction, step);
    return { kind: "stepped", annotationKey };
  }

  let sent = record;
  const outcome = yield* Effect.acquireUseRelease(
    Effect.sync(() => core.steppingWrites.add(annotationKey)),
    () =>
      command(core, annotationKey, {
        write: "tags",
        request: (target, against) => {
          sent = against;
          return tagsPatch(target, mergeTags(annotationTags(against), reverse));
        },
        propose: (against) =>
          proposedTags(mergeTags(annotationTags(against), reverse)),
      }),
    () => Effect.sync(() => core.steppingWrites.delete(annotationKey)),
  );
  history.drop(direction, step);
  if (outcome.kind === "failed") {
    return { kind: "failed", failure: outcome.failure };
  }
  const settled = (yield* holding(core, annotationKey))?.record;
  const left =
    settled && tagChange(annotationTags(sent), annotationTags(settled));
  if (left && !noTagChange(left)) {
    history.push(opposite(direction), {
      kind: step.kind,
      changes: [{ annotationKey, tags: left }],
    });
  }
  return { kind: "stepped", annotationKey };
});

const takeExistenceStep = Effect.fnUntraced(function* (
  core: CoreState,
  step: FieldHistoryStep,
  {
    attachmentKey,
    direction,
    history,
  }: {
    attachmentKey: string;
    direction: HistoryDirection;
    history: AnnotationHistory;
  },
): Effect.fn.Return<HistoryOutcome, StepError> {
  for (const change of step.changes) {
    const record = (yield* heldRecord(core, change.annotationKey)) ?? null;
    if (sameContent(change.after.content ?? null, record)) continue;
    yield* Effect.logDebug(
      "A history step was dropped: Zotero holds another value",
    ).pipe(
      Effect.annotateLogs({
        attachmentKey,
        annotationKey: change.annotationKey,
        kind: step.kind,
        missing: !record,
      }),
    );
    history.drop(direction, step);
    return { kind: "changed", annotationKey: change.annotationKey };
  }

  history.drop(direction, step);

  const left: HistoryChange[] = [];
  let removed: { annotationKey: string; pageIndex: number } | null = null;
  for (const change of step.changes) {
    const wanted = change.before.content ?? null;
    const standing = change.after.content;
    if (wanted === null) {
      if (!standing) continue;
      const erased = yield* deleteAnnotation(core, change.annotationKey);
      if (erased.kind === "failed") {
        return { kind: "failed", failure: erased.failure };
      }
      if (erased.kind !== "idle") {
        yield* discardConflict(core, change.annotationKey);
        return { kind: "changed", annotationKey: change.annotationKey };
      }
      removed ??= {
        annotationKey: change.annotationKey,
        pageIndex: standing.position.pageIndex,
      };
      left.push({
        annotationKey: change.annotationKey,
        before: { content: standing },
        after: { content: null },
      });
      continue;
    }
    const made = yield* createAnnotation(core, attachmentKey, {
      draft: wanted,
    });
    if (made.kind === "failed") {
      return { kind: "failed", failure: made.failure };
    }
    history.rename(change.annotationKey, made.annotationKey);
    const settled = (yield* holding(core, made.annotationKey))?.record ?? null;
    left.push({
      annotationKey: made.annotationKey,
      before: { content: null },
      after: { content: (settled && contentOf(settled)) ?? wanted },
    });
  }

  history.push(opposite(direction), { ...step, changes: left });
  if (removed) return { kind: "removed", ...removed };
  const count = step.changes.filter(
    (change) => isRestore(change) && change.lock === "another-user",
  ).length;
  yield* Effect.logDebug("An existence step was taken").pipe(
    Effect.annotateLogs({
      attachmentKey,
      direction,
      restored: step.changes.filter(isRestore).length,
      restoredAsCreator: count,
    }),
  );
  return {
    kind: "stepped",
    annotationKey: left[0]!.annotationKey,
    ...(count > 0 && { restoredAsCreator: { count } }),
  };
});

function savePending(core: CoreState, attachmentKey: string): boolean {
  if ((core.writesInFlight.get(attachmentKey) ?? 0) > 0) return true;
  for (const field of TEXT_FIELDS) {
    for (const draft of core.drafts[field].values()) {
      if (draft.attachmentKey !== attachmentKey) continue;
      if (autosaveDue(core, field, draft)) return true;
    }
  }
  return false;
}

export { openHistory, closeHistory, canUndo, canRedo, undo, redo };
