import type { WriteConflict } from "#obsidian/annotation-repository/write.ts";
import type { App } from "obsidian";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { HTMLAttributes, RefObject } from "react";

import { claimClick, cn } from "@zotlit/obsidian-kit/utils.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { conflictPanel } from "./card-conflict.ts";
import { sameHeldDraft } from "./card-controls.ts";
import type { CardBlock, CardControl, HeldDraft } from "./card-controls.ts";
import type { CommentRenderer } from "./comment-render.ts";
import {
  clickEdits,
  commentViewClass,
  renderEditorSheet,
  renderConflictPanel,
  renderHeldDraftPanel,
} from "./editor-sheet.ts";
import type {
  CommentEntry,
  ConflictActions,
  HeldDraftActions,
  EditorSheet,
  EditorSheetProps,
  EditorSheetStatus,
  EditorSurface,
} from "./editor-sheet.ts";

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "children">;

export type { CommentEntry } from "./editor-sheet.ts";

export function controlEntry(
  control: CardControl,
  onPress: CommentEntry["onPress"],
): CommentEntry {
  return {
    disabled: control.disabled,
    blocked: control.blocked !== null,
    onPress,
  };
}

export function CommentView({
  surface,
  render,
  html,
  entry,
}: {
  surface: EditorSurface;
  render: CommentRenderer;
  html: string | null;
  entry?: CommentEntry;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const labelId = useUniqueId();
  useLayoutEffect(() => {
    if (!ref.current || html === null) return;
    return render(ref.current, html);
  }, [render, html]);
  const empty = html === null;
  const label = (
    <span key="label" id={labelId} hidden>
      {m.annot_view_card_comment_label()}
    </span>
  );
  if (!entry) {
    return (
      <>
        {label}
        <div
          key="comment"
          ref={ref}
          className={commentViewClass(surface, false)}
        />
      </>
    );
  }
  const { disabled, blocked, onPress } = entry;
  const editable = !disabled && !blocked;
  return (
    <>
      {label}
      <div
        key={empty ? "empty" : "comment"}
        ref={ref}
        role="textbox"
        aria-multiline
        aria-labelledby={labelId}
        aria-placeholder={m.annot_view_card_comment_placeholder()}
        aria-readonly={blocked || undefined}
        aria-disabled={disabled || undefined}
        tabIndex={0}
        className={cn(
          themeHook.annotCommentField,
          commentViewClass(surface, editable),
          empty && "zt:text-faint",
          empty && !editable && "zt:opacity-60",
        )}
        data-blocked={blocked ? "" : undefined}
        onClick={(e) => {
          if (disabled || !clickEdits(e)) return;
          claimClick(e);
          onPress(e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined);
        }}
        onFocus={(e) => {
          if (editable && e.currentTarget.matches(":focus-visible")) onPress();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) onPress();
        }}
      >
        {empty ? m.annot_view_card_comment_placeholder() : null}
      </div>
    </>
  );
}

export interface EditorSheetSlotProps
  extends
    Omit<EditorSheetProps, "app" | "surface">,
    Omit<DivProps, "onChange" | "onSubmit"> {
  app: App;
  surface: EditorSurface;
  text?: string;
  status: EditorSheetStatus;
  sheetRef?: RefObject<EditorSheet | null>;
}

export function EditorSheetSlot({
  app,
  surface,
  field,
  value,
  text,
  status,
  sheetRef,
  onChange,
  onSubmit,
  onSave,
  onCancel,
  commit,
  onLeave,
  within,
  caretAt,
  ...rest
}: EditorSheetSlotProps) {
  const latest = useRef({
    field,
    value,
    status,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    commit,
    onLeave,
    caretAt,
  });
  latest.current = {
    field,
    value,
    status,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    commit,
    onLeave,
    caretAt,
  };
  const sheet = useRef<EditorSheet | null>(null);
  const saves = onSave !== undefined;
  const leaves = onLeave !== undefined;
  const commitLabel = commit?.label;

  const mount = useCallback(
    (el: HTMLDivElement | null) => {
      const gone = sheet.current;
      gone?.[Symbol.dispose]();
      sheet.current = null;
      if (sheetRef?.current === gone) sheetRef.current = null;
      if (!el) return;
      const at = latest.current;
      sheet.current = renderEditorSheet(
        el,
        {
          app,
          surface,
          field: at.field,
          value: at.value,
          onChange: (value) => latest.current.onChange?.(value),
          onSubmit: () => latest.current.onSubmit(),
          onSave: saves ? () => latest.current.onSave?.() : undefined,
          onCancel: () => latest.current.onCancel(),
          commit:
            commitLabel === undefined
              ? undefined
              : {
                  label: commitLabel,
                  run: () => latest.current.commit?.run(),
                },
          onLeave: leaves ? () => latest.current.onLeave?.() : undefined,
          within,
          caretAt: at.caretAt,
        },
        at.status,
      );
      if (sheetRef) sheetRef.current = sheet.current;
    },
    [app, surface, saves, leaves, commitLabel, within, sheetRef],
  );

  useLayoutEffect(() => {
    if (text !== undefined) sheet.current?.editor.setText(text);
  }, [text]);

  const { readOnly, hint, manual, saveDisabled } = status;
  useLayoutEffect(() => {
    sheet.current?.update({ readOnly, hint, manual, saveDisabled });
  }, [readOnly, hint, manual, saveDisabled]);

  return <div ref={mount} {...rest} />;
}

export function HeldDraftSlot({
  held,
  surface,
  actions,
  entry,
  ...rest
}: {
  held: HeldDraft;
  surface: EditorSurface;
  actions: HeldDraftActions;
  entry?: CommentEntry;
} & DivProps) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(actions);
  latest.current = actions;
  const latestPress = useRef(entry?.onPress);
  latestPress.current = entry?.onPress;
  const opens = entry !== undefined;
  const disabled = entry?.disabled ?? false;
  const blocked = entry?.blocked ?? false;
  const shown = useRef(held);
  if (!sameHeldDraft(shown.current, held)) shown.current = held;
  const stable = shown.current;
  useLayoutEffect(() => {
    if (!ref.current) return;
    renderHeldDraftPanel(ref.current, stable, {
      surface,
      actions: boundHeldActions(latest),
      entry: opens
        ? { disabled, blocked, onPress: () => latestPress.current?.() }
        : undefined,
    });
  }, [stable, surface, opens, disabled, blocked]);
  return <div ref={ref} {...rest} />;
}

export function ConflictPanelSlot({
  conflict,
  block,
  surface,
  actions,
}: {
  conflict: WriteConflict;
  block: CardBlock | null;
  surface: EditorSurface;
  actions: ConflictActions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(actions);
  latest.current = actions;
  const panel = useMemo(
    () => conflictPanel(conflict, block),
    [conflict, block],
  );
  const live = block === null;
  useLayoutEffect(() => {
    if (!ref.current) return;
    renderConflictPanel(ref.current, panel, {
      surface,
      live,
      actions: boundConflictActions(latest),
    });
  }, [panel, live, surface]);
  return <div ref={ref} />;
}

function boundHeldActions(
  latest: RefObject<HeldDraftActions>,
): HeldDraftActions {
  return {
    save: () => latest.current.save(),
    allowEditing: () => latest.current.allowEditing(),
    discard: () => latest.current.discard(),
  };
}

function boundConflictActions(
  latest: RefObject<ConflictActions>,
): ConflictActions {
  return {
    applyAgain: () => latest.current.applyAgain(),
    discardConflict: () => latest.current.discardConflict(),
  };
}
