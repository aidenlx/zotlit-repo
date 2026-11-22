import type { CapabilityAffordance } from "#obsidian/annotation-repository/capability-copy.ts";
import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type {
  AnnotationRecord,
  TextFieldDraft,
  AnnotationState,
  TagDraft,
} from "#obsidian/annotation-repository/service.ts";
import type {
  AnnotationTag,
  InkPosition,
  MutationState,
  TextPosition,
} from "#obsidian/annotation-repository/write.ts";

import type { SelectedText } from "@zotlit/pdf-structure";
import { offeredSwatches } from "@zotlit/plugin-kernel/annotation-colors.ts";

import { createPopupRow } from "./create-popup.tsx";
import type {
  CreatePopupControl,
  CreatePopupRowInput,
} from "./create-popup.tsx";
import { creationToolbar } from "./creation-toolbar.ts";
import type { CreationToolbarControl } from "./creation-toolbar.ts";
import { fitStoredTextBox } from "./free-text-layout.ts";
import type { TextMeasure } from "./free-text-layout.ts";
import {
  capturesImage,
  isEditablePosition,
  sameGeometry,
} from "./geometry-edit.ts";
import type {
  EditablePosition,
  Grip,
  PdfPoint,
  PdfRect,
} from "./geometry-edit.ts";
import { markPopupRow } from "./mark-popup.tsx";
import type { MarkPopupRowInput, MarkPopupVerb } from "./mark-popup.tsx";
import { gestureOf } from "./tools.ts";
import type { AnnotationTool, MarkTool } from "./tools.ts";

import { lockBlock } from "#core/annotation-repository/lock.ts";
import {
  annotationBlocks,
  editingLive,
} from "#obsidian/annot-view/card-controls.ts";
import { editingCapabilityAffordance } from "#obsidian/annotation-repository/capability-copy.ts";
import {
  capabilityReason,
  sameDeadline,
} from "#obsidian/annotation-repository/capability.ts";
import {
  IDLE,
  textIdentity,
  writePosition,
} from "#obsidian/annotation-repository/write.ts";

export interface AnchorAt {
  pageIndex: number;
  fx: number;
  fy: number;
}

export interface Adjustment {
  grip: Grip;
  from: PdfPoint;
  proposal: EditablePosition;
  text?: string;
  phase: "pressed" | "dragging" | "saving";
}

export interface Capture {
  kind: "capture";
  pageIndex: number;
  from: PdfPoint;
  rect: PdfRect;
  phase: "pressed" | "dragging" | "saving";
}

export interface TextDraft {
  kind: "text-draft";
  pageIndex: number;
  fontSize: number;
  color: string;
  rotation: 0;
  box: PdfRect;
  text: string;
  phase: "typing" | "saving";
  key?: string;
}

export type Floating =
  | { kind: "none" }
  | {
      kind: "selected";
      key: string;
      stack: readonly string[];
      index: number;
      quiet: boolean;
      commenting: boolean;
      tagging: boolean;
      adjust?: Adjustment;
    }
  | {
      kind: "group";
      keys: readonly string[];
    }
  | {
      kind: "create";
      captured: SelectedText;
      anchorAt: AnchorAt;
      commenting: boolean;
      inFlight: boolean;
    }
  | Capture
  | TextDraft;

export interface LiveStroke extends InkPosition {
  color: string;
}

export interface PendingStroke extends InkPosition {
  id: number;
  color: string;
  key?: string;
}

export interface ReaderSurfaceState {
  armed: MarkTool | null;
  marksVisible: boolean;
  colors: Readonly<Record<AnnotationTool, string>>;
  recentColors: readonly string[];
  capability: EditingCapability;
  capabilityAt: Temporal.Instant;
  now: Temporal.Instant;
  floating: Floating;
  liveStroke: LiveStroke | null;
  pendingStrokes: readonly PendingStroke[];
  records: readonly AnnotationRecord[];
  mutations: ReadonlyMap<string, MutationState>;
  commentDrafts: ReadonlyMap<string, TextFieldDraft>;
  tagDrafts: ReadonlyMap<string, TagDraft>;
}

export type Transition = (state: ReaderSurfaceState) => ReaderSurfaceState;

export type Step<A> = (state: ReaderSurfaceState) => [A, ReaderSurfaceState];

export function initialReaderSurfaceState({
  colors,
  recentColors = [],
  capability,
  now,
}: Pick<ReaderSurfaceState, "colors" | "capability" | "now"> &
  Partial<Pick<ReaderSurfaceState, "recentColors">>): ReaderSurfaceState {
  return {
    armed: null,
    marksVisible: true,
    colors,
    recentColors,
    capability,
    capabilityAt: now,
    now,
    floating: NONE,
    liveStroke: null,
    pendingStrokes: [],
    records: [],
    mutations: new Map(),
    commentDrafts: new Map(),
    tagDrafts: new Map(),
  };
}

export const arm =
  (tool: MarkTool | null): Transition =>
  (state) => {
    const gesture = gestureOf(tool);
    const floating =
      (gesture === "click" || gesture === "stroke") &&
      state.floating.kind !== "text-draft"
        ? NONE
        : state.floating;
    return state.armed === tool && state.floating === floating
      ? state
      : { ...state, armed: tool, floating };
  };

export const toggleMarks: Transition = (state) => ({
  ...state,
  marksVisible: !state.marksVisible,
});

export const ingestCapability =
  (capability: EditingCapability, now: Temporal.Instant): Transition =>
  (state) =>
    sameCapability(state.capability, capability)
      ? tick(now)(state)
      : { ...state, capability, capabilityAt: now, now };

export const tick =
  (now: Temporal.Instant): Transition =>
  (state) =>
    state.now === now ? state : { ...state, now };

const NONE: Floating = { kind: "none" };

function withFloating(
  state: ReaderSurfaceState,
  floating: Floating,
): ReaderSurfaceState {
  return state.floating === floating ? state : { ...state, floating };
}

export const selectMark =
  (
    key: string | null,
    {
      stack,
      quiet = false,
      commenting = false,
    }: {
      stack?: readonly string[];
      quiet?: boolean;
      commenting?: boolean;
    } = {},
  ): Transition =>
  (state) => {
    const { floating } = state;
    if (key === null) return withFloating(state, NONE);
    const same = floating.kind === "selected" && floating.key === key;
    return withFloating(
      state,
      selectedMark(key, stack, {
        quiet,
        commenting: commenting || (same && floating.commenting),
        tagging: !commenting && same && floating.tagging,
      }),
    );
  };

function selectedMark(
  key: string,
  stack: readonly string[] | undefined,
  state: { quiet: boolean; commenting: boolean; tagging: boolean },
): Extract<Floating, { kind: "selected" }> {
  const held = stack?.includes(key) ? stack : [key];
  return {
    kind: "selected",
    key,
    stack: held,
    index: held.indexOf(key),
    ...state,
  };
}

export const selectGroup =
  (keys: readonly string[]): Transition =>
  (state) =>
    withFloating(state, { kind: "group", keys: [...keys] });

export type PopuplessFloating = Extract<
  Floating,
  { kind: "none" | "capture" | "text-draft" | "group" }
>;

export function drawsNoPopup(
  floating: Floating,
): floating is PopuplessFloating {
  return (
    floating.kind === "none" ||
    floating.kind === "capture" ||
    floating.kind === "text-draft" ||
    floating.kind === "group"
  );
}

export const clearFloating: Transition = (state) => withFloating(state, NONE);

export const captureSelection =
  ({
    captured,
    anchorAt,
  }: {
    captured: SelectedText;
    anchorAt: AnchorAt;
  }): Transition =>
  (state) =>
    withFloating(state, {
      kind: "create",
      captured,
      anchorAt,
      commenting: false,
      inFlight: false,
    });

export const stepStack: Transition = (state) => {
  const { floating } = state;
  if (floating.kind !== "selected" || floating.stack.length < 2) return state;
  const index = (floating.index + 1) % floating.stack.length;
  const { adjust: _adjust, ...selected } = floating;
  return withFloating(state, {
    ...selected,
    key: floating.stack[index]!,
    index,
    commenting: false,
    tagging: false,
  });
};

export const beginAdjust =
  ({ grip, from }: Pick<Adjustment, "grip" | "from">): Transition =>
  (state) => {
    const { floating, records } = state;
    if (floating.kind !== "selected") return state;
    const position = records.find(({ key }) => key === floating.key)?.position;
    if (!position || !isEditablePosition(position)) return state;
    return withFloating(state, {
      ...floating,
      adjust: { grip, from, proposal: position, phase: "pressed" },
    });
  };

export const moveAdjust =
  (proposal: EditablePosition, text?: string): Transition =>
  (state) => {
    const { floating } = state;
    if (floating.kind !== "selected" || !floating.adjust) return state;
    const { adjust } = floating;
    if (adjust.phase === "saving") return state;
    if (adjust.phase === "dragging" && sameGeometry(adjust.proposal, proposal))
      return state;
    return withFloating(state, {
      ...floating,
      adjust: {
        ...adjust,
        proposal,
        ...(text !== undefined && { text }),
        phase: "dragging",
      },
    });
  };

export const cancelAdjust: Transition = (state) => {
  const { floating } = state;
  if (floating.kind !== "selected" || !floating.adjust) return state;
  const { adjust: _adjust, ...selected } = floating;
  return withFloating(state, selected);
};

export const endAdjust: Step<EditablePosition | null> = (state) => {
  const { floating, records } = state;
  if (floating.kind !== "selected" || !floating.adjust) return [null, state];
  const { adjust } = floating;
  if (adjust.phase === "saving") return [null, state];
  const confirmed = records.find(({ key }) => key === floating.key)?.position;
  if (
    !confirmed ||
    !isEditablePosition(confirmed) ||
    sameGeometry(confirmed, adjust.proposal)
  )
    return [null, cancelAdjust(state)];
  return [
    adjust.proposal,
    withFloating(state, {
      ...floating,
      adjust: { ...adjust, phase: "saving" },
    }),
  ];
};

export const beginCapture =
  ({ pageIndex, from }: Pick<Capture, "pageIndex" | "from">): Transition =>
  (state) =>
    state.floating.kind === "capture"
      ? state
      : withFloating(state, {
          kind: "capture",
          pageIndex,
          from,
          rect: [from[0], from[1], from[0], from[1]],
          phase: "pressed",
        });

export const moveCapture =
  (rect: PdfRect): Transition =>
  (state) => {
    const { floating } = state;
    if (floating.kind !== "capture" || floating.phase === "saving")
      return state;
    if (
      floating.phase === "dragging" &&
      floating.rect.every((value, index) => value === rect[index])
    )
      return state;
    return withFloating(state, { ...floating, rect, phase: "dragging" });
  };

export const endCapture: Step<PdfRect | null> = (state) => {
  const { floating } = state;
  if (floating.kind !== "capture" || floating.phase === "saving")
    return [null, state];
  if (!capturesImage(floating.rect)) return [null, cancelCapture(state)];
  return [floating.rect, withFloating(state, { ...floating, phase: "saving" })];
};

export const cancelCapture: Transition = (state) =>
  state.floating.kind === "capture" ? clearFloating(state) : state;

export const openTextDraft =
  ({
    pageIndex,
    at,
    fontSize,
    color,
  }: Pick<TextDraft, "pageIndex" | "fontSize" | "color"> & {
    at: PdfPoint;
  }): Transition =>
  (state) => {
    const [x, y] = at;
    const half = fontSize / 2;
    return {
      ...state,
      armed: null,
      floating: {
        kind: "text-draft",
        pageIndex,
        fontSize,
        color,
        rotation: 0,
        box: [x - half, y - half, x + half, y + half],
        text: "",
        phase: "typing",
      },
    };
  };

export const refitTextDraft =
  (
    text: string,
    { measure, pageBox }: { measure: TextMeasure; pageBox: readonly number[] },
  ): Transition =>
  (state) => {
    const draft = selectTextDraft(state);
    if (draft?.phase !== "typing") return state;
    const box = fitStoredTextBox(
      text,
      {
        rects: [[...draft.box]],
        rotation: draft.rotation,
        fontSize: draft.fontSize,
      },
      { measure, pageBox },
    );
    return withFloating(state, { ...draft, text, box });
  };

export const finishTextDraft: Step<TextDraft | null> = (state) => {
  const draft = selectTextDraft(state);
  if (draft?.phase !== "typing") return [null, state];
  if (draft.text.trim() === "") return [null, clearFloating(state)];
  const saving: TextDraft = { ...draft, phase: "saving" };
  return [saving, withFloating(state, saving)];
};

export const settleTextDraft =
  (key: string): Transition =>
  (state) =>
    state.floating.kind === "text-draft"
      ? withFloating(state, heldBy({ ...state.floating, key }, state.records))
      : state;

export const dropTextDraft: Transition = (state) =>
  state.floating.kind === "text-draft" ? clearFloating(state) : state;

export const setCommenting =
  (commenting: boolean): Transition =>
  (state) => {
    const { floating } = state;
    if (drawsNoPopup(floating) || floating.commenting === commenting)
      return state;
    return withFloating(
      state,
      floating.kind === "selected"
        ? {
            ...floating,
            commenting,
            tagging: commenting ? false : floating.tagging,
          }
        : { ...floating, commenting },
    );
  };

export const setTagging =
  (tagging: boolean): Transition =>
  (state) => {
    const { floating } = state;
    if (floating.kind !== "selected" || floating.tagging === tagging)
      return state;
    return withFloating(state, {
      ...floating,
      tagging,
      commenting: tagging ? false : floating.commenting,
    });
  };

export const setInFlight =
  (inFlight: boolean): Transition =>
  (state) => {
    const { floating } = state;
    if (floating.kind !== "create" || floating.inFlight === inFlight)
      return state;
    return withFloating(state, { ...floating, inFlight });
  };

export const ingestRecords =
  (records: readonly AnnotationRecord[]): Transition =>
  (state) => ({
    ...state,
    records,
    floating: heldBy(state.floating, records),
    pendingStrokes: unheldStrokes(state.pendingStrokes, records),
  });

function unheldStrokes(
  pending: readonly PendingStroke[],
  records: readonly AnnotationRecord[],
): readonly PendingStroke[] {
  if (pending.length === 0) return pending;
  const keys = new Set(records.map(({ key }) => key));
  const stored = new Set(
    records.flatMap(({ position, color }) =>
      position.kind === "pdf-ink" && color !== null
        ? [strokeIdentity(position, color)]
        : [],
    ),
  );
  const unheld = pending.filter(
    (stroke) =>
      !(stroke.key !== undefined && keys.has(stroke.key)) &&
      !stored.has(strokeIdentity(stroke, stroke.color)),
  );
  return unheld.length === pending.length ? pending : unheld;
}

function strokeIdentity(position: InkPosition, color: string): string {
  return `${color.toLowerCase()} ${writePosition(position)}`;
}

export const publishLiveStroke =
  (liveStroke: LiveStroke): Transition =>
  (state) => ({ ...state, liveStroke });

export const clearLiveStroke: Transition = (state) =>
  state.liveStroke === null ? state : { ...state, liveStroke: null };

export const appendPendingStroke =
  (stroke: PendingStroke): Transition =>
  (state) => ({ ...state, pendingStrokes: [...state.pendingStrokes, stroke] });

export const settlePendingStroke =
  ({ id, key }: { id: number; key: string }): Transition =>
  (state) => ({
    ...state,
    pendingStrokes: unheldStrokes(
      state.pendingStrokes.map((stroke) =>
        stroke.id === id ? { ...stroke, key } : stroke,
      ),
      state.records,
    ),
  });

export const dropPendingStroke =
  (id: number): Transition =>
  (state) => ({
    ...state,
    pendingStrokes: state.pendingStrokes.filter((stroke) => stroke.id !== id),
  });

function heldBy(
  floating: Floating,
  records: readonly AnnotationRecord[],
): Floating {
  if (floating.kind === "selected")
    return records.some(({ key }) => key === floating.key) ? floating : NONE;
  if (floating.kind === "group") {
    const keys = floating.keys.filter((key) =>
      records.some((record) => record.key === key),
    );
    if (keys.length === floating.keys.length) return floating;
    if (keys.length > 1) return { kind: "group", keys };
    const [key] = keys;
    return key === undefined
      ? NONE
      : selectedMark(key, undefined, {
          quiet: true,
          commenting: false,
          tagging: false,
        });
  }
  if (floating.kind !== "text-draft" || floating.phase !== "saving")
    return floating;
  const identity = textIdentity(textDraftPosition(floating), {
    color: floating.color,
    comment: floating.text,
  });
  return records.some(
    (record) =>
      record.key === floating.key ||
      (record.position.kind === "pdf-text" &&
        textIdentity(record.position, record) === identity),
  )
    ? NONE
    : floating;
}

export function textDraftPosition({
  pageIndex,
  fontSize,
  rotation,
  box,
}: TextDraft): TextPosition & { rects: [PdfRect] } {
  return { pageIndex, fontSize, rotation, rects: [box] };
}

export const dropRecord =
  (key: string): Transition =>
  ({ records, mutations, commentDrafts, tagDrafts, floating, ...state }) => {
    const held = records.filter((record) => record.key !== key);
    const heldMutations = new Map(mutations);
    heldMutations.delete(key);
    return {
      ...state,
      records: held,
      floating: heldBy(floating, held),
      mutations: heldMutations,
      commentDrafts: withDraft(commentDrafts, key, null),
      tagDrafts: withDraft(tagDrafts, key, null),
    };
  };

export const ingestAnnotationState =
  (key: string, annotation: AnnotationState): Transition =>
  (state) => {
    if (annotation.gone) return dropRecord(key)(state);
    let next = state;
    if (annotation.hidden) {
      const comment = next.commentDrafts.get(key);
      const tags = next.tagDrafts.get(key);
      if (comment && hidden(comment, annotation.textDrafts.comment))
        next = hideCommentDraft(key)(next);
      if (tags && hidden(tags, annotation.tagDraft))
        next = hideTagDraft(key)(next);
    }
    next = ingestMutation(key, annotation.mutation)(next);
    next = ingestCommentDraft(key, annotation.textDrafts.comment)(next);
    return ingestTagDraft(key, annotation.tagDraft)(next);
  };

export const ingestMutation =
  (key: string, mutation: MutationState): Transition =>
  (state) => {
    const held = state.mutations;
    if (sameFlat(held.get(key) ?? IDLE, mutation)) return state;
    const mutations = new Map(held);
    if (mutation.kind === "idle") mutations.delete(key);
    else mutations.set(key, mutation);
    return { ...state, mutations };
  };

export const ingestCommentDraft =
  (key: string, draft: TextFieldDraft | null): Transition =>
  (state) => {
    const { commentDrafts, floating } = state;
    if (sameFlat(commentDrafts.get(key) ?? null, draft)) return state;
    return {
      ...state,
      commentDrafts: withDraft(commentDrafts, key, draft),
      floating:
        draft?.state.kind === "conflict"
          ? closedEditor(floating, key)
          : floating,
    };
  };

const ingestTagDraft =
  (key: string, draft: TagDraft | null): Transition =>
  (state) =>
    (state.tagDrafts.get(key) ?? null) === draft
      ? state
      : { ...state, tagDrafts: withDraft(state.tagDrafts, key, draft) };

export const hideCommentDraft =
  (key: string): Transition =>
  (state) => ({
    ...state,
    commentDrafts: withDraft(state.commentDrafts, key, null),
    floating: closedEditor(state.floating, key),
  });

const hideTagDraft =
  (key: string): Transition =>
  (state) => {
    const { tagDrafts, floating } = state;
    return {
      ...state,
      tagDrafts: withDraft(tagDrafts, key, null),
      floating:
        floating.kind === "selected" && floating.key === key && floating.tagging
          ? { ...floating, tagging: false }
          : floating,
    };
  };

function hidden(
  held: { serverID: string },
  now: { serverID: string } | null,
): boolean {
  return now === null || now.serverID !== held.serverID;
}

function withDraft<T>(
  drafts: ReadonlyMap<string, T>,
  key: string,
  draft: T | null,
): ReadonlyMap<string, T> {
  const next = new Map(drafts);
  if (draft) next.set(key, draft);
  else next.delete(key);
  return next;
}

function closedEditor(floating: Floating, key: string): Floating {
  return floating.kind === "selected" &&
    floating.key === key &&
    floating.commenting
    ? { ...floating, commenting: false }
    : floating;
}

export function selectCreationToolbar({
  armed,
  colors,
  marksVisible,
  capability,
  capabilityAt,
}: ReaderSurfaceState): readonly CreationToolbarControl[] {
  return creationToolbar({
    armed,
    colors,
    marksVisible,
    capability,
    now: capabilityAt,
  });
}

export function selectCapabilityAffordance({
  capability,
  now,
}: ReaderSurfaceState): CapabilityAffordance | null {
  return capability.kind === "authorizing" || capability.kind === "cooldown"
    ? editingCapabilityAffordance(capability, now)
    : null;
}

export interface FloatingHead {
  kind: Floating["kind"];
  key: string | null;
  commenting: boolean;
  tagging: boolean;
}

export function selectFloatingHead({
  floating,
}: ReaderSurfaceState): FloatingHead {
  return {
    kind: floating.kind,
    key: floating.kind === "selected" ? floating.key : null,
    commenting: "commenting" in floating && floating.commenting,
    tagging: floating.kind === "selected" && floating.tagging,
  };
}

export function selectTextDraft({
  floating,
}: ReaderSurfaceState): TextDraft | null {
  return floating.kind === "text-draft" ? floating : null;
}

export function selectCapture({
  floating,
}: ReaderSurfaceState): Capture | null {
  return floating.kind === "capture" ? floating : null;
}

export function selectSelectedKey({
  floating,
}: ReaderSurfaceState): string | null {
  return floating.kind === "selected" ? floating.key : null;
}

export function selectMarkHandles(state: ReaderSurfaceState): boolean {
  const key = selectSelectedKey(state);
  if (key === null || !editingLive(state.capability)) return false;
  const record = state.records.find((annotation) => annotation.key === key);
  return lockBlock(record?.lock ?? null, "geometry") === null;
}

export function selectSelectedKeys({
  floating,
}: ReaderSurfaceState): readonly string[] {
  if (floating.kind === "selected") return [floating.key];
  return floating.kind === "group" ? floating.keys : [];
}

export function selectAdjust({
  floating,
}: ReaderSurfaceState): Adjustment | null {
  return floating.kind === "selected" ? (floating.adjust ?? null) : null;
}

export function selectSelectedDraft({
  floating,
  commentDrafts,
}: ReaderSurfaceState): TextFieldDraft | null {
  return floating.kind === "selected"
    ? (commentDrafts.get(floating.key) ?? null)
    : null;
}

export function selectSelectedTagDraft({
  floating,
  tagDrafts,
}: ReaderSurfaceState): TagDraft | null {
  return floating.kind === "selected"
    ? (tagDrafts.get(floating.key) ?? null)
    : null;
}

export interface SelectedRowInput extends MarkPopupRowInput {
  commenting: boolean;
}

export function selectSelectedRowInput({
  floating,
  records,
  mutations,
  capability,
  capabilityAt,
}: ReaderSurfaceState): SelectedRowInput | null {
  if (floating.kind !== "selected") return null;
  const annotation = records.find(({ key }) => key === floating.key);
  if (!annotation) return null;
  return {
    annotation,
    blocks: annotationBlocks({ annotation, capability, now: capabilityAt }),
    mutation: mutations.get(floating.key) ?? IDLE,
    stack: { index: floating.index, total: floating.stack.length },
    commenting: floating.commenting,
    tagging: floating.tagging,
    now: capabilityAt,
  };
}

export interface SelectedRowHead {
  key: string;
  color: string | null;
  stackIndex: number;
  stackTotal: number;
  mutation: MutationState;
  draft: TextFieldDraft | null;
  comment: string | null;
  tagDraft: TagDraft | null;
}

type SelectedRowTag = Pick<AnnotationTag, "name"> &
  Partial<Pick<AnnotationTag, "type">>;

export function selectSelectedRow(
  state: ReaderSurfaceState,
): readonly (MarkPopupVerb | SelectedRowTag | SelectedRowHead)[] {
  const input = selectSelectedRowInput(state);
  if (!input) return [];
  const { verbs, color } = markPopupRow(input);
  const { tags, tagDetails } = input.annotation;
  return [
    ...verbs,
    ...(tagDetails ?? tags.map((name): SelectedRowTag => ({ name }))),
    {
      key: input.annotation.key,
      color,
      stackIndex: input.stack.index,
      stackTotal: input.stack.total,
      mutation: input.mutation,
      draft: selectSelectedDraft(state),
      comment: input.annotation.comment,
      tagDraft: selectSelectedTagDraft(state),
    },
  ];
}

const CREATE_POPUP_SWATCHES = 4;

export function selectCreateRowInput({
  floating,
  armed,
  colors,
  recentColors,
  capability,
  capabilityAt,
}: ReaderSurfaceState): CreatePopupRowInput | null {
  if (floating.kind !== "create") return null;
  return {
    armed,
    colors,
    swatches: offeredSwatches(recentColors, CREATE_POPUP_SWATCHES),
    capability,
    mutation: floating.inFlight ? { kind: "pending", write: "create" } : IDLE,
    commenting: floating.commenting,
    now: capabilityAt,
  };
}

export function selectCreateRow(
  state: ReaderSurfaceState,
): readonly Omit<CreatePopupControl, "action" | "cls">[] {
  const input = selectCreateRowInput(state);
  return input
    ? createPopupRow(input).map(
        ({ action: _action, cls: _cls, ...control }) => control,
      )
    : [];
}

export function sameCapability(
  a: EditingCapability,
  b: EditingCapability,
): boolean {
  if (capabilityReason(a) !== capabilityReason(b)) return false;
  return a.kind === "cooldown" && b.kind === "cooldown"
    ? sameDeadline(a.retryAfter, b.retryAfter)
    : true;
}

export function sameFlat<T extends object>(a: T | null, b: T | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a) as (keyof T)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  );
}

export function sameFlatList<T extends object>(
  a: readonly T[],
  b: readonly T[],
): boolean {
  return (
    a.length === b.length &&
    a.every((record, index) => sameFlat(record, b[index]!))
  );
}
