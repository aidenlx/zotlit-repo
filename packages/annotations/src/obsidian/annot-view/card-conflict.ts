import type {
  TextField,
  WriteConflict,
} from "#obsidian/annotation-repository/service.ts";

import { annotationColorLabel } from "@zotlit/plugin-kernel/annotation-colors.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { noRetryLands } from "./card-controls.ts";
import type { CardBlock } from "./card-controls.ts";

import { isTextField } from "#obsidian/annotation-repository/write.ts";

export interface ConflictValue {
  label: string;
  value: string;
}

export type ConflictVerb = "apply-again" | "delete-anyway" | "discard";

export interface ConflictAction {
  kind: ConflictVerb;
  label: string;
}

export interface ConflictPanel {
  title: string;
  values: readonly ConflictValue[];
  prompt: string | null;
  actions: readonly ConflictAction[];
}

const TEXT_FIELD_VERBS: Record<
  TextField,
  () => { applyAgain: string; discard: string }
> = {
  comment: () => ({
    applyAgain: m.annot_view_conflict_use_comment(),
    discard: m.annot_view_conflict_keep_zotero_comment(),
  }),
  text: () => ({
    applyAgain: m.annot_view_conflict_use_text(),
    discard: m.annot_view_conflict_keep_zotero_text(),
  }),
};

export function conflictPanel(
  conflict: WriteConflict,
  block: CardBlock | null = null,
): ConflictPanel {
  const panel = verbPanel(conflict);
  return noRetryLands(block)
    ? {
        ...panel,
        actions: panel.actions.filter(({ kind }) => kind === "discard"),
      }
    : panel;
}

function verbPanel(conflict: WriteConflict): ConflictPanel {
  const verbs = isTextField(conflict.write)
    ? TEXT_FIELD_VERBS[conflict.write]()
    : null;
  const discard: ConflictAction = {
    kind: "discard",
    label: verbs?.discard ?? m.annot_view_conflict_discard(),
  };
  if (conflict.write === "delete") {
    return {
      title: m.annot_view_conflict_title(),
      values: [],
      prompt: m.annot_view_conflict_delete_prompt(),
      actions: [
        {
          kind: "delete-anyway",
          label: m.annot_view_conflict_delete_anyway(),
        },
        discard,
      ],
    };
  }
  if (conflict.write === "geometry") {
    const { attempted, fresh } = conflict;
    return {
      title: m.annot_view_conflict_title(),
      values:
        attempted.text === undefined
          ? []
          : [
              {
                label: m.annot_view_conflict_fresh(),
                value: fresh.text || m.annot_view_conflict_no_value(),
              },
              {
                label: m.annot_view_conflict_attempted(),
                value: attempted.text,
              },
            ],
      prompt: m.annot_view_conflict_geometry_prompt(),
      actions: [
        { kind: "apply-again", label: m.annot_view_conflict_apply_again() },
        discard,
      ],
    };
  }
  const show = (value: string | null): string =>
    value === null || value === ""
      ? m.annot_view_conflict_no_value()
      : conflict.write === "color"
        ? annotationColorLabel(value.toLowerCase())
        : value;
  return {
    title: m.annot_view_conflict_title(),
    values: [
      { label: m.annot_view_conflict_fresh(), value: show(conflict.fresh) },
      {
        label: m.annot_view_conflict_attempted(),
        value: show(conflict.attempted),
      },
    ],
    prompt: null,
    actions: [
      {
        kind: "apply-again",
        label: verbs?.applyAgain ?? m.annot_view_conflict_apply_again(),
      },
      discard,
    ],
  };
}
