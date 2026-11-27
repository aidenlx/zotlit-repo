import type { App } from "obsidian";
import { setIcon } from "obsidian";

import { claimClick } from "@zotlit/obsidian-kit/utils.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { ConflictPanel, ConflictVerb } from "./card-conflict.ts";
import type {
  fieldEditorControls,
  HeldDraft,
  HeldDraftAction,
  HeldTags,
} from "./card-controls.ts";
import type { FieldEditor, FieldEditorWording } from "./field-editor.ts";
import { createFieldEditor } from "./field-editor.ts";

import { tagChipVariants } from "#core/annot-view/tag-chip.ts";

export type EditorSurface = "card" | "excerpt" | "popup";

const FIELD =
  "zt-annot-comment-editor zt:relative zt:bg-(--background-modifier-hover) zt:text-foreground zt:before:pointer-events-none zt:before:absolute zt:before:inset-y-1 zt:before:start-0 zt:before:w-px zt:before:bg-(--interactive-accent)";

const FIELD_ENTER =
  "zt:motion-safe:transition-[background-color] zt:motion-safe:duration-150 zt:starting:bg-transparent";

const EDITABLE =
  "zt:cursor-text zt:hover:bg-(--background-modifier-hover) zt:motion-safe:transition-[background-color] zt:motion-safe:duration-150";

const POPUP_TEXT = "zt:px-1.5 zt:py-1 zt:text-sm";

const CARD_BOX =
  "zt:-mx-1.5 zt:-my-1 zt:rounded-(--input-radius) zt:px-1.5 zt:py-1";

const POPUP_WIDTH = "zt:w-0 zt:min-w-[max(100%,12em)]";

const SURFACE: Record<
  EditorSurface,
  {
    sheet: string;
    inset: string;
    field: string;
    view: string;
    viewFrame: string;
    panel: string;
  }
> = {
  card: {
    sheet: "",
    inset: "",
    field: `${CARD_BOX} zt:text-xs ${FIELD_ENTER}`,
    view: `${CARD_BOX} zt:text-xs`,
    viewFrame: "",
    panel: "zt:-mx-3 zt:px-3 zt:py-1.5",
  },
  excerpt: {
    sheet: "",
    inset: "",
    field: `${CARD_BOX} zt:text-xs ${FIELD_ENTER}`,
    view: `${CARD_BOX} zt:text-xs`,
    viewFrame: "",
    panel: "zt:-ms-2 zt:-me-3 zt:ps-2 zt:pe-3 zt:py-1.5",
  },
  popup: {
    sheet: themeHook.pdfCommentSheet,
    inset: "zt:px-1.5 zt:pb-1.5",
    field: `zt:rounded-(--radius-s) ${POPUP_TEXT} ${FIELD_ENTER}`,
    view: `zt:rounded-(--radius-s) ${POPUP_TEXT}`,
    viewFrame: POPUP_WIDTH,
    panel: `${POPUP_WIDTH} zt:rounded-(--radius-s) zt:px-2 zt:py-1.5`,
  },
};

export function commentViewClass(
  surface: EditorSurface,
  editable = false,
): string {
  return `markdown-rendered zt-annot-comment zt:overflow-x-auto zt:break-words zt:text-foreground zt:select-text ${SURFACE[surface].view}${editable ? ` ${EDITABLE}` : ""}`;
}

export function commentFrameClass(surface: EditorSurface): string {
  const look = SURFACE[surface];
  return `${look.viewFrame} ${look.inset}`.trim();
}

export interface EditorField extends FieldEditorWording {
  save: string;
}

export type EditorSheetStatus = Pick<
  ReturnType<typeof fieldEditorControls>,
  "hint" | "manual" | "readOnly" | "saveDisabled"
>;

export interface EditorSheetProps {
  app: App;
  surface: EditorSurface;
  field: EditorField;
  value: string;
  onChange?: (text: string) => void;
  onSubmit: () => void;
  onSave?: () => void;
  onCancel: () => void;
  commit?: SheetCommit;
  onLeave?: () => void;
  within?: HTMLElement;
  caretAt?: CaretPoint;
}

export interface CaretPoint {
  x: number;
  y: number;
}

export interface CommentEntry {
  disabled: boolean;
  blocked: boolean;
  onPress: (at?: CaretPoint) => void;
}

export interface SheetCommit {
  label: string;
  run: () => void;
}

export interface EditorSheet extends Disposable {
  readonly editor: FieldEditor;
  text(): string;
  update(status: EditorSheetStatus): void;
}

export function renderEditorSheet(
  sheet: HTMLElement,
  {
    app,
    surface,
    field,
    value,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    commit,
    onLeave,
    within = sheet,
    caretAt,
  }: EditorSheetProps,
  status: EditorSheetStatus,
): EditorSheet {
  const look = SURFACE[surface];
  sheet.empty();
  sheet.addClasses(`${look.sheet} ${look.inset}`.split(" ").filter(Boolean));
  const frame = sheet.createDiv({ cls: `${FIELD} ${look.field}` });
  const footer = sheet.createDiv({
    cls: "zt:flex zt:flex-wrap zt:items-center zt:gap-2",
  });
  const hint = footer.createSpan({
    cls: "zt:min-w-0 zt:grow zt:basis-[12em] zt:empty:basis-0 zt:text-xs zt:text-pretty zt:text-muted-foreground",
    attr: { role: "status" },
  });
  const save = footer.createEl("button", {
    text: field.save,
    attr: { type: "button" },
  });
  if (onSave) save.addEventListener("click", onSave);
  if (commit) {
    const button = footer.createEl("button", {
      cls: "mod-cta",
      text: commit.label,
      attr: { type: "button" },
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", commit.run);
  }
  let current = status;
  let disposed = false;
  const editor = createFieldEditor({
    app,
    surface,
    parent: frame,
    wording: field,
    text: value,
    readOnly: status.readOnly,
    onChange: (text) => onChange?.(text),
    onEscape: onCancel,
    onSubmit,
    onBlur: (next) => {
      if (disposed || within.contains(next)) return;
      if (!current.manual && !current.readOnly) onLeave?.();
    },
  });
  const update = (next: EditorSheetStatus): void => {
    current = next;
    editor.setReadOnly(next.readOnly);
    hint.textContent = next.hint ?? "";
    const saves = next.manual && onSave !== undefined;
    save.toggle(saves);
    save.disabled = next.saveDisabled;
    footer.toggleClass(
      "zt:mt-1.5",
      Boolean(next.hint) || saves || commit !== undefined,
    );
  };
  update(status);
  const { view } = editor;
  view.focus();
  const clicked = caretAt ? view.posAtCoords(caretAt) : null;
  view.dispatch({ selection: { anchor: clicked ?? view.state.doc.length } });
  return {
    editor,
    text: () => view.state.doc.toString(),
    update,
    [Symbol.dispose]: () => {
      disposed = true;
      editor[Symbol.dispose]();
    },
  };
}

export function clickEdits(
  event: Pick<MouseEvent, "target" | "currentTarget">,
): boolean {
  const target = event.target as Node | null;
  const field = event.currentTarget as Node | null;
  if (!target || !field) return false;
  const element = target.instanceOf(Element) ? target : target.parentElement;
  if (element?.closest("a")) return false;
  const selection = field.doc.getSelection();
  if (!selection || selection.isCollapsed) return true;
  return !(
    field.contains(selection.anchorNode) || field.contains(selection.focusNode)
  );
}

export interface HeldDraftActions {
  save: () => void;
  allowEditing: () => void;
  discard: () => void;
}

export interface ConflictActions {
  applyAgain: () => void;
  discardConflict: () => void;
}

export interface TextDraftActions extends HeldDraftActions, ConflictActions {}

function panel(
  parent: HTMLElement,
  {
    surface,
    hook,
    icon,
    title,
  }: { surface: EditorSurface; hook: string; icon: string; title: string },
): HTMLElement {
  parent.empty();
  const look = SURFACE[surface];
  parent.addClasses(look.inset.split(" ").filter(Boolean));
  const box = parent.createDiv({
    cls: `${hook} zt:flex zt:flex-col zt:gap-1 zt:bg-popover ${look.panel}`,
  });
  const head = box.createDiv({
    cls: "zt:flex zt:items-center zt:gap-1 zt:font-medium",
  });
  const glyph = head.createSpan({
    cls: "zt:flex zt:[--icon-size:14px]",
  });
  setIcon(glyph, icon);
  head.createSpan({ text: title });
  return box;
}

function buttons(
  box: HTMLElement,
  cls: string,
  list: readonly {
    label: string;
    primary: boolean;
    enabled: boolean;
    run: () => void;
  }[],
): void {
  const row = box.createDiv({ cls: `zt:flex zt:flex-wrap zt:gap-2 ${cls}` });
  for (const { label, primary, enabled, run } of list) {
    const button = row.createEl("button", {
      text: label,
      attr: { type: "button" },
      ...(primary && { cls: "mod-cta" }),
    });
    button.disabled = !enabled;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      run();
    });
  }
}

const HELD_DRAFT_VERB: Record<HeldDraftAction["kind"], keyof HeldDraftActions> =
  {
    save: "save",
    "allow-editing": "allowEditing",
    discard: "discard",
  };

const CONFLICT_VERB: Record<ConflictVerb, keyof ConflictActions> = {
  "apply-again": "applyAgain",
  "delete-anyway": "applyAgain",
  discard: "discardConflict",
};

export function renderHeldDraftPanel(
  parent: HTMLElement,
  held: HeldDraft,
  {
    surface,
    actions,
    entry,
  }: {
    surface: EditorSurface;
    actions: HeldDraftActions;
    entry?: CommentEntry;
  },
): void {
  const box = panel(parent, {
    surface,
    hook: themeHook.annotDraft,
    icon: "pencil-line",
    title: held.title,
  });
  const text = box.createDiv({
    cls: `zt:break-words zt:whitespace-pre-wrap zt:select-text${entry ? " zt:-mx-1 zt:rounded-(--radius-s) zt:px-1" : ""}${entry && !entry.disabled && !entry.blocked ? ` ${EDITABLE}` : ""}`,
    text: held.text,
  });
  if (entry) {
    text.addEventListener("click", (event) => {
      if (entry.disabled || !clickEdits(event)) return;
      claimClick({ nativeEvent: event });
      entry.onPress();
    });
  }
  heldReasonAndVerbs(box, held, actions);
}

export function renderHeldTagsPanel(
  parent: HTMLElement,
  held: HeldTags,
  {
    surface,
    actions,
  }: {
    surface: EditorSurface;
    actions: HeldDraftActions;
  },
): void {
  const box = panel(parent, {
    surface,
    hook: themeHook.annotDraft,
    icon: "tags",
    title: m.annot_view_tags_draft(),
  });
  const chips = box.createDiv({ cls: "zt:flex zt:flex-wrap zt:gap-1" });
  for (const name of held.names) {
    chips
      .createSpan({
        cls: tagChipVariants({
          state: "resting",
          density: "dense",
          truncate: true,
          class: "zt:cursor-[inherit]",
        }),
      })
      .createSpan({ cls: "zt:block zt:truncate", text: name });
  }
  heldReasonAndVerbs(box, held, actions);
}

function heldReasonAndVerbs(
  box: HTMLElement,
  held: Pick<HeldDraft, "reason" | "actions">,
  actions: HeldDraftActions,
): void {
  if (held.reason !== null) {
    box.createDiv({
      cls: "zt:leading-normal zt:text-pretty zt:text-muted-foreground",
      attr: { role: "status" },
      text: held.reason,
    });
  }
  buttons(
    box,
    "zt:mt-1",
    held.actions.map((action) => ({
      ...action,
      run: () => actions[HELD_DRAFT_VERB[action.kind]](),
    })),
  );
}

export function renderConflictPanel(
  parent: HTMLElement,
  conflict: ConflictPanel,
  {
    surface,
    live,
    actions,
  }: {
    surface: EditorSurface;
    live: boolean;
    actions: ConflictActions;
  },
): void {
  const box = panel(parent, {
    surface,
    hook: themeHook.annotConflict,
    icon: "alert-triangle",
    title: conflict.title,
  });
  if (conflict.prompt !== null) {
    box.createDiv({ cls: "zt:text-muted-foreground", text: conflict.prompt });
  }
  for (const { label, value } of conflict.values) {
    const line = box.createDiv({ cls: "zt:flex zt:gap-1" });
    line.createSpan({
      cls: "zt:shrink-0 zt:text-muted-foreground",
      text: label,
    });
    line.createSpan({ cls: "zt:min-w-0 zt:break-words", text: value });
  }
  buttons(
    box,
    "zt:mt-2",
    conflict.actions.map(({ kind, label }) => ({
      label,
      primary: false,
      enabled: kind === "discard" || live,
      run: () => actions[CONFLICT_VERB[kind]](),
    })),
  );
}
