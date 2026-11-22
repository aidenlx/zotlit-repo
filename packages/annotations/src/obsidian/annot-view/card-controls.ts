import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type {
  AnnotationRecord,
  TagDraft,
  TextField,
  TextFieldDraft,
} from "#obsidian/annotation-repository/service.ts";
import type {
  ConflictedWrite,
  MutationState,
  WriteFailure,
} from "#obsidian/annotation-repository/write.ts";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { FieldEditorWording } from "./field-editor.ts";

import { lockBlock } from "#core/annotation-repository/lock.ts";
import { editingCapabilityCopy } from "#obsidian/annotation-repository/capability-copy.ts";
import {
  isTextField,
  noTagChange,
  tagChange,
  writeFailureMessage,
} from "#obsidian/annotation-repository/write.ts";

export interface CardBlock {
  reason: string;
  action: "allow-editing" | null;
  source: "capability" | "lock";
}

export interface CardControl {
  disabled: boolean;
  blocked: CardBlock | null;
  tooltip: string;
}

export interface CardControlsInput {
  blocks: VerbBlocks;
  mutation: MutationState;
  hasTags: boolean;
  type: ResolvedAnnotationTypeName;
}

export interface CardControls {
  color: CardControl;
  comment: CardControl;
  tags: CardControl;
  text: CardControl | null;
  delete: CardControl;
}

export type CardVerb = keyof CardControls;

export type VerbBlocks = Readonly<Record<CardVerb, CardBlock | null>>;

export function capabilityBlocks(
  capability: EditingCapability,
  now: Temporal.Instant,
): VerbBlocks {
  const block = capabilityBlock(capability, now);
  return {
    color: block,
    comment: block,
    tags: block,
    text: block,
    delete: block,
  };
}

export function annotationBlocks({
  annotation: { lock },
  capability,
  now,
}: {
  annotation: Pick<AnnotationRecord, "lock">;
  capability: EditingCapability;
  now: Temporal.Instant;
}): VerbBlocks {
  const blocks = capabilityBlocks(capability, now);
  if (lock === null) return blocks;
  const block = (verb: CardVerb): CardBlock | null =>
    blocks[verb] ?? lockBlock(lock, verb);
  return {
    color: block("color"),
    comment: block("comment"),
    tags: block("tags"),
    text: block("text"),
    delete: block("delete"),
  };
}

export function noRetryLands(block: CardBlock | null): boolean {
  return block?.source === "lock";
}

export function conflictBlock(
  blocks: VerbBlocks,
  write: ConflictedWrite,
): CardBlock | null {
  return blocks[write === "geometry" ? "color" : write];
}

export function editingLive(capability: EditingCapability): boolean {
  return capability.kind === "writable";
}

export function cardControls({
  blocks,
  mutation,
  hasTags,
  type,
}: CardControlsInput): CardControls {
  const pending = gestureInFlight(mutation);
  const control = (verb: CardVerb, label: string): CardControl => {
    if (pending)
      return {
        disabled: true,
        blocked: null,
        tooltip: m.annot_view_card_saving(),
      };
    const blocked = blocks[verb];
    if (blocked === null)
      return { disabled: false, blocked: null, tooltip: label };
    return { disabled: false, blocked, tooltip: label };
  };
  return {
    color: control("color", m.annot_view_card_color()),
    comment: control("comment", m.annot_view_card_comment_label()),
    tags: control(
      "tags",
      hasTags ? m.annot_view_card_edit_tags() : m.annot_view_card_add_tags(),
    ),
    delete: control("delete", m.annot_view_menu_delete()),
    text: hasQuotedText(type)
      ? control("text", m.annot_view_menu_edit_text())
      : null,
  };
}

export function pressControl(
  control: CardControl,
  {
    act,
    onBlocked,
  }: { act: () => void; onBlocked: (block: CardBlock) => void },
): void {
  if (control.disabled) return;
  if (control.blocked) onBlocked(control.blocked);
  else act();
}

export function hasQuotedText(type: ResolvedAnnotationTypeName): boolean {
  return type === "highlight" || type === "underline";
}

export function groupControl(
  controls: readonly CardControl[],
): Pick<CardControl, "disabled" | "blocked"> {
  const disabled = controls.some((control) => control.disabled);
  return {
    disabled,
    blocked: disabled
      ? null
      : (controls.find((control) => control.blocked)?.blocked ?? null),
  };
}

export function editingBlockedReason(
  capability: EditingCapability,
  mutation: MutationState,
  now: Temporal.Instant,
): string | null {
  if (gestureInFlight(mutation)) return m.annot_view_card_saving();
  return capabilityBlock(capability, now)?.reason ?? null;
}

function gestureInFlight(mutation: MutationState): boolean {
  return (
    mutation.kind === "pending" &&
    !isTextField(mutation.write) &&
    !mutation.session
  );
}

export function capabilityBlock(
  capability: EditingCapability,
  now: Temporal.Instant,
): CardBlock | null {
  if (editingLive(capability)) return null;
  const copy = editingCapabilityCopy(capability, now);
  return {
    reason: copy.detail ?? copy.label,
    action:
      capability.kind === "authorization-required" ? "allow-editing" : null,
    source: "capability",
  };
}

export function fieldEditorControls(
  block: CardBlock | null,
  draft: TextFieldDraft | null,
  now: Temporal.Instant,
) {
  const available = block === null;
  const manual = !!draft?.manualSave;
  const pending = manual && draft?.state.kind === "pending";
  let hint: string | null = null;
  if (pending) hint = m.annot_view_card_saving();
  else if (draft?.state.kind === "failed")
    hint = failedSaveReason(block, draft.state.failure, now);
  else if (block) hint = block.reason;
  return {
    readOnly: !available,
    saveDisabled: !available || pending,
    manual,
    hint,
  };
}

function failedSaveReason(
  block: CardBlock | null,
  failure: WriteFailure,
  now: Temporal.Instant,
): string {
  if (failure.kind === "unauthorized" || failure.kind === "locked")
    return block?.reason ?? writeFailureMessage(failure, now);
  if (failure.kind === "unknown-outcome" || failure.kind === "unreachable")
    return m.annot_view_comment_unconfirmed();
  return writeFailureMessage(failure, now);
}

export function tagEditorControls(
  block: CardBlock | null,
  draft: TagDraft | null,
  now: Temporal.Instant,
): { readOnly: boolean; hint: string | null } {
  let hint: string | null = null;
  if (draft?.state.kind === "failed")
    hint = failedSaveReason(block, draft.state.failure, now);
  else if (block) hint = block.reason;
  return { readOnly: block !== null, hint };
}

export function shownTagNames(
  record: Pick<AnnotationRecord, "tags">,
  draft: TagDraft | null,
): readonly string[] {
  return draft && draft.state.kind !== "pending" ? draft.names : record.tags;
}

export function shownComment(
  record: Pick<AnnotationRecord, "comment">,
  draft: TextFieldDraft | null,
): string {
  return shownText(record.comment, draft);
}

export function shownText(
  confirmed: string | null,
  draft: TextFieldDraft | null,
): string {
  return draft ? draft.text : (confirmed ?? "");
}

export interface HeldDraftAction {
  kind: "save" | "allow-editing" | "discard";
  label: string;
  enabled: boolean;
  primary: boolean;
}

export interface HeldDraft {
  title: string;
  text: string;
  reason: string | null;
  actions: readonly HeldDraftAction[];
}

export interface TextFieldWording extends FieldEditorWording {
  save: string;
  draft: string;
}

const TEXT_FIELD_WORDING: Record<TextField, () => TextFieldWording> = {
  comment: () => ({
    placeholder: m.annot_view_card_comment_placeholder(),
    label: m.annot_view_card_comment_label(),
    save: m.annot_view_comment_save(),
    draft: m.annot_view_comment_draft(),
  }),
  text: () => ({
    placeholder: m.annot_view_card_text_placeholder(),
    label: m.annot_view_card_text_label(),
    save: m.annot_view_text_save(),
    draft: m.annot_view_text_draft(),
  }),
};

export function textFieldWording(field: TextField): TextFieldWording {
  return TEXT_FIELD_WORDING[field]();
}

export function heldTextDraft(
  field: TextField,
  draft: TextFieldDraft | null,
  { block, now }: { block: CardBlock | null; now: Temporal.Instant },
): HeldDraft | null {
  if (!draft) return null;
  if (draft.state.kind === "pending" || draft.state.kind === "conflict")
    return null;
  if (draft.text === draft.baseline) return null;
  const { hint, manual, saveDisabled } = fieldEditorControls(block, draft, now);
  if (!manual && !saveDisabled) return null;
  const { draft: title, save } = textFieldWording(field);
  return {
    title,
    text: draft.text,
    reason: block?.reason ?? hint,
    actions: heldDraftActions(block, { save, saveDisabled }),
  };
}

export interface HeldTags {
  names: readonly string[];
  reason: string | null;
  actions: readonly HeldDraftAction[];
}

export function heldTagDraft(
  block: CardBlock | null,
  draft: TagDraft | null,
  now: Temporal.Instant,
): HeldTags | null {
  if (!draft?.held || draft.state.kind === "pending") return null;
  if (noTagChange(tagChange(draft.baseline, draft.names))) return null;
  return {
    names: draft.names,
    reason:
      block?.reason ??
      (draft.state.kind === "failed"
        ? failedSaveReason(block, draft.state.failure, now)
        : null),
    actions: heldDraftActions(block, {
      save: m.annot_view_tags_save(),
      saveDisabled: block !== null,
    }),
  };
}

export function sameHeldTags(a: HeldTags, b: HeldTags): boolean {
  return (
    a.reason === b.reason &&
    a.names.length === b.names.length &&
    a.names.every((name, i) => name === b.names[i]) &&
    sameHeldActions(a.actions, b.actions)
  );
}

export function sameHeldDraft(a: HeldDraft, b: HeldDraft): boolean {
  return (
    a.title === b.title &&
    a.text === b.text &&
    a.reason === b.reason &&
    sameHeldActions(a.actions, b.actions)
  );
}

function sameHeldActions(
  a: readonly HeldDraftAction[],
  b: readonly HeldDraftAction[],
): boolean {
  return (
    a.length === b.length &&
    a.every((action, i) => {
      const other = b[i]!;
      return (
        action.kind === other.kind &&
        action.label === other.label &&
        action.enabled === other.enabled &&
        action.primary === other.primary
      );
    })
  );
}

function heldDraftActions(
  block: CardBlock | null,
  { save, saveDisabled }: { save: string; saveDisabled: boolean },
): HeldDraftAction[] {
  const actions: HeldDraftAction[] = noRetryLands(block)
    ? []
    : [
        {
          kind: "save",
          label: save,
          enabled: !saveDisabled,
          primary: !saveDisabled,
        },
      ];
  if (block?.action === "allow-editing") {
    actions.push({
      kind: "allow-editing",
      label: m.capability_enable_editing(),
      enabled: true,
      primary: saveDisabled,
    });
  }
  actions.push({
    kind: "discard",
    label: m.annot_view_comment_discard(),
    enabled: true,
    primary: false,
  });
  return actions;
}
