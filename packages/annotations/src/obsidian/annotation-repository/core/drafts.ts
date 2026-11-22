import type {
  MutationState,
  TextField,
} from "#obsidian/annotation-repository/write.ts";
import { Duration, Effect, FiberMap, FiberSet } from "effect";

import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";

import {
  cancelTextSave,
  draftFor,
  draftsOn,
  dropDraft,
  saveKey,
  setDraft,
} from "./draft-store.ts";
import {
  capabilityFor,
  handOff,
  sessionHolding,
  writeHolding,
} from "./lists.ts";
import {
  TEXT_FIELD_SPECS,
  indexedID,
  proposedTags,
  proposedText,
  sameText,
} from "./model.ts";
import type {
  AnnotationMutation,
  AnnotationState,
  TagDraft,
  TextFieldDraft,
} from "./model.ts";
import {
  answerOf,
  mutationFor,
  pendingWrites,
  savingText,
  settle,
} from "./outcomes.ts";
import type { CoreState } from "./state.ts";
import {
  command,
  lockRefusal,
  writeBlocked,
  writeText,
  WriteRunFailed,
} from "./writes.ts";

import {
  annotationTags,
  byTextField,
  IDLE,
  mergeTags,
  noTagChange,
  tagChange,
  tagsPatch,
  TEXT_FIELDS,
} from "#obsidian/annotation-repository/write.ts";

const TEXT_IDLE_SAVE = Duration.seconds(1);

const TEXT_BURST_SAVE = Duration.seconds(10);

type TextWriteDecision =
  | { kind: "drop" }
  | { kind: "retain" }
  | { kind: "update"; draft: TextFieldDraft };

function textDraftAfterWrite(
  current: TextFieldDraft,
  submittedText: string,
  outcome: MutationState,
): TextWriteDecision {
  switch (outcome.kind) {
    case "idle":
      return sameText(current.text, submittedText)
        ? { kind: "drop" }
        : {
            kind: "update",
            draft: {
              ...current,
              baseline: submittedText,
              manualSave: false,
              state: { kind: "editing" },
            },
          };
    case "conflict": {
      const { conflict } = outcome;
      const fresh = conflict.write === "geometry" ? "" : (conflict.fresh ?? "");
      return {
        kind: "update",
        draft: { ...current, state: { kind: "conflict", fresh } },
      };
    }
    case "failed":
      return {
        kind: "update",
        draft: {
          ...current,
          manualSave: true,
          state: { kind: "failed", failure: outcome.failure },
        },
      };
    case "pending":
      return { kind: "retain" };
  }
}

const annotationState = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
): Effect.fn.Return<AnnotationState> {
  const textDrafts = yield* Effect.all(
    byTextField((field) => draftFor(core, field, annotationKey)),
  );
  const tagDraft = yield* tagDraftFor(core, annotationKey);
  const shown = new Set<TextFieldDraft | TagDraft>(
    [...Object.values(textDrafts), tagDraft].filter((draft) => draft !== null),
  );
  return {
    mutation: mutationFor(core, annotationKey),
    textDrafts,
    tagDraft,
    hidden: draftsOn(core, annotationKey).some((draft) => !shown.has(draft)),
    gone: core.gone.has(annotationKey),
  };
});

function textDraftFor(
  core: CoreState,
  field: TextField,
  annotationKey: string,
): Effect.Effect<TextFieldDraft | null> {
  return draftFor(core, field, annotationKey);
}

const editTextField = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  { annotationKey, text }: { annotationKey: string; text?: string },
): Effect.fn.Return<TextFieldDraft | null> {
  const source = yield* core.localApi.demandSource;
  const standing = yield* draftFor(core, field, annotationKey);
  const held = standing ? null : yield* sessionHolding(core, annotationKey);
  if (!standing && (!source || !held)) return null;
  const capability = yield* capabilityFor(
    core,
    standing?.attachmentKey ?? held!.attachmentKey,
  );
  if (capability.kind !== "writable") return standing ?? null;
  if (yield* lockRefusal(core, annotationKey, field)) return standing ?? null;
  const baseline =
    standing?.baseline ?? TEXT_FIELD_SPECS[field].valueOf(held!.record) ?? "";
  const draft = standing
    ? {
        ...standing,
        ...(text !== undefined && { text }),
        ...(text !== undefined &&
          text !== standing.text &&
          standing.state.kind === "failed" && {
            state: { kind: "editing" } as const,
          }),
      }
    : {
        annotationKey,
        attachmentKey: held!.attachmentKey,
        serverID: source!.serverID,
        baseline,
        text: text ?? baseline,
        state: { kind: "editing" } as const,
      };
  setDraft(core, field, draft);
  if (text !== undefined && draft.state.kind !== "conflict") {
    yield* scheduleTextSave(core, field, draft);
  }
  return draft;
});

const reviewedTextDraft = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  annotationKey: string,
) {
  const standing = yield* draftFor(core, field, annotationKey);
  if (!standing) return null;
  yield* cancelTextSave(core, field, standing);
  yield* handOff(core, standing.attachmentKey).pipe(
    Effect.mapError((cause) => new WriteRunFailed({ cause })),
  );
  return yield* draftFor(core, field, annotationKey);
});

const submitTextField = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  {
    annotationKey,
    automatic = false,
  }: { annotationKey: string; automatic?: boolean },
): Effect.fn.Return<MutationState, WriteRunFailed> {
  const draft = yield* reviewedTextDraft(core, field, annotationKey);
  if (!draft) return IDLE;
  if (draft.state.kind === "conflict") {
    return mutationFor(core, annotationKey);
  }
  const saving = savingText(core, field, annotationKey);
  if (!saving && sameText(draft.text, draft.baseline)) {
    yield* dropDraft(core, field, draft);
    return IDLE;
  }
  if (saving && sameText(proposedText(field, saving), draft.text)) {
    return yield* answerOf(core, saving);
  }
  if (!saving) {
    if (automatic && !(yield* canAutosave(core, draft))) return IDLE;
    const capability = yield* capabilityFor(core, draft.attachmentKey);
    if (capability.kind !== "writable")
      return {
        kind: "failed",
        failure: (yield* writeBlocked(core, draft.attachmentKey))!,
      };
  }
  const locked = yield* lockRefusal(core, annotationKey, field);
  if (locked) return { kind: "failed", failure: locked };
  const submittedText = draft.text;
  setDraft(core, field, { ...draft, state: { kind: "pending" } });
  return yield* sendText(core, field, { draft, submittedText, automatic });
});

const sendText = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  {
    draft: { annotationKey, serverID },
    submittedText,
    automatic,
  }: { draft: TextFieldDraft; submittedText: string; automatic: boolean },
) {
  const id = indexedID(serverID, annotationKey);
  return yield* writeText(core, annotationKey, {
    field,
    value: submittedText,
    run: (send, own) =>
      Effect.gen(function* () {
        if (
          yield* textSuperseded(core, field, {
            own,
            annotationKey,
            id,
            automatic,
          })
        ) {
          yield* Effect.logDebug("A queued text save stood down").pipe(
            Effect.annotateLogs({ annotationKey, field }),
          );
          return { kind: "pending", write: field } satisfies MutationState;
        }
        const outcome = yield* send;
        const current = core.drafts[field].get(id);
        if (current && current.state.kind !== "conflict") {
          yield* applyTextWriteDecision(core, field, {
            annotationKey,
            current,
            submittedText,
            outcome,
            own,
          });
        }
        return outcome;
      }),
  });
});

const textSuperseded = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  {
    own,
    annotationKey,
    id,
    automatic,
  }: {
    own: AnnotationMutation;
    annotationKey: string;
    id: string;
    automatic: boolean;
  },
) {
  const current = core.drafts[field].get(id);
  if (
    !current ||
    current.state.kind === "conflict" ||
    current.state.kind === "failed" ||
    (automatic && !(yield* canAutosave(core, current)))
  ) {
    return true;
  }
  const writes = pendingWrites(core, annotationKey);
  return writes.slice(writes.indexOf(own) + 1).some(({ options }) => {
    const write = options.mutationKey?.[2];
    return write === field || write === "delete";
  });
});

const discardTextDraft = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  annotationKey: string,
) {
  const draft = yield* draftFor(core, field, annotationKey);
  if (draft) yield* dropDraft(core, field, draft);
  if (core.outcomes.get(annotationKey)?.get(field)?.kind === "conflict") {
    settle(core, annotationKey, { write: field, state: IDLE });
  }
});

const retryTextDraft = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  annotationKey: string,
): Effect.fn.Return<MutationState, WriteRunFailed> {
  const draft = yield* reviewedTextDraft(core, field, annotationKey);
  if (!draft) return IDLE;
  const saving = savingText(core, field, annotationKey);
  if (saving) return yield* answerOf(core, saving);
  const locked = yield* lockRefusal(core, annotationKey, field);
  if (locked) return { kind: "failed", failure: locked };
  return yield* resendText(core, field, draft);
});

const resendText = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  draft: TextFieldDraft,
) {
  const { annotationKey } = draft;
  const found = yield* writeHolding(core, annotationKey).pipe(
    Effect.mapError((cause) => new WriteRunFailed({ cause })),
  );
  const held = found === "server-changed" ? null : found;
  const reviewed =
    draft.state.kind === "conflict" ? draft.state.fresh : draft.baseline;
  const fresh = (held && TEXT_FIELD_SPECS[field].valueOf(held.record)) ?? "";
  if (!held || !sameText(fresh, reviewed)) {
    const outcome: MutationState = {
      kind: "conflict",
      conflict: { write: field, attempted: draft.text, fresh },
    };
    settle(core, annotationKey, { write: field, state: outcome });
    setDraft(core, field, { ...draft, state: { kind: "conflict", fresh } });
    if (held) {
      core.publish({
        _tag: "write-conflict",
        annotationKey,
        attachmentKey: held.attachmentKey,
      });
    }
    return outcome;
  }
  const submittedText = draft.text;
  const id = indexedID(draft.serverID, annotationKey);
  setDraft(core, field, { ...draft, state: { kind: "pending" } });
  const resend = writeText(core, annotationKey, {
    field,
    value: submittedText,
  });
  let outcome = yield* resend;
  if (
    outcome.kind === "conflict" &&
    outcome.conflict.write === field &&
    sameText(outcome.conflict.fresh, reviewed)
  ) {
    outcome = yield* resend;
  }
  const current = core.drafts[field].get(id);
  if (!current) return outcome;
  yield* applyTextWriteDecision(core, field, {
    annotationKey,
    current,
    submittedText,
    outcome,
  });
  return outcome;
});

const applyTextWriteDecision = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  {
    annotationKey,
    current,
    submittedText,
    outcome,
    own,
  }: {
    annotationKey: string;
    current: TextFieldDraft;
    submittedText: string;
    outcome: MutationState;
    own?: AnnotationMutation;
  },
) {
  const decision = textDraftAfterWrite(current, submittedText, outcome);
  const later = savingText(core, field, annotationKey);
  if (
    decision.kind === "update" &&
    decision.draft.state.kind === "editing" &&
    later &&
    later !== own
  ) {
    decision.draft = { ...decision.draft, state: { kind: "pending" } };
  }
  if (decision.kind === "drop") {
    yield* dropDraft(core, field, current);
  } else if (decision.kind === "update") {
    core.drafts[field].set(
      indexedID(current.serverID, annotationKey),
      decision.draft,
    );
    core.publish({ _tag: "annotation-changed", annotationKey });
    if (outcome.kind === "idle" && decision.draft.state.kind === "editing") {
      yield* autosave(core, field, annotationKey);
    }
  }
});

function tagDraftFor(
  core: CoreState,
  annotationKey: string,
): Effect.Effect<TagDraft | null> {
  return draftFor(core, "tags", annotationKey);
}

const editTags = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  names?: readonly string[],
): Effect.fn.Return<TagDraft | null> {
  const standing = yield* tagDraftFor(core, annotationKey);
  if (standing?.state.kind === "pending") return standing;
  const source = yield* core.localApi.demandSource;
  const held = standing ? null : yield* sessionHolding(core, annotationKey);
  if (!standing && (!source || !held)) return null;
  const attachmentKey = standing?.attachmentKey ?? held!.attachmentKey;
  const capability = yield* capabilityFor(core, attachmentKey);
  const refused =
    capability.kind !== "writable" ||
    !!(yield* lockRefusal(core, annotationKey, "tags"));
  if (refused && (!standing || names === undefined)) return standing;
  const draft: TagDraft = standing
    ? {
        ...standing,
        held: false,
        ...(names !== undefined && {
          names,
          state: { kind: "editing" } as const,
        }),
      }
    : {
        annotationKey,
        attachmentKey,
        serverID: source!.serverID,
        baseline: held!.record.tags,
        names: names ?? held!.record.tags,
        state: { kind: "editing" },
      };
  setDraft(core, "tags", draft);
  return draft;
});

const submitTags = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  { automatic = false }: { automatic?: boolean } = {},
): Effect.fn.Return<MutationState, WriteRunFailed> {
  const draft = yield* tagDraftFor(core, annotationKey);
  if (!draft) return IDLE;
  if (draft.state.kind === "pending") return mutationFor(core, annotationKey);
  const change = tagChange(draft.baseline, draft.names);
  if (noTagChange(change)) {
    yield* dropDraft(core, "tags", draft);
    return IDLE;
  }
  if (automatic && !(yield* canAutosave(core, draft))) {
    const capability = yield* capabilityFor(core, draft.attachmentKey);
    yield* Effect.logDebug("A tag draft is held for Save tags").pipe(
      Effect.annotateLogs({
        annotationKey,
        state: draft.state.kind,
        capability: capability.kind,
      }),
    );
    setDraft(core, "tags", { ...draft, manualSave: true, held: true });
    return IDLE;
  }
  const blocked =
    (yield* writeBlocked(core, draft.attachmentKey)) ??
    (yield* lockRefusal(core, annotationKey, "tags"));
  if (blocked) {
    setDraft(core, "tags", {
      ...draft,
      manualSave: true,
      held: true,
      state: { kind: "failed", failure: blocked },
    });
    return { kind: "failed", failure: blocked };
  }
  setDraft(core, "tags", { ...draft, state: { kind: "pending" } });
  yield* Effect.logDebug("A tag editing session is saved").pipe(
    Effect.annotateLogs({
      annotationKey,
      added: change.added.length,
      removed: change.removed.length,
    }),
  );
  const outcome = yield* command(core, annotationKey, {
    write: "tags",
    session: true,
    request: (target, record) =>
      tagsPatch(target, mergeTags(annotationTags(record), change)),
    propose: (record) =>
      proposedTags(mergeTags(annotationTags(record), change)),
  });
  const current = core.drafts.tags.get(
    indexedID(draft.serverID, annotationKey),
  );
  if (!current) return outcome;
  if (outcome.kind === "failed") {
    setDraft(core, "tags", {
      ...current,
      manualSave: true,
      held: true,
      state: outcome,
    });
  } else {
    yield* dropDraft(core, "tags", current);
  }
  return outcome;
});

const discardTagDraft = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  const draft = yield* tagDraftFor(core, annotationKey);
  if (draft && draft.state.kind !== "pending")
    yield* dropDraft(core, "tags", draft);
});

const canAutosave = Effect.fnUntraced(function* (
  core: CoreState,
  draft: Pick<TextFieldDraft, "attachmentKey" | "manualSave">,
) {
  const capability = yield* capabilityFor(core, draft.attachmentKey);
  return !draft.manualSave && capability.kind === "writable";
});

function autosave(core: CoreState, field: TextField, annotationKey: string) {
  return FiberSet.run(
    core.fibers,
    submitTextField(core, field, { annotationKey, automatic: true }).pipe(
      recover(
        (cause) =>
          Effect.logWarning("An automatic text save failed", cause).pipe(
            Effect.annotateLogs({ annotationKey, field }),
          ),
        Effect.void,
      ),
    ),
  );
}

const scheduleTextSave = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  draft: TextFieldDraft,
) {
  if (savingText(core, field, draft.annotationKey)) return;
  if (!(yield* canAutosave(core, draft))) return;
  if (sameText(draft.text, draft.baseline)) return;
  const key = saveKey(field, draft);
  const save = autosave(core, field, draft.annotationKey);
  yield* FiberMap.run(
    core.idleSaves,
    key,
    Effect.andThen(Effect.sleep(TEXT_IDLE_SAVE), save),
  );
  yield* FiberMap.run(
    core.burstSaves,
    key,
    Effect.andThen(Effect.sleep(TEXT_BURST_SAVE), save),
    { onlyIfMissing: true },
  );
});

const holdUnsavableDrafts = Effect.fnUntraced(function* (core: CoreState) {
  for (const field of TEXT_FIELDS) {
    const drafts = core.drafts[field];
    for (const [id, draft] of drafts) {
      if ((yield* capabilityFor(core, draft.attachmentKey)).kind === "writable")
        continue;
      yield* cancelTextSave(core, field, draft);
      drafts.set(id, { ...draft, manualSave: true });
      core.publish({
        _tag: "annotation-changed",
        annotationKey: draft.annotationKey,
      });
    }
  }
  for (const draft of core.drafts.tags.values()) {
    if (
      draft.manualSave ||
      (yield* capabilityFor(core, draft.attachmentKey)).kind === "writable"
    )
      continue;
    setDraft(core, "tags", { ...draft, manualSave: true });
  }
  core.publish({ _tag: "capability-changed" });
});

export {
  annotationState,
  textDraftFor,
  editTextField,
  submitTextField,
  discardTextDraft,
  retryTextDraft,
  tagDraftFor,
  editTags,
  submitTags,
  discardTagDraft,
  holdUnsavableDrafts,
};
