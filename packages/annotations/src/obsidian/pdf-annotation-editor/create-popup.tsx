import type { EditorSheetSlotProps } from "#obsidian/annot-view/comment-parts.tsx";
import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type { MutationState } from "#obsidian/annotation-repository/write.ts";
import type { App, IconName } from "obsidian";

import { AppContext } from "@zotlit/obsidian-kit/app-context.ts";
import {
  ANNOTATION_COLORS,
  annotationColorLabel,
  isColor,
} from "@zotlit/plugin-kernel/annotation-colors.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { MarkPopupControl, PopupColumn } from "./mark-popup.tsx";
import { selectionToolOf } from "./tools.ts";
import type { AnnotationTool, MarkTool, SelectionTool } from "./tools.ts";

import { editingBlockedReason } from "#obsidian/annot-view/card-controls.ts";
import { EditorSheetSlot } from "#obsidian/annot-view/comment-parts.tsx";

export type CreatePopupAction =
  | { kind: "tool"; tool: SelectionTool }
  | { kind: "color"; color: string }
  | { kind: "comment" }
  | { kind: "copy" };

export interface CreatePopupControl {
  id: string;
  icon: IconName;
  tooltip: string;
  disabled: boolean;
  color: string | null;
  pressed: boolean | null;
  cls?: readonly string[];
  action: CreatePopupAction;
}

export interface CreatePopupRowInput {
  armed: MarkTool | null;
  colors: Readonly<Record<AnnotationTool, string>>;
  swatches: readonly string[];
  capability: EditingCapability;
  mutation: MutationState;
  commenting: boolean;
  now: Temporal.Instant;
}

export function createPopupRow({
  armed,
  colors,
  swatches,
  capability,
  mutation,
  commenting,
  now,
}: CreatePopupRowInput): readonly CreatePopupControl[] {
  const blocked = editingBlockedReason(capability, mutation, now);
  const tool = selectionToolOf(armed);
  const creating = (
    control: Omit<CreatePopupControl, "disabled" | "tooltip"> & {
      label: string;
    },
  ): CreatePopupControl => ({
    ...control,
    tooltip: blocked ?? control.label,
    disabled: blocked !== null,
  });
  return [
    creating({
      id: "highlight",
      icon: "highlighter",
      label: m.pdf_toolbar_highlight(),
      action: { kind: "tool", tool: "highlight" },
      color: colors.highlight,
      pressed: armed === "highlight",
    }),
    creating({
      id: "underline",
      icon: "underline",
      label: m.pdf_toolbar_underline(),
      action: { kind: "tool", tool: "underline" },
      color: colors.underline,
      pressed: armed === "underline",
    }),
    ...swatches.map((hex) =>
      creating({
        id: `color-${ANNOTATION_COLORS.indexOf(hex) + 1}`,
        icon: "circle",
        label: annotationColorLabel(hex),
        action: { kind: "color", color: hex },
        color: hex,
        pressed: isColor(colors[tool], hex),
        cls: ["zt:[&_svg]:fill-current"],
      }),
    ),
    creating({
      id: "comment",
      icon: "message-square-plus",
      label: m.annot_view_card_add_comment(),
      action: { kind: "comment" },
      color: null,
      pressed: commenting,
    }),
    {
      id: "copy",
      icon: "copy",
      tooltip: m.pdf_create_popup_copy(),
      disabled: false,
      color: null,
      pressed: null,
      action: { kind: "copy" },
    },
  ];
}

export type CreatePopupActivate = (
  action: CreatePopupAction,
  node: HTMLElement,
) => void;

export interface CreateMarkPopupProps {
  app: App;
  controls: readonly CreatePopupControl[];
  activate: CreatePopupActivate;
  sheet: Omit<EditorSheetSlotProps, "app" | "surface"> | null;
}

export function CreateMarkPopup({
  app,
  controls,
  activate,
  sheet,
}: CreateMarkPopupProps) {
  return (
    <AppContext value={app}>
      <PopupColumn
        row={controls.map((control) => (
          <MarkPopupControl
            key={control.id}
            {...control}
            onActivate={(node) => activate(control.action, node)}
          />
        ))}
      >
        {sheet && <EditorSheetSlot app={app} surface="popup" {...sheet} />}
      </PopupColumn>
    </AppContext>
  );
}
