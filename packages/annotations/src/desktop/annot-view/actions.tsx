import type { CardClick, CardPlace } from "#core/annot-view/card-selection.ts";
import type { TargetOpener } from "#desktop/attachment-open/open-target.ts";
import type {
  ExcerptDisplayDemand,
  ExcerptImageDisplay,
} from "#desktop/excerpt-image/display.ts";
import type {
  CardBlock,
  CardControl,
  CardControls,
} from "#obsidian/annot-view/card-controls.ts";
import type { CommentRenderer } from "#obsidian/annot-view/comment-render.ts";
import type { AnnotState, FollowMode } from "#obsidian/annot-view/state.ts";
import type {
  AnnotationRecord,
  TextField,
} from "#obsidian/annotation-repository/service.ts";
import type { ExcerptRequest } from "#obsidian/excerpt-image/service.ts";
import { Effect } from "effect";
import type { App, PaneType } from "obsidian";
import { Menu } from "obsidian";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { createContext } from "react";

import { requireElectron } from "@zotlit/obsidian-desktop/require.ts";
import { confirm } from "@zotlit/obsidian-kit/confirm.ts";
import {
  menuEvent,
  menuSections,
  raiseMenu,
} from "@zotlit/obsidian-kit/menu-events.ts";
import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import type { MenuAlign } from "@zotlit/obsidian-kit/menu.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import * as toast from "@zotlit/obsidian-kit/toast.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRun } from "@zotlit/obsidian-kit/view-runner.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { observeExit } from "@zotlit/plugin-kernel/fiber-exit.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { addCopyIndexedKeyMenuItem } from "@zotlit/plugin-services/obsidian/indexed-key/menu.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";
import { annotationOpenUri } from "@zotlit/zotero-types/uri";

import type { AnnotationWriteRequest, CitationRead } from "./atoms.ts";
import {
  annotationDraftCommand,
  openExcerptDemandCommand,
  annotationWriteCommand,
  readCitation,
  resultValue,
  requireResult,
} from "./atoms.ts";
import type { ExcerptImageTarget } from "./excerpt-image-state.ts";
import { buildHeaderMenu } from "./menus.ts";

import { viewTargetOpener } from "#desktop/attachment-open/view-opener.ts";
import { chooseAttachment } from "#obsidian/annot-view/attachment-suggester.ts";
import {
  groupControl,
  pressControl,
} from "#obsidian/annot-view/card-controls.ts";
import {
  blockedNotice,
  copyText,
  deleteConfirmation,
} from "#obsidian/annot-view/card-verbs.ts";
import { copiedText } from "#obsidian/annot-view/copied-text.ts";
import {
  attachmentLine,
  headerMenu,
} from "#obsidian/annot-view/presentation.ts";
import { groupFailureMessages } from "#obsidian/annotation-repository/write.ts";
import {
  annotationColorMenu,
  buildColorMenu,
} from "#obsidian/pdf-annotation-editor/color-menu.ts";

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    "zotlit:annotation-menu": {
      source: "annotation-view";
      annotations: readonly AnnotationRecord[];
    };
  }
}

const annotationMenu = menuEvent("zotlit:annotation-menu", [
  "action",
  "clipboard",
  "insert",
  "view",
  "",
  "danger",
]);

const SECTION = menuSections(annotationMenu);

export interface AnnotActions {
  onMoreOptions(
    evt: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    annot: AnnotationRecord,
  ): void;
  onCardMenu(evt: MouseEvent<HTMLElement>, annot: AnnotationRecord): void;
  onHeaderMenu(evt: MouseEvent<HTMLElement>): void;
  onViewMenu(evt: MouseEvent<HTMLElement>): void;
  onChooseAttachment(): void;
  onOpenPdf(): void;
  onAllowEditing(): void;
  onBlockedPress(block: CardBlock): void;
  onColorMenu(
    evt: MouseEvent<HTMLElement>,
    annot: AnnotationRecord,
  ): CardBlock | null;
  onDragStart(evt: DragEvent<HTMLElement>, annot: AnnotationRecord): void;
  onRefresh(): void;
  onSetFollowMode(mode: Exclude<FollowMode, "pinned">): void;
  onPinCurrentItem(): void;
  onPinItem(): void;
  onUnpin(): void;
  onEnableLiveUpdates(): void;
  onSelectAnnotation(
    annot: AnnotationRecord,
    gesture: CardClick,
    place: CardPlace,
  ): void;
  onClearSelection(): void;
  onCloseEditors(): void;
  onOpenField(annot: AnnotationRecord, field: TextField): boolean;
  onEditField(annot: AnnotationRecord, field: TextField, text: string): void;
  onSaveField(
    annot: AnnotationRecord,
    field: TextField,
    save: { text: string; automatic?: boolean },
  ): void;
  onDiscardDraft(annot: AnnotationRecord, field: TextField): void;
  onOpenTags(annot: AnnotationRecord): boolean;
  onEditTags(annot: AnnotationRecord, names: readonly string[]): void;
  onSaveTags(annot: AnnotationRecord, options?: { automatic?: boolean }): void;
  onDiscardTags(annot: AnnotationRecord): void;
  libraryTagNames(annot: AnnotationRecord): Promise<readonly string[]>;
  onDeleteSelection(): CardBlock | null;
  onRecolorSelection(color: string): CardBlock | null;
  onCopySelection(): boolean;
  onApplyAgain(annot: AnnotationRecord, field?: TextField): void;
  onDiscardConflict(annot: AnnotationRecord, field?: TextField): void;
  openExcerptImage(): ExcerptDisplayDemand;
  excerptImageRequest(
    target: ExcerptImageTarget,
  ): Promise<ExcerptRequest | null>;
  getBacklink(annot: AnnotationRecord): string | undefined;
  onOpenPage(annot: AnnotationRecord, pane: PaneType | boolean): void;
  renderComment: CommentRenderer;
}

export interface AnnotActionDeps {
  app: App;
  opener: Pick<TargetOpener["Service"], "open">;
  excerptImageRequest: AnnotActions["excerptImageRequest"];
  registry: ViewRegistryHandle;
  run: ViewRun;
  now?: () => Temporal.Instant;
  controls: (annot: AnnotationRecord) => CardControls;
  selectedCards: () => readonly AnnotationRecord[];
  libraryTagNames: AnnotActions["libraryTagNames"];
  getState: () => AnnotState;
  setSelectedAttachmentKey: (key: string) => void;
  toggleSelectedTag: (tag: string) => void;
  refresh: () => Promise<void>;
  onDragStart: AnnotActions["onDragStart"];
  offerAnnotationInsert: () => ((annot: AnnotationRecord) => void) | null;
  renderComment: CommentRenderer;
  fillViewMenu: (menu: Menu) => void;
  onSetFollowMode: AnnotActions["onSetFollowMode"];
  onAllowEditing: AnnotActions["onAllowEditing"];
  onOpenPdf: AnnotActions["onOpenPdf"];
  onPinCurrentItem: AnnotActions["onPinCurrentItem"];
  onPinItem: AnnotActions["onPinItem"];
  onUnpin: AnnotActions["onUnpin"];
  onEnableLiveUpdates: AnnotActions["onEnableLiveUpdates"];
  onSelectAnnotation: AnnotActions["onSelectAnnotation"];
  onClearSelection: AnnotActions["onClearSelection"];
  selectAlone: (annot: AnnotationRecord) => void;
  closeEditors: () => void;
  openEditor: (annot: AnnotationRecord, field: TextField) => void;
  onExploreAnnotation: (annotationKey: string) => void;
}

function copyCitation(read: CitationRead): void {
  if (read.kind === "inert-template") {
    new BaseNotice(read.message);
    return;
  }
  if (read.kind === "failed") {
    new BaseNotice(m.annot_view_copy_failed());
    return;
  }
  const { citation } = read;
  if (citation.kind === "not-in-database") {
    new BaseNotice(m.annot_view_annotation_not_in_database());
    return;
  }
  if (citation.kind === "no-citation-key") {
    new BaseNotice(m.annot_view_copy_citation_no_key());
    return;
  }
  void toast.promise(writeClipboard(citation.text), {
    success: m.annot_view_copied_citation(),
    error: m.annot_view_copy_failed(),
  });
}

export function createAnnotActions(deps: AnnotActionDeps): AnnotActions {
  const now = deps.now ?? (() => Temporal.Now.instant());

  const sendWrite = (request: AnnotationWriteRequest): void => {
    deps.registry.set(annotationWriteCommand, {
      ...request,
      complete: (states) => {
        for (const message of groupFailureMessages(states, now()))
          new BaseNotice(message);
      },
    });
  };

  const setColors = (
    annots: readonly AnnotationRecord[],
    color: string,
  ): void =>
    sendWrite({ kind: "color", keys: annots.map(({ key }) => key), color });
  const controlOf = (
    verb: "color" | "delete",
    annots: readonly AnnotationRecord[],
  ): Pick<CardControl, "disabled" | "blocked"> =>
    groupControl(annots.map((annot) => deps.controls(annot)[verb]));
  const press = (
    verb: "color" | "delete",
    annots: readonly AnnotationRecord[],
    act: () => void,
  ): CardBlock | null => {
    const control = controlOf(verb, annots);
    if (control.disabled) return null;
    if (control.blocked) {
      onBlockedPress(control.blocked);
      return control.blocked;
    }
    act();
    return null;
  };
  const fillColorMenu = (
    menu: Menu,
    annots: readonly AnnotationRecord[],
  ): void => {
    buildColorMenu(menu, {
      colors: annots.map(({ color }) => color),
      onSelect: (hex) => setColors(annots, hex),
    });
    raiseMenu(menu, {
      workspace: deps.app.workspace,
      event: annotationColorMenu,
      info: {
        source: "annotation-view",
        annotations: annots,
      },
    });
  };
  const addCopyItem = (
    menu: Menu,
    annots: readonly AnnotationRecord[],
  ): void => {
    menu.addItem((item) => {
      item
        .setSection(SECTION.clipboard)
        .setTitle(m.annot_view_menu_copy_text())
        .setIcon("copy")
        .setDisabled(copiedText(annots) === "")
        .onClick(() => copyText(annots));
    });
  };
  const onOpenField = (annot: AnnotationRecord, field: TextField): boolean => {
    deps.selectAlone(annot);
    deps.closeEditors();
    deps.registry.set(annotationDraftCommand, {
      kind: "edit-field",
      key: annot.key,
      field,
    });
    return resultValue(deps.registry.get(annotationDraftCommand)) === true;
  };
  const onEditField = (
    annot: AnnotationRecord,
    field: TextField,
    text: string,
  ): void => {
    deps.registry.set(annotationDraftCommand, {
      kind: "edit-field",
      key: annot.key,
      field,
      text,
    });
  };
  const onSaveField: AnnotActions["onSaveField"] = (
    annot,
    field,
    { text, automatic = false },
  ) =>
    sendWrite({ kind: "submit-field", key: annot.key, field, text, automatic });
  const onDiscardDraft = (annot: AnnotationRecord, field: TextField): void =>
    deps.registry.set(annotationDraftCommand, {
      kind: "discard-field",
      key: annot.key,
      field,
    });
  const onOpenTags = (annot: AnnotationRecord): boolean => {
    deps.selectAlone(annot);
    deps.closeEditors();
    deps.registry.set(annotationDraftCommand, {
      kind: "edit-tags",
      key: annot.key,
    });
    return resultValue(deps.registry.get(annotationDraftCommand)) === true;
  };
  const onEditTags = (
    annot: AnnotationRecord,
    names: readonly string[],
  ): void =>
    deps.registry.set(annotationDraftCommand, {
      kind: "edit-tags",
      key: annot.key,
      names,
    });
  const onSaveTags: AnnotActions["onSaveTags"] = (
    annot,
    { automatic = false } = {},
  ) => sendWrite({ kind: "submit-tags", key: annot.key, automatic });
  const onDiscardTags = (annot: AnnotationRecord): void =>
    deps.registry.set(annotationDraftCommand, {
      kind: "discard-tags",
      key: annot.key,
    });
  const deleteCards = async (
    annots: readonly AnnotationRecord[],
  ): Promise<void> => {
    if (await confirm(deleteConfirmation(annots.length), deps.app))
      sendWrite({ kind: "delete", keys: annots.map(({ key }) => key) });
  };
  const onApplyAgain = (annot: AnnotationRecord, field?: TextField): void =>
    sendWrite({ kind: "retry", key: annot.key, ...(field && { field }) });
  const onDiscardConflict = (
    annot: AnnotationRecord,
    field?: TextField,
  ): void =>
    deps.registry.set(
      annotationDraftCommand,
      field
        ? { kind: "discard-field", key: annot.key, field }
        : { kind: "discard-conflict", key: annot.key },
    );
  const getBacklink = (annot: AnnotationRecord): string | undefined => {
    const annotation = parseIndexedKey(annot.key);
    const attachment = parseIndexedKey(annot.parentKey);
    if (!annotation || !attachment) return undefined;
    return annotationOpenUri({
      attachmentKey: attachment.key,
      annotationKey: annotation.key,
      pageLabel: annot.pageLabel,
      groupID: annotation.groupID,
    });
  };

  const onBlockedPress = (block: CardBlock): void =>
    blockedNotice(block, deps.onAllowEditing);

  const showMenu = (
    evt: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    fill: (menu: Menu) => void,
    align?: MenuAlign,
  ): void => {
    const menu = new Menu();
    fill(menu);
    showMenuAtButton(menu, evt.currentTarget, align);
  };

  const onChooseAttachment = (): void => {
    const line = attachmentLine(deps.getState());
    if (line.kind !== "picker") return;
    chooseAttachment(deps.app, line.options, deps.setSelectedAttachmentKey);
  };

  const fillCardMenu = (menu: Menu, annot: AnnotationRecord): void => {
    addEditTextItem(menu, annot);
    const backlink = getBacklink(annot);
    if (backlink) {
      menu.addItem((item) => {
        item
          .setSection(SECTION.clipboard)
          .setTitle(m.annot_view_menu_copy_backlink())
          .setIcon("link")
          .onClick(() => {
            void toast.promise(navigator.clipboard.writeText(backlink), {
              success: m.annot_view_copied_backlink(),
              error: m.annot_view_copy_failed(),
            });
          });
      });
    }

    if (copiedText([annot]) !== "") addCopyItem(menu, [annot]);

    addCopyIndexedKeyMenuItem(
      menu,
      { indexedKey: annot.key, kind: "annotation" },
      { section: SECTION.clipboard },
    );

    menu.addItem((item) => {
      item
        .setSection(SECTION.clipboard)
        .setTitle(m.annot_view_menu_copy_citation())
        .setIcon("quote")
        .onClick(() =>
          observeExit(deps.run(readCitation(annot.key)), {
            onSuccess: copyCitation,
          }),
        );
    });

    menu.addItem((item) => {
      const insert = deps.offerAnnotationInsert();
      item
        .setSection(SECTION.insert)
        .setTitle(m.annot_view_menu_insert())
        .setIcon("file-input")
        .setDisabled(!insert)
        .onClick(() => insert?.(annot));
    });

    menu.addItem((item) => {
      item
        .setSection(SECTION.view)
        .setTitle(m.template_data_explorer_menu_explore())
        .setIcon("braces")
        .onClick(() => {
          const parsed = parseIndexedKey(annot.key);
          if (parsed) deps.onExploreAnnotation(parsed.key);
        });
    });

    addDeleteItem(menu, [annot]);
  };

  const fillGroupMenu = (
    menu: Menu,
    annots: readonly AnnotationRecord[],
  ): void => {
    const color = controlOf("color", annots);
    menu.addItem((item) => {
      item
        .setSection(SECTION.action)
        .setTitle(m.annot_view_card_color())
        .setIcon("palette")
        .setDisabled(color.disabled || color.blocked !== null);
      fillColorMenu(item.setSubmenu(), annots);
    });
    addCopyItem(menu, annots);
    addDeleteItem(menu, annots);
  };

  const addEditTextItem = (menu: Menu, annot: AnnotationRecord): void => {
    const control = deps.controls(annot).text;
    if (!control) return;
    menu.addItem((item) => {
      item
        .setSection(SECTION.action)
        .setTitle(m.annot_view_menu_edit_text())
        .setIcon("text-cursor-input")
        .setDisabled(control.disabled)
        .onClick(() =>
          pressControl(control, {
            act: () => {
              if (onOpenField(annot, "text")) deps.openEditor(annot, "text");
            },
            onBlocked: onBlockedPress,
          }),
        );
    });
  };

  const addDeleteItem = (
    menu: Menu,
    annots: readonly AnnotationRecord[],
  ): void => {
    const control = controlOf("delete", annots);
    menu.addItem((item) => {
      item
        .setSection(SECTION.danger)
        .setTitle(
          annots.length === 1
            ? m.annot_view_menu_delete()
            : m.annot_view_menu_delete_group({ count: annots.length }),
        )
        .setIcon("trash-2")
        .setWarning(true)
        .setDisabled(control.disabled)
        .onClick(() => press("delete", annots, () => void deleteCards(annots)));
    });
  };

  const cardsFor = (annot: AnnotationRecord): readonly AnnotationRecord[] => {
    const selected = deps.selectedCards();
    if (selected.length > 1 && selected.some(({ key }) => key === annot.key))
      return selected;
    deps.selectAlone(annot);
    return [annot];
  };

  const fillMenuFor = (menu: Menu, annot: AnnotationRecord): void => {
    const annots = cardsFor(annot);
    if (annots.length > 1) fillGroupMenu(menu, annots);
    else fillCardMenu(menu, annot);
    raiseMenu(menu, {
      workspace: deps.app.workspace,
      event: annotationMenu,
      info: {
        source: "annotation-view",
        annotations: annots,
      },
    });
  };

  return {
    getBacklink,
    onOpenPage(annot, pane) {
      viewTargetOpener(deps.registry, deps.opener).open(
        {
          kind: "annotation",
          attachmentKey: annot.parentKey,
          annotationKey: annot.key,
          pageIndex:
            "pageIndex" in annot.position ? annot.position.pageIndex : null,
          pageLabel: annot.pageLabel,
        },
        pane,
      );
    },
    openExcerptImage: () => {
      deps.registry.set(openExcerptDemandCommand, undefined);
      return requireResult(deps.registry.get(openExcerptDemandCommand));
    },
    excerptImageRequest: deps.excerptImageRequest,
    onOpenTags,
    onEditTags,
    onSaveTags,
    onDiscardTags,
    libraryTagNames: deps.libraryTagNames,
    onOpenField,
    onCloseEditors: () => deps.closeEditors(),
    onEditField,
    onSaveField,
    onDiscardDraft,
    onApplyAgain,
    onDiscardConflict,
    onDeleteSelection() {
      const annots = deps.selectedCards();
      if (annots.length === 0) return null;
      return press("delete", annots, () => void deleteCards(annots));
    },
    onRecolorSelection(color) {
      const annots = deps.selectedCards();
      if (annots.length === 0) return null;
      return press("color", annots, () => setColors(annots, color));
    },
    onCopySelection: () => copyText(deps.selectedCards()),
    onMoreOptions(evt, annot) {
      showMenu(evt, (menu) => fillMenuFor(menu, annot), "end");
    },
    onCardMenu(evt, annot) {
      const menu = new Menu();
      fillMenuFor(menu, annot);
      menu.showAtMouseEvent(evt.nativeEvent);
    },
    onHeaderMenu(evt) {
      showMenu(evt, (menu) =>
        buildHeaderMenu(menu, {
          groups: headerMenu(deps.getState(), now()),
          actions: {
            onSetFollowMode: deps.onSetFollowMode,
            onPinCurrentItem: deps.onPinCurrentItem,
            onPinItem: deps.onPinItem,
            onUnpin: deps.onUnpin,
            onChooseAttachment,
            onOpenPdf: deps.onOpenPdf,
            onAllowEditing: deps.onAllowEditing,
          },
        }),
      );
    },
    onViewMenu(evt) {
      showMenu(evt, deps.fillViewMenu, "end");
    },
    onChooseAttachment,
    onOpenPdf: deps.onOpenPdf,
    onAllowEditing: deps.onAllowEditing,
    onBlockedPress,
    onColorMenu(evt, annot) {
      const annots = cardsFor(annot);
      return press("color", annots, () =>
        showMenu(evt, (menu) => fillColorMenu(menu, annots)),
      );
    },
    onDragStart: deps.onDragStart,
    renderComment: deps.renderComment,
    onSetFollowMode: deps.onSetFollowMode,
    onPinCurrentItem: deps.onPinCurrentItem,
    onPinItem: deps.onPinItem,
    onUnpin: deps.onUnpin,
    onEnableLiveUpdates: deps.onEnableLiveUpdates,
    onSelectAnnotation: deps.onSelectAnnotation,
    onClearSelection: deps.onClearSelection,
    onRefresh() {
      void toast.promise(deps.refresh(), {
        loading: m.annot_view_refreshing(),
        success: m.annot_view_refreshed(),
        error: m.annot_view_refresh_failed(),
      });
    },
  };
}

const NOOP_DISPLAY: ExcerptImageDisplay = {
  image: null,
  current: false,
  status: "absent",
};

const NOOP_DEMAND: ExcerptDisplayDemand = {
  demand: () => {},
  release: () => {},
  subscribe: () => () => {},
  snapshot: () => NOOP_DISPLAY,
};

export const NOOP_ACTIONS: AnnotActions = {
  onMoreOptions: () => {},
  onCardMenu: () => {},
  onHeaderMenu: () => {},
  onViewMenu: () => {},
  onChooseAttachment: () => {},
  onOpenPdf: () => {},
  onAllowEditing: () => {},
  onBlockedPress: () => {},
  onColorMenu: () => null,
  onDragStart: () => {},
  onSetFollowMode: () => {},
  onPinCurrentItem: () => {},
  onPinItem: () => {},
  onUnpin: () => {},
  onEnableLiveUpdates: () => {},
  onSelectAnnotation: () => {},
  onClearSelection: () => {},
  onDiscardDraft: () => {},
  onOpenField: () => false,
  onCloseEditors: () => {},
  onEditField: () => {},
  onSaveField: () => {},
  onOpenTags: () => false,
  onEditTags: () => {},
  onSaveTags: () => {},
  onDiscardTags: () => {},
  libraryTagNames: async () => [],
  onDeleteSelection: () => null,
  onRecolorSelection: () => null,
  onCopySelection: () => false,
  onApplyAgain: () => {},
  onDiscardConflict: () => {},
  onRefresh: () => {},
  openExcerptImage: () => NOOP_DEMAND,
  excerptImageRequest: async () => null,
  getBacklink: () => undefined,
  onOpenPage: () => {},
  renderComment: () => () => {},
};

export const AnnotActionsContext = createContext<AnnotActions>(NOOP_ACTIONS);

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    Effect.runSyncWith(logServices)(
      Effect.logDebug(
        "The clipboard refused the write; Electron writes it",
      ).pipe(
        Effect.annotateLogs({
          error,
        }),
        withLogCategory("views", "annot-view"),
      ),
    );
    requireElectron().clipboard.writeText(text);
  }
}
