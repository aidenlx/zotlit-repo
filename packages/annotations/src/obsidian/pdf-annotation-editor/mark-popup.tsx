import type {
  CardBlock,
  CardControl,
  HeldDraft,
  VerbBlocks,
} from "#obsidian/annot-view/card-controls.ts";
import type {
  CommentEntry,
  EditorSheetSlotProps,
} from "#obsidian/annot-view/comment-parts.tsx";
import type { CommentRenderer } from "#obsidian/annot-view/comment-render.ts";
import type { TextDraftActions } from "#obsidian/annot-view/editor-sheet.ts";
import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import type {
  MutationState,
  WriteConflict,
} from "#obsidian/annotation-repository/write.ts";
import type { App, HoverParent, IconName } from "obsidian";
import type { CSSProperties, ReactNode } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

import { AppContext } from "@zotlit/obsidian-kit/app-context.ts";
import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { HoverPopover } from "@zotlit/obsidian-kit/hover-popover.ts";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { Point } from "./hit-test.ts";
import type { MarkPopupTagSectionProps } from "./mark-popup-tags.tsx";
import { MarkPopupTagSection } from "./mark-popup-tags.tsx";

import { cardControls } from "#obsidian/annot-view/card-controls.ts";
import {
  CommentView,
  ConflictPanelSlot,
  EditorSheetSlot,
  HeldDraftSlot,
} from "#obsidian/annot-view/comment-parts.tsx";
import { copiedText } from "#obsidian/annot-view/copied-text.ts";
import { commentFrameClass } from "#obsidian/annot-view/editor-sheet.ts";
import "./style.css";

const ROW_CLASSES = ["zt:flex", "zt:items-center", "zt:gap-0.5", "zt:p-1"];

export type MarkPopupVerbId = "color" | "tags" | "copy" | "delete" | "reveal";

export type MarkPopupControlId = MarkPopupVerbId | "stack";

export type MarkPopupActivate = (
  id: MarkPopupControlId,
  node: HTMLElement,
) => void;

export interface MarkPopupVerb {
  id: MarkPopupVerbId;
  icon: IconName;
  tooltip: string;
  disabled: boolean;
  pressed: boolean | null;
}

export interface MarkStack {
  index: number;
  total: number;
}

export interface MarkPopupStepper {
  tooltip: string;
  text: string;
}

export interface MarkPopupRow {
  verbs: readonly MarkPopupVerb[];
  color: string | null;
  stepper: MarkPopupStepper | null;
  comment: CardControl;
}

export interface MarkPopupRowInput {
  annotation: AnnotationRecord;
  blocks: VerbBlocks;
  mutation: MutationState;
  stack: MarkStack;
  tagging: boolean;
  now: Temporal.Instant;
}

export function markPopupRow({
  annotation,
  blocks,
  mutation,
  stack,
  tagging,
}: MarkPopupRowInput): MarkPopupRow {
  const { comment, ...controls } = cardControls({
    blocks,
    mutation,
    hasTags: annotation.tags.length > 0,
    type: annotation.type,
  });
  const editing = (
    id: MarkPopupVerbId,
    icon: IconName,
    { disabled, blocked, tooltip }: CardControl,
  ) => ({
    id,
    icon,
    tooltip: blocked?.reason ?? tooltip,
    disabled: disabled || blocked !== null,
    pressed: null,
  });
  return {
    color: annotation.color,
    comment,
    verbs: [
      editing("color", "palette", controls.color),
      { ...editing("tags", "tag", controls.tags), pressed: tagging },
      {
        id: "copy",
        icon: "copy",
        tooltip: m.annot_view_menu_copy_text(),
        disabled: copiedText([annotation]) === "",
        pressed: null,
      },
      editing("delete", "trash-2", controls.delete),
      {
        id: "reveal",
        icon: "panel-right-open",
        tooltip: m.pdf_mark_popup_reveal(),
        disabled: false,
        pressed: null,
      },
    ],
    stepper:
      stack.total > 1
        ? {
            tooltip: m.pdf_mark_popup_next_in_stack({
              position: stack.index + 1,
              total: stack.total,
            }),
            text: `${stack.index + 1}/${stack.total}`,
          }
        : null,
  };
}

export function MarkPopupVerbs({
  row: { verbs, color, stepper },
  activate,
}: {
  row: MarkPopupRow;
  activate: MarkPopupActivate;
}) {
  return (
    <>
      {verbs.map((verb) => (
        <MarkPopupControl
          key={verb.id}
          {...verb}
          color={verb.id === "color" ? color : null}
          onActivate={(node) => activate(verb.id, node)}
        />
      ))}
      {stepper && (
        <MarkPopupControl
          key="stack"
          id="stack"
          icon="chevrons-right"
          tooltip={stepper.tooltip}
          onActivate={(node) => activate("stack", node)}
        >
          <span className="zt:text-xs zt:tabular-nums">{stepper.text}</span>
        </MarkPopupControl>
      )}
    </>
  );
}

const TINTED = "zt:[&_svg]:text-(--zt-verb-color)";

export interface MarkPopupControlProps {
  id: string;
  icon: IconName;
  tooltip: string;
  disabled?: boolean;
  color?: string | null;
  pressed?: boolean | null;
  cls?: readonly string[];
  children?: ReactNode;
  onActivate: (node: HTMLElement) => void;
}

export function MarkPopupControl({
  id,
  icon,
  tooltip,
  disabled = false,
  color = null,
  pressed = null,
  cls,
  children,
  onActivate,
}: MarkPopupControlProps) {
  const style =
    color === null
      ? undefined
      : ({ "--zt-verb-color": color } as CSSProperties);
  return (
    <IconButton
      icon={icon}
      blocked={disabled}
      pressed={pressed ?? undefined}
      data-zt-verb={id}
      {...tooltipAttrs(tooltip)}
      className={cn(color !== null && TINTED, cls)}
      style={style}
      onClick={(event) => onActivate(event.currentTarget)}
    >
      {children}
    </IconButton>
  );
}

export function PopupColumn({
  row,
  children,
}: {
  row: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="zt:flex zt:flex-col zt:gap-1">
      <div className="zt:flex zt:items-center zt:gap-0.5 zt:self-center">
        {row}
      </div>
      {children}
    </div>
  );
}

export type SelectedPopupComment =
  | { kind: "sheet"; sheet: Omit<EditorSheetSlotProps, "app" | "surface"> }
  | {
      kind: "held";
      held: HeldDraft;
      actions: TextDraftActions;
      entry: CommentEntry;
    }
  | {
      kind: "view";
      html: string | null;
      render: CommentRenderer;
      entry: CommentEntry;
    };

export interface SelectedMarkPopupProps {
  app: App;
  row: MarkPopupRow;
  activate: MarkPopupActivate;
  comment: SelectedPopupComment;
  conflict: {
    conflict: WriteConflict;
    block: CardBlock | null;
    actions: TextDraftActions;
  } | null;
  tags: MarkPopupTagSectionProps | null;
}

export function SelectedMarkPopup({
  app,
  row,
  activate,
  comment,
  conflict,
  tags,
}: SelectedMarkPopupProps) {
  return (
    <AppContext value={app}>
      <PopupColumn row={<MarkPopupVerbs row={row} activate={activate} />}>
        <div className="zt-pdf-comment-slot">
          <PopupCommentBody app={app} comment={comment} />
        </div>
        {conflict && <ConflictPanelSlot surface="popup" {...conflict} />}
        {tags && <MarkPopupTagSection {...tags} />}
      </PopupColumn>
    </AppContext>
  );
}

function PopupCommentBody({
  app,
  comment,
}: {
  app: App;
  comment: SelectedPopupComment;
}) {
  switch (comment.kind) {
    case "sheet":
      return <EditorSheetSlot app={app} surface="popup" {...comment.sheet} />;
    case "held":
      return (
        <HeldDraftSlot
          held={comment.held}
          surface="popup"
          actions={comment.actions}
          entry={comment.entry}
        />
      );
    case "view":
      return (
        <div className={cn(commentFrameClass("popup"), "zt:w-auto zt:min-w-0")}>
          <CommentView
            surface="popup"
            render={comment.render}
            html={comment.html}
            entry={comment.entry}
          />
        </div>
      );
  }
}

export interface MarkPopupDeps {
  parent: HoverParent;
  anchor: Point;
  doc: () => Document;
  render: (content: HTMLElement) => ReactNode | undefined;
  onHide?: () => void;
}

export class MarkPopup extends HoverPopover {
  readonly #content: HTMLElement;
  readonly #root: Root;
  readonly #render;
  readonly #doc;
  #anchor: Point;
  #mounted = true;
  #rendering = false;
  #again = false;
  #resize: ResizeObserver | null = null;
  #resizeWin: Window | null = null;

  constructor({ parent, anchor, doc, render, onHide }: MarkPopupDeps) {
    super(parent, null, 0, anchor);
    this.#anchor = anchor;
    this.#doc = doc;
    this.setIsFocused(true);
    this.hoverEl.addClass(themeHook.pdfMarkPopup);
    this.#render = render;
    this.#content = this.hoverEl.createDiv({
      cls: ["zt-root", ...ROW_CLASSES],
    });
    this.#root = createRoot(this.#content);
    this.register(() => {
      onHide?.();
      this.#resize?.disconnect();
      this.#mounted = false;
      this.#root.unmount();
    });
  }

  open(): void {
    this.showNow();
    this.refresh();
    if (this.#mounted) this.position();
  }

  retarget(anchor: Point): void {
    this.#anchor = anchor;
    this.position();
  }

  refresh(): void {
    if (this.#rendering) {
      this.#again = true;
      return;
    }
    this.#rendering = true;
    try {
      do {
        this.#again = false;
        if (!this.#mounted) return;
        const view = this.#render(this.#content);
        if (view !== undefined && this.#mounted) this.#root.render(view);
      } while (this.#again);
    } finally {
      this.#rendering = false;
    }
  }

  protected override homeDocument(): Document {
    return this.#doc();
  }

  override position(): void {
    const { x, y } = this.#anchor;
    if (!this.hoverEl.isConnected) {
      this.staticPos = this.#anchor;
      super.position();
    }
    this.staticPos = { x: x - this.hoverEl.offsetWidth / 2, y };
    super.position();
    this.#watchResize();
  }

  #watchResize(): void {
    const win = this.hoverEl.win;
    if (!this.hoverEl.isConnected || this.#resizeWin === win) return;
    this.#resize?.disconnect();
    this.#resizeWin = win;
    const resize = new (win as Window & typeof window).ResizeObserver(() => {
      if (this.hoverEl.isConnected) this.position();
    });
    resize.observe(this.#content);
    this.#resize = resize;
  }
}
