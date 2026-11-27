import type { CardPlace } from "#core/annot-view/card-selection.ts";
import type { AnnotationLock } from "#core/annotation-repository/lock.ts";
import type {
  CardControl,
  CardControls,
  HeldDraft,
  VerbBlocks,
} from "#obsidian/annot-view/card-controls.ts";
import type {
  CaretPoint,
  CommentEntry,
  EditorSurface,
  EditorSheet,
  HeldDraftActions,
  TextDraftActions,
} from "#obsidian/annot-view/editor-sheet.ts";
import type { EndTagSession } from "#obsidian/annot-view/tag-editor.tsx";
import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type {
  AnnotationRecord,
  TextField,
  WriteConflict,
} from "#obsidian/annotation-repository/service.ts";
import { Keymap } from "obsidian";
import type { PaneType } from "obsidian";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, RefObject } from "react";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";
import { useObsidianApp } from "@zotlit/obsidian-kit/app-context.ts";
import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import {
  activatable,
  claimClick,
  clickClaimed,
  cn,
  tooltipAttrs,
} from "@zotlit/obsidian-kit/utils.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { AnnotActionsContext } from "./actions.tsx";
import type { AnnotActions } from "./actions.tsx";
import { excerptImageTarget } from "./excerpt-image-state.ts";
import {
  ExcerptPicture,
  ExcerptText,
  excerptImageAlt,
  pageLocator,
} from "./excerpt-parts.tsx";

import { CardDisplayContext } from "#core/annot-view/card-display.ts";
import { tagChipVariants } from "#core/annot-view/tag-chip.ts";
import { typeIcon } from "#core/annot-view/type-icon.ts";
import { lockReasonText } from "#core/annotation-repository/lock-copy.ts";
import {
  annotationBlocks,
  cardControls,
  conflictBlock,
  fieldEditorControls,
  heldTagDraft,
  heldTextDraft,
  hasQuotedText,
  pressControl,
  shownText,
  shownTagNames,
  tagEditorControls,
  textFieldWording,
} from "#obsidian/annot-view/card-controls.ts";
import {
  CommentView,
  ConflictPanelSlot,
  controlEntry,
  EditorSheetSlot,
  HeldDraftSlot,
} from "#obsidian/annot-view/comment-parts.tsx";
import { CARD_SELECTOR } from "#obsidian/annot-view/history.ts";
import {
  useAnnotStore,
  useEditingTarget,
  useMutation,
  useToggleSelectedTag,
} from "#obsidian/annot-view/model.ts";
import {
  capabilityOf,
  fieldDraft,
  isEditing,
  selectedAlone,
} from "#obsidian/annot-view/state.ts";
import {
  autoTags,
  HeldTagsPanel,
  TagEditor,
} from "#obsidian/annot-view/tag-editor.tsx";
import { isTextField } from "#obsidian/annotation-repository/write.ts";
import { inTextEntry } from "#obsidian/pdf-annotation-editor/capability-affordance.ts";

const BLOCKED_VERB_DIM = "zt:data-blocked:opacity-50";

interface AnnotationProps {
  annot: AnnotationRecord;
  collapsed: boolean;
}

interface AnnotationCardProps extends AnnotationProps {
  place: CardPlace;
  tabStop: boolean;
}

interface CardOffer extends Omit<CardControls, "comment" | "text"> {
  comment: CardControl | null;
  text: CardControl | null;
}

function useCardControls(annot: AnnotationRecord, alone: boolean): CardOffer {
  const capability = useAnnotStore((s) => capabilityOf(s, annot.parentKey));
  const mutation = useMutation(annot.key);
  const hasTags = annot.tags.length > 0;
  const { type } = annot;
  return useMemo(() => {
    const controls = cardControls({
      blocks: blocksNow(annot, capability),
      mutation,
      hasTags,
      type,
    });
    return alone ? controls : { ...controls, comment: null, text: null };
  }, [annot, capability, mutation, hasTags, type, alone]);
}

export function blocksNow(
  annot: AnnotationRecord,
  capability: EditingCapability,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerbBlocks {
  return annotationBlocks({ annotation: annot, capability, now });
}

function useVerbBlocks(annot: AnnotationRecord): VerbBlocks {
  const capability = useAnnotStore((state) =>
    capabilityOf(state, annot.parentKey),
  );
  return blocksNow(annot, capability);
}

export function Annotation({
  annot,
  place,
  collapsed,
  tabStop,
}: AnnotationCardProps) {
  const actions = useContext(AnnotActionsContext);
  const selected = useAnnotStore((s) =>
    s.cardSelection.selected.includes(annot.key),
  );
  const alone = useAnnotStore((s) => selectedAlone(s, annot.key));
  const editing = useAnnotStore((s) => isEditing(s, annot.key, "comment"));
  const controls = useCardControls(annot, alone);
  const endSession = useRef<EndTagSession | null>(null);

  return (
    <div
      className="zt-annot-card zt:group zt:overflow-hidden zt:rounded-md zt:bg-background zt:px-3 zt:py-2 zt:text-xs zt:leading-(--line-height-tight) zt:shadow-[0_0_0_1px_var(--background-modifier-border)] zt:hover:shadow-[0_0_0_1px_var(--background-modifier-border-hover)] zt:focus-visible:ring-(length:--input-border-width-focus) zt:focus-visible:ring-border-focus zt:data-selected:bg-primary/10 zt:data-selected:ring-1 zt:data-selected:ring-primary zt:data-selected:focus-visible:ring-(length:--input-border-width-focus) zt:motion-safe:transition-[background-color,box-shadow] zt:motion-safe:duration-(--anim-duration-fast)"
      style={{ "--zt-annot-color": annot.color } as React.CSSProperties}
      data-annot-color={annot.color ?? undefined}
      data-zotero-annotation-key={annot.key}
      data-card-place={place}
      data-selected={selected ? "" : undefined}
      data-alone={alone ? "" : undefined}
      role="row"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      onMouseDown={(e) => {
        if (!e.shiftKey || inTextEntry(e.target)) return;
        const target = e.target as Node;
        if (
          target.instanceOf(Element) &&
          target.closest('button, a, [role="button"]')
        )
          return;
        e.preventDefault();
      }}
      onClick={(e) => {
        if (clickClaimed(e)) return;
        e.currentTarget.focus({ preventScroll: true });
        actions.onSelectAnnotation(
          annot,
          e.shiftKey
            ? "range"
            : Keymap.isModifier(e.nativeEvent, "Mod")
              ? "toggle"
              : "click",
          place,
        );
      }}
      onContextMenu={(e) => {
        if (inTextEntry(e.target)) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        actions.onCardMenu(e, annot);
      }}
    >
      <div role="gridcell" className="zt:flex zt:flex-col zt:gap-1.5">
        <div className="zt:flex zt:items-center zt:gap-1">
          <PageChip
            type={annot.type}
            page={annot.pageLabel}
            color={annot.color}
            backlink={actions.getBacklink(annot)}
            onOpen={(pane) => actions.onOpenPage(annot, pane)}
            onDragStart={(e) => {
              const card = e.currentTarget.closest(".zt-annot-card");
              if (card?.instanceOf(HTMLElement)) {
                const rect = card.getBoundingClientRect();
                e.dataTransfer.setDragImage(
                  card,
                  e.clientX - rect.left,
                  e.clientY - rect.top,
                );
              }
              actions.onDragStart(e, annot);
            }}
          />
          {annot.lock && <LockMark lock={annot.lock} />}
          <CardActionBar
            annot={annot}
            controls={controls}
            endSession={endSession}
          />
        </div>

        <ConflictSlot annot={annot} />

        <ExcerptBlock
          annot={annot}
          collapsed={collapsed}
          alone={alone}
          control={controls.text}
        />

        <CommentSlot
          annot={annot}
          editing={editing}
          control={controls.comment}
        />

        <TagSlot annot={annot} endSession={endSession} />
      </div>
    </div>
  );
}

function LockMark({ lock }: { lock: AnnotationLock }) {
  return (
    <span
      role="img"
      className={cn(
        themeHook.annotLock,
        "zt:flex zt:shrink-0 zt:items-center zt:text-muted-foreground",
      )}
      {...tooltipAttrs(
        m.annot_view_lock_label({ reason: lockReasonText(lock.reason) }),
      )}
    >
      <Icon name="lock" size="xs" />
    </span>
  );
}

function ConflictSlot({ annot }: { annot: AnnotationRecord }) {
  const actions = useContext(AnnotActionsContext);
  const mutation = useMutation(annot.key);
  const blocks = useVerbBlocks(annot);
  const drafted = useAnnotStore(
    (state) =>
      mutation.kind === "conflict" &&
      isTextField(mutation.conflict.write) &&
      fieldDraft(state, mutation.conflict.write, annot.key)?.state.kind ===
        "conflict",
  );
  if (mutation.kind !== "conflict" || drafted) return null;
  return (
    <ConflictPanelSlot
      conflict={mutation.conflict}
      block={conflictBlock(blocks, mutation.conflict.write)}
      surface="card"
      actions={{
        applyAgain: () => actions.onApplyAgain(annot),
        discardConflict: () => actions.onDiscardConflict(annot),
      }}
    />
  );
}

function fieldDraftActions(
  actions: AnnotActions,
  annot: AnnotationRecord,
  { field, text }: { field: TextField; text: string },
): TextDraftActions {
  return {
    save: () => actions.onSaveField(annot, field, { text }),
    allowEditing: () => actions.onAllowEditing(),
    discard: () => actions.onDiscardDraft(annot, field),
    applyAgain: () => actions.onApplyAgain(annot, field),
    discardConflict: () => actions.onDiscardConflict(annot, field),
  };
}

function cardHeldTagsActions(
  actions: AnnotActions,
  annot: AnnotationRecord,
): HeldDraftActions {
  return {
    save: () => actions.onSaveTags(annot),
    allowEditing: () => actions.onAllowEditing(),
    discard: () => actions.onDiscardTags(annot),
  };
}

function CardActionBar({
  annot,
  controls,
  endSession,
}: {
  annot: AnnotationRecord;
  controls: CardOffer;
  endSession: RefObject<EndTagSession | null>;
}) {
  const actions = useContext(AnnotActionsContext);
  const tags = useTagSession(annot);

  const press =
    (control: CardControl, act: (evt: MouseEvent<HTMLElement>) => void) =>
    (evt: MouseEvent<HTMLElement>): void => {
      if (control.blocked) {
        actions.onBlockedPress(control.blocked);
        return;
      }
      act(evt);
    };

  return (
    <div
      className="zt:ms-auto zt:-me-1 zt:flex zt:shrink-0 zt:items-center"
      onClick={claimClick}
    >
      <div className="zt:flex zt:items-center zt:opacity-70 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-data-alone:opacity-100 zt:motion-safe:transition-opacity">
        <IconButton
          icon="palette"
          className={BLOCKED_VERB_DIM}
          disabled={controls.color.disabled}
          data-blocked={controls.color.blocked ? "" : undefined}
          onClick={press(controls.color, (evt) =>
            actions.onColorMenu(evt, annot),
          )}
          {...tooltipAttrs(controls.color.tooltip)}
        />
        <IconButton
          icon="tag"
          className={BLOCKED_VERB_DIM}
          active={tags.open}
          disabled={controls.tags.disabled}
          data-blocked={controls.tags.blocked ? "" : undefined}
          onMouseDown={(evt) => {
            if (tags.open) evt.preventDefault();
          }}
          onClick={press(controls.tags, () => {
            if (tags.open) endSession.current?.();
            else tags.start();
          })}
          {...tooltipAttrs(controls.tags.tooltip)}
        />
      </div>
      <IconButton
        icon="more-horizontal"
        onClick={(evt) => actions.onMoreOptions(evt, annot)}
        {...tooltipAttrs(m.annot_view_more_tooltip())}
      />
    </div>
  );
}

function useTagSession(annot: AnnotationRecord) {
  const actions = useContext(AnnotActionsContext);
  const target = useEditingTarget(annot.key, "tags");
  const editing = useAnnotStore((s) => isEditing(s, annot.key, "tags"));
  const draft = useAnnotStore((s) => s.tagDrafts.get(annot.key) ?? null);
  const save = (): void => actions.onSaveTags(annot, { automatic: true });
  return {
    draft,
    open: editing,
    start: (): void => {
      if (actions.onOpenTags(annot)) target.open();
    },
    close: (): void => {
      target.close();
      save();
    },
    leave: save,
  };
}

function TagSlot({
  annot,
  endSession,
}: {
  annot: AnnotationRecord;
  endSession: RefObject<EndTagSession | null>;
}) {
  const actions = useContext(AnnotActionsContext);
  const display = useContext(CardDisplayContext);
  const session = useTagSession(annot);
  const auto = useMemo(() => autoTags(annot), [annot]);
  const block = useVerbBlocks(annot).tags;
  const { draft } = session;
  const now = Temporal.Now.instant();
  const editor = tagEditorControls(block, draft, now);
  const held = heldTagDraft(block, draft, now);
  if (session.open && !editor.readOnly) {
    return (
      <div onClick={(e) => claimClick(e)}>
        <TagEditor
          names={shownTagNames(annot, draft)}
          auto={auto}
          hint={editor.hint}
          libraryNames={() => actions.libraryTagNames(annot)}
          onChange={(names) => actions.onEditTags(annot, names)}
          onClose={session.close}
          onLeave={session.leave}
          saving={draft?.state.kind === "pending"}
          endSession={endSession}
        />
      </div>
    );
  }
  if (held) {
    return (
      <div onClick={(e) => claimClick(e)}>
        <HeldTagsPanel
          held={held}
          surface="card"
          actions={cardHeldTagsActions(actions, annot)}
        />
      </div>
    );
  }
  if (!display.tags) return null;
  return <TagRow names={shownTagNames(annot, draft)} />;
}

function TagRow({ names }: { names: readonly string[] }) {
  const selectedTags = useAnnotStore((s) => s.selectedTags);
  const toggleTag = useToggleSelectedTag();
  if (names.length === 0) return null;

  return (
    <div className="zt:flex zt:flex-wrap zt:gap-1">
      {names.map((tag) => {
        const selected = selectedTags.includes(tag);
        return (
          <span
            key={tag}
            aria-pressed={selected}
            className={tagChipVariants({
              state: selected ? "selected" : "resting",
              density: "dense",
              truncate: true,
            })}
            {...activatable(() => toggleTag(tag))}
            {...tooltipAttrs(m.annot_view_card_tag_tooltip({ name: tag }))}
          >
            <span className="zt:block zt:truncate">{tag}</span>
          </span>
        );
      })}
    </div>
  );
}

function CommentSlot({
  annot,
  editing: open,
  control,
}: {
  annot: AnnotationRecord;
  editing: boolean;
  control: CardControl | null;
}) {
  const actions = useContext(AnnotActionsContext);
  const display = useContext(CardDisplayContext);
  const editing = useFieldEditing(annot, "comment");
  const panel = useFieldDraftPanel(annot, "comment");
  const entry = control
    ? controlEntry(control, (at) => editing.press(control, at))
    : undefined;
  if (open) return <FieldEditor annot={annot} field="comment" />;
  if (panel)
    return (
      <FieldDraftPanel
        annot={annot}
        field="comment"
        panel={panel}
        entry={entry}
      />
    );
  if (!display.comment && !control) return null;
  if (!control && annot.comment === null) return null;
  return (
    <CommentView
      surface="card"
      render={actions.renderComment}
      html={annot.comment}
      entry={entry}
    />
  );
}

type FieldDraftPanelState =
  | { kind: "conflict"; conflict: WriteConflict; text: string }
  | { kind: "held"; held: HeldDraft };

function useFieldDraftPanel(
  annot: AnnotationRecord,
  field: TextField,
): FieldDraftPanelState | null {
  const draft = useAnnotStore((state) => fieldDraft(state, field, annot.key));
  const capability = useAnnotStore((state) =>
    capabilityOf(state, annot.parentKey),
  );
  return useMemo(() => {
    if (draft?.state.kind === "conflict") {
      return {
        kind: "conflict",
        conflict: {
          write: field,
          attempted: draft.text,
          fresh: draft.state.fresh,
        },
        text: draft.text,
      };
    }
    const now = Temporal.Now.instant();
    const blocks = blocksNow(annot, capability, now);
    const held = heldTextDraft(field, draft, { block: blocks[field], now });
    return held && { kind: "held", held };
  }, [annot, field, capability, draft]);
}

function FieldDraftPanel({
  annot,
  field,
  panel,
  entry,
}: {
  annot: AnnotationRecord;
  field: TextField;
  panel: FieldDraftPanelState;
  entry?: CommentEntry;
}) {
  const actions = useContext(AnnotActionsContext);
  const blocks = useVerbBlocks(annot);
  const surface = FIELD_SURFACE[field];
  if (panel.kind === "conflict") {
    return (
      <ConflictPanelSlot
        conflict={panel.conflict}
        block={conflictBlock(blocks, panel.conflict.write)}
        surface={surface}
        actions={fieldDraftActions(actions, annot, {
          field,
          text: panel.text,
        })}
      />
    );
  }
  return (
    <HeldDraftSlot
      held={panel.held}
      surface={surface}
      actions={fieldDraftActions(actions, annot, {
        field,
        text: panel.held.text,
      })}
      entry={entry}
    />
  );
}

const FIELD_SURFACE: Record<TextField, EditorSurface> = {
  comment: "card",
  text: "excerpt",
};

function useShownText(annot: AnnotationRecord, field: TextField): string {
  return useAnnotStore((state) =>
    shownText(annot[field], fieldDraft(state, field, annot.key)),
  );
}

function useFieldEditing(annot: AnnotationRecord, field: TextField) {
  const actions = useContext(AnnotActionsContext);
  const target = useEditingTarget(annot.key, field);
  const text = useShownText(annot, field);
  const saveAndClose = (typed: string): void => {
    target.close();
    actions.onSaveField(annot, field, { text: typed, automatic: true });
  };
  return {
    text,
    saveAndClose,
    press: (control: CardControl, caretAt?: CaretPoint): void =>
      pressControl(control, {
        act: () => {
          if (actions.onOpenField(annot, field)) target.open(caretAt);
        },
        onBlocked: (block) => actions.onBlockedPress(block),
      }),
  };
}

export const FIELD_SHEET_SELECTOR = "[data-zt-field-sheet]";

function FieldEditor({
  annot,
  field,
}: {
  annot: AnnotationRecord;
  field: TextField;
}) {
  const actions = useContext(AnnotActionsContext);
  const { text, saveAndClose } = useFieldEditing(annot, field);
  const block = useVerbBlocks(annot)[field];
  const draft = useAnnotStore((state) => fieldDraft(state, field, annot.key));
  const controls = fieldEditorControls(block, draft, Temporal.Now.instant());
  const app = useObsidianApp();
  const sheet = useRef<EditorSheet | null>(null);
  const caretAt = useAnnotStore((state) =>
    isEditing(state, annot.key, field) ? state.editing?.caretAt : undefined,
  );

  const editorText = (): string => sheet.current?.text() ?? text;
  const closing = useRef(false);
  const saveOnLeave = (): void => {
    if (closing.current) return;
    actions.onSaveField(annot, field, { text: editorText(), automatic: true });
  };
  const store = (): void => {
    if (sheet.current)
      actions.onSaveField(annot, field, { text: sheet.current.text() });
  };

  return (
    <EditorSheetSlot
      app={app}
      surface="card"
      field={textFieldWording(field)}
      value={text}
      text={text}
      status={controls}
      sheetRef={sheet}
      onChange={(value) => actions.onEditField(annot, field, value)}
      onSubmit={store}
      onSave={store}
      onCancel={() => {
        const card =
          sheet.current?.editor.view.dom.closest<HTMLElement>(CARD_SELECTOR);
        closing.current = true;
        saveAndClose(editorText());
        card?.focus({ preventScroll: true });
      }}
      onLeave={saveOnLeave}
      caretAt={caretAt}
      data-zt-field-sheet=""
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => e.stopPropagation()}
    />
  );
}

function ExcerptBlock({
  annot,
  collapsed,
  alone,
  control,
}: {
  annot: AnnotationRecord;
  collapsed: boolean;
  alone: boolean;
  control: CardControl | null;
}) {
  const name = annot.type;
  const editing = useAnnotStore((s) => isEditing(s, annot.key, "text"));
  const text = useFieldEditing(annot, "text");
  const panel = useFieldDraftPanel(annot, "text");
  const isImage = name === "image" || name === "ink";
  const offersEdit = control !== null && !isImage && !editing && !panel;

  if (!isImage && !hasQuotedText(name) && !annot.text) return null;

  let content: React.ReactNode;
  if (isImage) {
    content = <ExcerptImage annot={annot} collapsed={collapsed} />;
  } else if (editing) {
    content = <FieldEditor annot={annot} field="text" />;
  } else if (panel) {
    content = (
      <FieldDraftPanel
        annot={annot}
        field="text"
        panel={panel}
        entry={
          control ? controlEntry(control, () => text.press(control)) : undefined
        }
      />
    );
  } else if (annot.text) {
    content = <ExcerptText text={annot.text} />;
  } else if (hasQuotedText(name)) {
    content = (
      <p className="zt:text-muted-foreground zt:italic">
        {m.annot_view_card_no_text()}
      </p>
    );
  } else {
    content = m.annot_view_unsupported_type({ type: name });
  }

  return (
    <blockquote
      className={cn(
        "zt-annot-excerpt zt:group/quote zt:border-s-(length:--blockquote-border-thickness) zt:ps-2 zt:text-pretty",
        annot.color ? "zt:border-(--zt-annot-color)" : "zt:border-border",
        collapsed &&
          !alone &&
          !isImage &&
          !editing &&
          !panel &&
          "zt:line-clamp-3",
      )}
    >
      {offersEdit && (
        <EditTextButton control={control} press={() => text.press(control)} />
      )}
      {content}
    </blockquote>
  );
}

function EditTextButton({
  control,
  press,
}: {
  control: CardControl;
  press: () => void;
}) {
  return (
    <span className="zt:float-end zt:ms-1 zt:-me-1 zt:-mt-1 zt:-mb-2 zt:opacity-0 zt:group-hover/quote:opacity-100 zt:group-focus-visible:opacity-100 zt:group-has-[:focus-visible:not(.cm-content)]:opacity-100 zt:motion-safe:transition-opacity zt:pointer-coarse:opacity-100">
      <IconButton
        icon="pencil"
        className={BLOCKED_VERB_DIM}
        disabled={control.disabled}
        data-blocked={control.blocked ? "" : undefined}
        onClick={(e) => {
          claimClick(e);
          press();
        }}
        {...tooltipAttrs(control.tooltip)}
      />
    </span>
  );
}

function ExcerptImage({ annot, collapsed }: AnnotationProps) {
  const actions = useContext(AnnotActionsContext);
  const source = useAnnotStore(
    (s) => s.sources.get(annot.parentKey)?.source ?? null,
  );
  const sourceScope = useAnnotStore(
    (s) => s.sources.get(annot.parentKey)?.scope ?? null,
  );
  const input = { annotation: annot, source, sourceScope };
  const [target, setTarget] = useState(() => excerptImageTarget(null, input));
  const next = excerptImageTarget(target, input);
  if (next !== target) setTarget(next);
  const demand = useMemo(() => actions.openExcerptImage(), [actions]);
  useEffect(() => {
    let current = true;
    void actions.excerptImageRequest(target).then((request) => {
      if (current) demand.demand(request);
    });
    return () => {
      current = false;
    };
  }, [actions, demand, target]);
  useEffect(() => () => demand.release(), [demand]);
  return (
    <ExcerptPicture
      demand={demand}
      identity={target.identity}
      alt={excerptImageAlt(annot)}
      className={cn(
        "zt:ring-1 zt:ring-foreground/10 zt:ring-inset",
        collapsed && "zt:max-h-20",
      )}
    />
  );
}

function PageChip({
  type,
  page,
  color,
  backlink,
  onOpen,
  onDragStart,
}: {
  type: ResolvedAnnotationTypeName;
  page: string | null;
  color: string | null;
  backlink?: string;
  onOpen: (pane: PaneType | boolean) => void;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
}) {
  const display = useContext(CardDisplayContext);
  const chip = cn(
    "zt-annot-page-chip zt:flex zt:h-5 zt:min-w-0 zt:items-center zt:gap-1 zt:rounded-sm zt:px-1 zt:font-mono zt:text-xs zt:font-medium zt:tracking-tight zt:tabular-nums",
    "zt:[--link-decoration-hover:none] zt:[--link-decoration:none] zt:[--link-weight:var(--font-medium)]",
    color
      ? "zt:bg-(--zt-annot-color)/22 zt:text-foreground zt:[--link-color-hover:var(--text-normal)] zt:[--link-color:var(--text-normal)] zt:hover:ring-1 zt:hover:ring-(--zt-annot-color) zt:motion-safe:transition-shadow"
      : "zt:text-muted-foreground zt:[--link-color-hover:var(--text-muted)] zt:[--link-color:var(--text-muted)]",
  );
  const marks = (
    <>
      <Icon
        name={typeIcon(type)}
        size="xs"
        className={cn("zt:shrink-0", color && "zt:text-(--zt-annot-color)")}
      />
      {page && display.page && (
        <span className="zt:truncate">{pageLocator(page)}</span>
      )}
    </>
  );
  if (backlink) {
    return (
      <a
        className={chip}
        href={backlink}
        draggable
        onDragStart={onDragStart}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpen(Keymap.isModEvent(e.nativeEvent));
        }}
        {...tooltipAttrs(m.annot_view_open_page())}
      >
        {marks}
      </a>
    );
  }
  return (
    <span className={chip} draggable onDragStart={onDragStart}>
      {marks}
    </span>
  );
}
