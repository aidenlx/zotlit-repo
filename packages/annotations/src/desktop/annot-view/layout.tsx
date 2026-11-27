import type {
  CardClick,
  CardPlace,
  CardSelection,
  SelectionChange,
} from "#core/annot-view/card-selection.ts";
import type { ReaderSession } from "#core/reader-session/session.ts";
import type { TargetOpener } from "#desktop/attachment-open/open-target.ts";
import type { CardControls } from "#obsidian/annot-view/card-controls.ts";
import type { InsertDeps } from "#obsidian/annot-view/drag-insert.ts";
import type { AnnotStore } from "#obsidian/annot-view/model.ts";
import type {
  AnnotState,
  CardGroup,
  CardPlacement,
  HeldSource,
} from "#obsidian/annot-view/state.ts";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationSource,
  HistoryDirection,
} from "#obsidian/annotation-repository/service.ts";
import type { ExcerptRequest } from "#obsidian/excerpt-image/service.ts";
import { Effect } from "effect";
import type { App, Scope } from "obsidian";
import { Component, Platform } from "obsidian";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

import { AppContext } from "@zotlit/obsidian-kit/app-context.ts";
import { registerKeymap } from "@zotlit/obsidian-kit/disposables.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import { makeViewRunner } from "@zotlit/obsidian-kit/view-runner.ts";
import type { ViewRunner } from "@zotlit/obsidian-kit/view-runner.ts";
import { ANNOTATION_COLORS } from "@zotlit/plugin-kernel/annotation-colors.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { zoteroDataDirAtom } from "@zotlit/plugin-services/obsidian/zotero-pref/atoms.ts";

import type { AnnotActionDeps, AnnotActions } from "./actions.tsx";
import { AnnotActionsContext, createAnnotActions } from "./actions.tsx";
import { blocksNow } from "./Annotation.tsx";
import { AnnotList } from "./AnnotView.tsx";
import {
  annotationStateAtom,
  heldListAtom,
  makeAttachmentRead,
  makeHoldAttachmentsCommand,
  makeRefreshCommand,
  annotationHistoryCommand,
  annotationWriteCommand,
  annotationDraftCommand,
  editingCapabilityCommand,
  makeLibraryTagNamesCommand,
  makeExcerptRequestCommand,
  openExcerptDemandCommand,
  refreshExcerptDisplayCommand,
  annotationInsert,
  resultValue,
  requireResult,
} from "./atoms.ts";

import {
  NO_SELECTION,
  nextCardSelection,
  placedKey,
  sameKeys,
} from "#core/annot-view/card-selection.ts";
import { cardControls } from "#obsidian/annot-view/card-controls.ts";
import { createCommentRenderer } from "#obsidian/annot-view/comment-render.ts";
import {
  createDragInsertHandler,
  createInsertHandler,
} from "#obsidian/annot-view/drag-insert.ts";
import {
  CARD_SELECTOR,
  mountCardHistoryKeys,
} from "#obsidian/annot-view/history.ts";
import {
  AnnotStoreProvider,
  createAnnotStore,
  observeRead,
} from "#obsidian/annot-view/model.ts";
import {
  capabilityOf,
  editorOpen,
  noFieldDrafts,
  selectedAlone,
  toggledTags,
  visibleOrder,
} from "#obsidian/annot-view/state.ts";
import { historyOutcomeNotice } from "#obsidian/annotation-repository/actions.ts";
import {
  annotationChangeAtom,
  annotationListsChangeAtom,
  annotationCapabilityAtom,
  attachmentCapabilityAtom,
} from "#obsidian/annotation-repository/atoms.ts";
import {
  byTextField,
  IDLE,
  writeFailureMessage,
} from "#obsidian/annotation-repository/write.ts";
import { inTextEntry } from "#obsidian/pdf-annotation-editor/capability-affordance.ts";

const COMPOSITE_WIDGET = '[role="listbox"], [role="combobox"]';

function controlOwnsKey(target: EventTarget | null): boolean {
  if (inTextEntry(target)) return true;
  const node = target as Node | null;
  return (
    node?.instanceOf(HTMLElement) === true &&
    node.closest(COMPOSITE_WIDGET) !== null
  );
}

export interface AnnotationsLayoutDeps {
  app: App;
  opener: Pick<TargetOpener["Service"], "open">;
  registry: ViewRegistryHandle;
}

export type HostGestures = Pick<
  AnnotActionDeps,
  | "setSelectedAttachmentKey"
  | "onSetFollowMode"
  | "onPinCurrentItem"
  | "onPinItem"
  | "onUnpin"
  | "onEnableLiveUpdates"
  | "onOpenPdf"
  | "onExploreAnnotation"
  | "fillViewMenu"
>;

const NO_HOST_GESTURES: HostGestures = {
  setSelectedAttachmentKey: () => {},
  onSetFollowMode: () => {},
  onPinCurrentItem: () => {},
  onPinItem: () => {},
  onUnpin: () => {},
  onEnableLiveUpdates: () => {},
  onOpenPdf: () => {},
  onExploreAnnotation: () => {},
  fillViewMenu: () => {},
};

export interface AnnotationsLayoutHost {
  scope: Scope;
  sourcePath: () => string;
  gestures?: Partial<HostGestures>;
  onList?: (node: HTMLElement) => boolean;
  onEscape?: (event: KeyboardEvent) => false | undefined;
  showNewRecords?: boolean;
  onListChanged?: () => void;
  publishing?: (
    attachmentKeys: readonly string[],
  ) => Partial<AnnotState> | null;
}

type Landed = { list: AnnotationList; scope: string | null } | null;

export type RunCause = "list-change" | "rerun" | "new-request";

function recordId(attachmentKey: string, annotationKey: string): string {
  return `${attachmentKey}\n${annotationKey}`;
}

export interface LayoutRow {
  annotationKey: string;
  attachmentKey: string;
  group?: CardGroup;
}

export class AnnotationsLayout extends Component {
  readonly store: AnnotStore;
  readonly #deps: AnnotationsLayoutDeps;
  readonly #host: AnnotationsLayoutHost;
  readonly #runner: ViewRunner;
  #actions: AnnotActions | null = null;
  #root: Root | null = null;
  #el: HTMLElement | null = null;
  #subscriptions: DisposableStack | null = null;
  #shown: readonly string[] = [];
  #rows: readonly LayoutRow[] = [];
  #hold: Disposable | null = null;
  readonly #listKeys = new Map<string, ReadonlySet<string>>();
  readonly #listAdded = new Map<string, string>();
  #known: ReadonlySet<string> | null = null;
  readonly #landed = new Map<string, Landed>();
  readonly #reads = new Map<string, Disposable>();
  readonly #holdAttachmentsCommand = makeHoldAttachmentsCommand();
  readonly #refreshCommand = makeRefreshCommand();
  readonly #excerptCommand = makeExcerptRequestCommand();
  readonly #tagNamesCommand = makeLibraryTagNamesCommand();
  #reading: Promise<void> = Promise.resolve();
  #closed = false;
  #boundReader: ReaderSession | null = null;
  #readerPending = false;
  #pushing: readonly string[] | null = null;

  constructor(deps: AnnotationsLayoutDeps, host: AnnotationsLayoutHost) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.store = createAnnotStore(deps.registry);
    this.#runner = makeViewRunner(deps.registry);
  }

  get read(): Promise<void> {
    return this.#reading;
  }

  get actions(): AnnotActions | null {
    return this.#actions;
  }

  get attachments(): readonly string[] {
    return this.#shown;
  }

  override onload(): void {
    this.store.hold();
    this.#closed = false;
    const deps = this.#deps;
    const subscriptions = new DisposableStack();
    this.#subscriptions = subscriptions;
    const gestures = { ...NO_HOST_GESTURES, ...this.#host.gestures };

    const { run } = this.#runner;
    const insertDeps: InsertDeps<ViewServices> = {
      app: deps.app,
      execute: annotationInsert,
      run,
      notify: (message) => void new BaseNotice(message),
      snapshot: (annotation) => {
        const state = this.store.getState();
        const held = state.sources.get(annotation.parentKey);
        return {
          source: state.annotations?.includes(annotation)
            ? (held?.source ?? null)
            : null,
          sourceScope: held?.scope ?? null,
        };
      },
    };
    const insert = createInsertHandler(insertDeps);
    const drag = createDragInsertHandler(insertDeps);
    subscriptions.defer(insert.cancel);
    subscriptions.defer(drag.cancel);

    this.#actions = createAnnotActions({
      app: deps.app,
      opener: deps.opener,
      excerptImageRequest: (target) => this.#excerptRequest(target),
      registry: deps.registry,
      run,
      controls: (annot) => this.#cardControls(annot),
      selectedCards: () => this.#selectedCards(),
      libraryTagNames: (annot) =>
        new Promise((complete) =>
          deps.registry.set(this.#tagNamesCommand, {
            key: annot.key,
            complete,
          }),
        ),
      getState: () => this.store.getState(),
      toggleSelectedTag: (tag) =>
        this.store.setState({
          selectedTags: toggledTags(this.store.getState().selectedTags, tag),
        }),
      refresh: () => this.refresh(),
      onAllowEditing: () =>
        deps.registry.set(editingCapabilityCommand, { kind: "allow" }),
      onSelectAnnotation: (annot, gesture, place) =>
        this.#clickFromView({ kind: gesture, key: annot.key, place }),
      onClearSelection: () => void this.#clearFromView(),
      selectAlone: (annot) => this.#selectAloneFromView(annot.key),
      closeEditors: () => void this.#closeEditors(),
      openEditor: (annot, field) =>
        this.store.setState({ editing: { annotationKey: annot.key, field } }),
      onDragStart: drag,
      offerAnnotationInsert: () => {
        const offered = insert.offer();
        if (!offered) return null;
        return (annotation) => {
          const current = this.store
            .getState()
            .annotations?.find(({ key }) => key === annotation.key);
          offered(current ?? annotation);
        };
      },
      renderComment: createCommentRenderer({
        app: deps.app,
        component: this,
        getSourcePath: () => this.#host.sourcePath(),
      }),
      ...gestures,
    });

    const commands: import("effect/reactivity/Atom").Atom<unknown>[] = [
      annotationDraftCommand,
      annotationWriteCommand,
      openExcerptDemandCommand,
      refreshExcerptDisplayCommand,
      this.#excerptCommand,
      editingCapabilityCommand,
      this.#tagNamesCommand,
      this.#holdAttachmentsCommand,
      this.#refreshCommand,
      annotationHistoryCommand,
    ];
    for (const command of commands)
      subscriptions.defer(deps.registry.mount(command));
    this.#mountKeys(subscriptions);
    this.#subscribe(subscriptions);
  }

  override onunload(): void {
    this.#closed = true;
    this.cancelReads();
    this.#submitOpenEditor();
    this.#root?.unmount();
    this.#root = null;
    this.#subscriptions?.dispose();
    this.#subscriptions = null;
    this.#runner[Symbol.dispose]();
    this.#hold?.[Symbol.dispose]();
    this.#hold = null;
    this.#el = null;
    this.#actions = null;
    this.store[Symbol.dispose]();
  }

  render(el: HTMLElement, content: ReactNode = <AnnotList collapsed />): void {
    const actions = this.#actions;
    if (!actions) throw new Error("The Annotations Layout renders once loaded");
    this.#root?.unmount();
    this.#el = el;
    this.#root = createRoot(el);
    this.#root.render(
      this.provide(
        <AnnotActionsContext value={actions}>{content}</AnnotActionsContext>,
      ),
    );
  }

  provide(content: ReactNode): ReactNode {
    return (
      <AppContext value={this.#deps.app}>
        <AnnotStoreProvider value={this.store}>{content}</AnnotStoreProvider>
      </AppContext>
    );
  }

  // #region the list

  showRows(
    rows: readonly LayoutRow[],
    also: readonly string[] = [],
  ): Promise<boolean> {
    this.#rows = rows;
    this.#known = null;
    this.#listKeys.clear();
    const groups: CardPlacement[] = rows.flatMap((row) =>
      row.group ? [{ annotationKey: row.annotationKey, group: row.group }] : [],
    );
    this.store.setState({ groups: groups.length > 0 ? groups : null });
    const attachmentKeys = [
      ...new Set([...rows.map((row) => row.attachmentKey), ...also]),
    ];
    const previous = this.#hold;
    this.#deps.registry.set(this.#holdAttachmentsCommand, attachmentKeys);
    this.#hold = requireResult(
      this.#deps.registry.get(this.#holdAttachmentsCommand),
    );
    if (!sameKeys(attachmentKeys, this.#shown)) {
      this.#shown = [...attachmentKeys];
      for (const [key, read] of this.#reads) {
        if (attachmentKeys.includes(key)) continue;
        read[Symbol.dispose]();
        this.#reads.delete(key);
      }
      for (const key of this.#landed.keys())
        if (!attachmentKeys.includes(key)) this.#landed.delete(key);
      this.#syncCapabilities();
      this.store.setState({ cardSelection: NO_SELECTION });
      this.#takeReaderSelection();
    }
    const landing = Promise.all(
      attachmentKeys.map((key) => this.#readAttachment(key)),
    ).then((landed) => landed.every(Boolean));
    this.#reading = landing.then(() => {});
    this.#publish();
    void landing.then(() => {
      previous?.[Symbol.dispose]();
      if (this.#rows !== rows) return;
      for (const attachmentKey of attachmentKeys) {
        const keys = this.#annotationKeys(attachmentKey);
        if (keys) this.#listKeys.set(attachmentKey, keys);
      }
    });
    return landing;
  }

  keepsBack(rowKeys: Iterable<string>, cause: RunCause): boolean {
    if (cause === "new-request") {
      this.#listAdded.clear();
      return false;
    }
    const named = new Set(rowKeys);
    for (const [key, attachmentKey] of this.#listAdded) {
      if (named.has(key) || !this.#annotationKeys(attachmentKey)?.has(key))
        this.#listAdded.delete(key);
    }
    return cause === "list-change" && this.#listAdded.size > 0;
  }

  clear(): void {
    this.cancelReads();
    this.#shown = [];
    this.#rows = [];
    this.#listKeys.clear();
    this.#landed.clear();
    this.#syncCapabilities();
    this.store.setState({
      groups: null,
      unresolved: [],
      annotations: null,
      sources: new Map(),
      fieldDrafts: noFieldDrafts(),
      tagDrafts: new Map(),
      editing: null,
      cardSelection: NO_SELECTION,
    });
    this.#takeReaderSelection();
    this.#hold?.[Symbol.dispose]();
    this.#hold = null;
  }

  clearCardsFor(attachmentKey: string): void {
    if (!sameKeys(this.#shown, [attachmentKey])) {
      this.clear();
      return;
    }
    this.store.setState({
      annotations: null,
      sources: new Map(),
      unresolved: [],
      editing: null,
    });
  }

  cancelReads(): void {
    for (const read of this.#reads.values()) read[Symbol.dispose]();
    this.#reads.clear();
  }

  async refresh(): Promise<void> {
    const shown = this.#shown;
    if (shown.length === 0) return;
    await new Promise<void>((complete) =>
      this.#deps.registry.set(this.#refreshCommand, { keys: shown, complete }),
    );
    await this.#reading;
    if (sameKeys(this.#shown, shown))
      this.#deps.registry.set(refreshExcerptDisplayCommand, undefined);
  }

  revalidate(): void {
    this.#deps.registry.set(this.#refreshCommand, {
      keys: this.#shown,
      complete: () => {},
    });
  }

  #readAttachment(attachmentKey: string): Promise<boolean> {
    this.#reads.get(attachmentKey)?.[Symbol.dispose]();
    const read = observeRead(
      this.#deps.registry,
      makeAttachmentRead(attachmentKey),
    );
    this.#reads.set(attachmentKey, read);
    return read.promise.then((answer) => {
      if (this.#reads.get(attachmentKey) !== read) return false;
      if (!answer) {
        Effect.runSyncWith(logServices)(
          Effect.logWarning(
            "Failed to read the annotations of an attachment",
          ).pipe(
            Effect.annotateLogs({
              attachmentKey,
            }),
            withLogCategory("views", "annot-view"),
          ),
        );
        this.#landed.set(attachmentKey, null);
        this.#publish();
        return false;
      }
      const { list, scope } = answer;
      if (list === null) {
        if (!this.#landed.has(attachmentKey)) {
          this.#landed.set(attachmentKey, null);
          this.#publish();
        }
        return false;
      }
      this.#landed.set(attachmentKey, { list, scope });
      this.#publish();
      return true;
    });
  }

  #composed(): Pick<
    AnnotState,
    "annotations" | "sources" | "unresolved"
  > | null {
    const landed = this.#shown.map((key) => this.#landed.get(key));
    if (landed.includes(undefined)) return null;
    const sources = new Map<string, HeldSource>();
    for (const [index, key] of this.#shown.entries()) {
      const held = landed[index];
      if (held)
        sources.set(key, { source: held.list.source, scope: held.scope });
    }
    const records = new Map(
      landed.flatMap(
        (held) =>
          held?.list.annotations.map(
            (record) =>
              [recordId(record.parentKey, record.key), record] as const,
          ) ?? [],
      ),
    );
    const annotations: AnnotationRecord[] = [];
    const unresolved: string[] = [];
    const seen = new Set<string>();
    for (const row of this.#rows) {
      const id = recordId(row.attachmentKey, row.annotationKey);
      if (seen.has(id)) continue;
      seen.add(id);
      const record = records.get(id);
      if (record) annotations.push(record);
      else unresolved.push(row.annotationKey);
    }
    this.#known ??= new Set(records.keys());
    if (this.#host.showNewRecords && this.store.getState().groups === null)
      this.#placeNewRecords(annotations, landed, this.#known);
    return { annotations, sources, unresolved };
  }

  #placeNewRecords(
    annotations: AnnotationRecord[],
    landed: readonly (Landed | undefined)[],
    known: ReadonlySet<string>,
  ): void {
    for (const held of landed) {
      if (!held) continue;
      let at = -1;
      for (const record of held.list.annotations) {
        const id = recordId(record.parentKey, record.key);
        const shown = annotations.indexOf(record);
        if (shown !== -1) {
          at = shown;
          continue;
        }
        if (known.has(id)) continue;
        if (at === -1) {
          const first = annotations.findIndex(
            ({ parentKey }) => parentKey === record.parentKey,
          );
          at = (first === -1 ? annotations.length : first) - 1;
        }
        annotations.splice(at + 1, 0, record);
        at += 1;
      }
    }
  }

  #publish(): void {
    const composed = this.#composed();
    if (!composed?.annotations) return;
    const { annotations } = composed;
    const fieldDrafts = byTextField(
      (field) =>
        new Map(
          annotations.flatMap((annotation) => {
            const draft = resultValue(
              this.#deps.registry.get(annotationStateAtom(annotation.key)),
            )?.textDrafts[field];
            return draft ? [[annotation.key, draft] as const] : [];
          }),
        ),
    );
    const tagDrafts = new Map(
      annotations.flatMap((annotation) => {
        const draft = resultValue(
          this.#deps.registry.get(annotationStateAtom(annotation.key)),
        )?.tagDraft;
        return draft ? [[annotation.key, draft] as const] : [];
      }),
    );
    this.store.setState({
      ...composed,
      fieldDrafts,
      tagDrafts,
      ...this.#host.publishing?.(this.#shown),
    });
  }

  #heldList(
    attachmentKey: string,
  ): Pick<AnnotState, "annotations" | "sources"> | null {
    if (!this.#shown.includes(attachmentKey)) return null;
    const held = resultValue(
      this.#deps.registry.get(heldListAtom(attachmentKey)),
    );
    if (!held) return null;
    const scope = this.#landed.get(attachmentKey)?.scope ?? this.#dataDir();
    this.#landed.set(attachmentKey, { list: held.value, scope });
    return this.#composed();
  }

  #listChanged(attachmentKey: string): void {
    const before = this.#listKeys.get(attachmentKey);
    if (!before) return;
    const now = this.#annotationKeys(attachmentKey);
    if (
      now === null ||
      (now.size === before.size && [...now].every((key) => before.has(key)))
    )
      return;
    this.#listKeys.set(attachmentKey, now);
    for (const key of now) {
      if (!before.has(key)) this.#listAdded.set(key, attachmentKey);
    }
    this.#host.onListChanged?.();
  }

  #syncCapabilities(): void {
    this.store.setState({
      capabilities: new Map(
        this.#shown.map((key) => [
          key,
          resultValue(this.#deps.registry.get(attachmentCapabilityAtom(key))) ??
            this.#deps.registry.get(annotationCapabilityAtom),
        ]),
      ),
    });
  }

  // #endregion

  #subscribe(subscriptions: DisposableStack): void {
    const { registry } = this.#deps;
    subscriptions.defer(
      registry.subscribe(annotationCapabilityAtom, () =>
        this.#syncCapabilities(),
      ),
    );
    let previousLists = registry.get(annotationListsChangeAtom);
    subscriptions.defer(
      registry.subscribe(annotationListsChangeAtom, (changes) => {
        const last = previousLists;
        previousLists = changes;
        for (const [key, event] of changes) {
          if (event === last.get(key) || !this.#shown.includes(key)) continue;
          const held = this.#heldList(key);
          if (held) this.store.setState(held);
          this.#reading = this.#readAttachment(key).then(() => {});
          this.#listChanged(key);
        }
      }),
    );
    let previousAnnotations = registry.get(annotationChangeAtom);
    subscriptions.defer(
      registry.subscribe(annotationChangeAtom, (changes) => {
        const last = previousAnnotations;
        previousAnnotations = changes;
        for (const [annotationKey, now] of changes) {
          if (now === last.get(annotationKey)) continue;
          const state = this.store.getState();
          const mutations = new Map(state.mutations);
          mutations.set(annotationKey, now.mutation);
          const fieldDrafts = byTextField((field) => {
            const drafts = new Map(state.fieldDrafts[field]);
            const draft = now.textDrafts[field];
            if (draft) drafts.set(annotationKey, draft);
            else drafts.delete(annotationKey);
            return drafts;
          });
          const tagDrafts = new Map(state.tagDrafts);
          const ended = now.tagDraft ? undefined : tagDrafts.get(annotationKey);
          if (now.tagDraft) tagDrafts.set(annotationKey, now.tagDraft);
          else tagDrafts.delete(annotationKey);
          this.store.setState({
            mutations,
            fieldDrafts,
            tagDrafts,
            ...(ended && this.#heldList(ended.attachmentKey)),
            ...(now.gone &&
              state.editing?.annotationKey === annotationKey && {
                editing: null,
              }),
          });
        }
      }),
    );
    subscriptions.defer(
      this.store.subscribe(
        (s) => visibleOrder(s),
        () => {
          if (this.store.getState().annotations === null) return;
          const { selection, changed } = this.#setSelection({ kind: "prune" });
          const session = this.#boundPdfSession();
          const push =
            changed &&
            !this.#readerPending &&
            session !== null &&
            !sameKeys(session.selected, selection.selected);
          if (changed)
            Effect.runSyncWith(logServices)(
              Effect.logDebug(
                "A prune dropped hidden cards from the selection",
              ).pipe(
                Effect.annotateLogs({
                  selected: selection.selected.length,
                  pushed: push,
                  readerPending: this.#readerPending,
                  bound: session !== null,
                }),
                withLogCategory("views", "annot-view"),
              ),
            );
          if (push && session) this.#pushToPdf(session, selection.selected);
        },
        { equalityFn: sameKeys },
      ),
    );
    subscriptions.defer(
      this.store.subscribe(
        (s) => s.annotations,
        (next, previous) => {
          if (!this.#readerPending) return;
          const before = new Set(previous?.map(({ key }) => key));
          const loaded = next?.some(
            ({ key }) =>
              !before.has(key) && this.#boundReader?.selected.includes(key),
          );
          if (loaded) this.#takeReaderSelection();
        },
      ),
    );
    subscriptions.defer(
      this.store.subscribe(
        (s) => editorOpen(s),
        (open) => {
          if (!open && this.#readerPending) this.#takeReaderSelection();
        },
      ),
    );
  }

  #mountKeys(subscriptions: DisposableStack): void {
    const { scope } = this.#host;
    const add = (registration: Disposable) => subscriptions.use(registration);

    add(
      registerKeymap(scope, [], "Escape", (event) => {
        if (inTextEntry(event.target)) return;
        if (this.#clearFromView()) return false;
        return this.#host.onEscape?.(event);
      }),
    );

    for (const [key, step] of [
      ["ArrowUp", -1],
      ["ArrowDown", 1],
    ] as const) {
      add(
        registerKeymap(scope, [], key, (event) => {
          if (!this.#onCardList(event.target)) return;
          if (this.#moveFromView(step)) return false;
        }),
      );
      add(
        registerKeymap(scope, ["Shift"], key, (event) => {
          if (!this.#onCardList(event.target)) return;
          if (this.#extendFromView(step)) return false;
        }),
      );
    }

    add(
      registerKeymap(scope, ["Mod"], "A", (event) => {
        if (controlOwnsKey(event.target)) return;
        this.#changeFromView({ kind: "all" });
        return false;
      }),
    );

    for (const key of ["Delete", "Backspace"]) {
      add(
        registerKeymap(scope, [], key, (event) => {
          if (!this.#onCardList(event.target)) return;
          if (this.store.getState().cardSelection.selected.length === 0) return;
          this.#actions?.onDeleteSelection();
          return false;
        }),
      );
    }

    for (const [index, color] of ANNOTATION_COLORS.entries()) {
      add(
        registerKeymap(scope, [], String(index + 1), (event) => {
          if (controlOwnsKey(event.target)) return;
          if (this.store.getState().cardSelection.selected.length === 0) return;
          this.#actions?.onRecolorSelection(color);
          return false;
        }),
      );
    }

    add(
      registerKeymap(scope, ["Mod"], "C", (event) => {
        if (controlOwnsKey(event.target)) return;
        const el = this.#el;
        const selection = el?.win.getSelection();
        if (
          selection &&
          !selection.isCollapsed &&
          el?.contains(selection.anchorNode)
        )
          return;
        if (this.#actions?.onCopySelection()) return false;
      }),
    );

    add(
      mountCardHistoryKeys(
        scope,
        (direction) => {
          const attachmentKey = this.historyAttachment;
          if (attachmentKey !== null)
            this.stepHistory(direction, attachmentKey);
        },
        { isMacOS: Platform.isMacOS },
      ),
    );
  }

  // #region history

  get historyAttachment(): string | null {
    const { annotations, cardSelection } = this.store.getState();
    const { focus } = cardSelection;
    const key = focus !== null ? placedKey(focus) : cardSelection.selected[0];
    const card = key && annotations?.find((record) => record.key === key);
    if (card) return card.parentKey;
    return this.#shown.length === 1 ? this.#shown[0]! : null;
  }

  stepHistory(direction: HistoryDirection, attachmentKey: string): void {
    this.#deps.registry.set(annotationHistoryCommand, {
      key: attachmentKey,
      direction,
      complete: (outcome) => {
        if (this.#closed) return;
        const notice = historyOutcomeNotice(outcome, Temporal.Now.instant());
        if (notice !== null) new BaseNotice(notice);
        switch (outcome.kind) {
          case "stepped":
            return this.scrollToCard([outcome.annotationKey]);
          case "removed":
            return;
          case "blocked":
            this.#deps.registry.set(editingCapabilityCommand, {
              kind: "blocked",
              key: attachmentKey,
            });
            return;
          case "changed":
          case "failed":
          case "locked":
          case "idle":
            return;
          default:
            outcome satisfies never;
            return;
        }
      },
    });
  }

  // #endregion

  #excerptRequest(input: {
    annotation: AnnotationRecord;
    source: AnnotationSource | null;
    sourceScope: string | null;
  }): Promise<ExcerptRequest | null> {
    return new Promise((complete) =>
      this.#deps.registry.set(this.#excerptCommand, { ...input, complete }),
    );
  }

  #dataDir(): string {
    return this.#deps.registry.get(zoteroDataDirAtom);
  }

  #annotationKeys(key: string): ReadonlySet<string> | null {
    this.#deps.registry.refresh(heldListAtom(key));
    const held = resultValue(this.#deps.registry.get(heldListAtom(key)));
    return held ? new Set(held.value.annotations.map(({ key }) => key)) : null;
  }

  #cardControls(annot: AnnotationRecord): CardControls {
    const state = this.store.getState();
    return cardControls({
      blocks: blocksNow(annot, capabilityOf(state, annot.parentKey)),
      mutation: state.mutations.get(annot.key) ?? IDLE,
      hasTags: annot.tags.length > 0,
      type: annot.type,
    });
  }

  // #region card selection

  bindReader(reader: ReaderSession | null): void {
    if (reader === this.#boundReader) return;
    Effect.runSyncWith(logServices)(
      Effect.logDebug("The Card Selection binds another reader").pipe(
        Effect.annotateLogs({
          source: reader?.source ?? null,
        }),
        withLogCategory("views", "annot-view"),
      ),
    );
    this.#boundReader = reader;
    this.#takeReaderSelection();
  }

  readerSelectionChanged(reader: ReaderSession): void {
    if (reader === this.#boundReader) this.#takeReaderSelection();
  }

  resetSelection(): void {
    this.#readerPending = false;
    this.store.setState({ cardSelection: NO_SELECTION });
  }

  #setSelection(change: SelectionChange): {
    selection: CardSelection;
    changed: boolean;
  } {
    const state = this.store.getState();
    const current = state.cardSelection;
    const selection = nextCardSelection(current, visibleOrder(state), change);
    if (selection === current) return { selection, changed: false };
    this.store.setState({ cardSelection: selection });
    return { selection, changed: true };
  }

  #takeReaderSelection(): void {
    this.#readerPending = false;
    const reader = this.#boundReader;
    if (!reader) return;
    if (this.#pushing !== null && sameKeys(reader.selected, this.#pushing))
      return;
    const state = this.store.getState();
    const keys = reader.selected;
    if (editorOpen(state)) {
      this.#readerPending = true;
      Effect.runSyncWith(logServices)(
        Effect.logDebug(
          "A reader selection waits for the card editor to close",
        ).pipe(
          Effect.annotateLogs({
            source: reader.source,
            keys: keys.length,
          }),
          withLogCategory("views", "annot-view"),
        ),
      );
      return;
    }
    const listed = new Set(state.annotations?.map(({ key }) => key));
    this.#readerPending = !keys.every((key) => listed.has(key));
    const { selection, changed } = this.#setSelection({
      kind: "replace",
      keys,
    });
    Effect.runSyncWith(logServices)(
      Effect.logDebug("A reader selection replaced the Card Selection").pipe(
        Effect.annotateLogs({
          source: reader.source,
          keys: keys.length,
          selected: selection.selected.length,
          waitsForList: this.#readerPending,
        }),
        withLogCategory("views", "annot-view"),
      ),
    );
    if (changed) this.scrollToCard(selection.selected);
  }

  #changeFromView(change: SelectionChange, landOn?: string): CardSelection {
    this.#readerPending = false;
    const { selection, changed } = this.#setSelection(change);
    if (changed) this.#closeEditors();
    const session = this.#boundPdfSession();
    if (!session) return selection;
    if (!sameKeys(session.selected, selection.selected))
      this.#pushToPdf(session, selection.selected);
    if (landOn !== undefined) session.navigateToAnnotation(landOn);
    return selection;
  }

  #pushToPdf(session: ReaderSession, keys: readonly string[]): void {
    this.#pushing = keys;
    try {
      session.setSelectedAnnotations(keys);
    } finally {
      this.#pushing = null;
    }
  }

  #onCardList(target: EventTarget | null): boolean {
    const node = target as Node | null;
    if (!node?.instanceOf(HTMLElement)) return false;
    if (node === this.#el || this.#host.onList?.(node) === true) return true;
    return (
      this.#el?.contains(node) === true &&
      node.matches(`${CARD_SELECTOR}, .annots-container, [role="grid"]`)
    );
  }

  #selectedCards(): AnnotationRecord[] {
    const { annotations, cardSelection } = this.store.getState();
    const byKey = new Map(annotations?.map((annot) => [annot.key, annot]));
    return cardSelection.selected.flatMap((key) => byKey.get(key) ?? []);
  }

  #clickFromView(change: Extract<SelectionChange, { kind: CardClick }>): void {
    const { key } = change;
    const adds =
      change.kind === "click" ||
      (change.kind === "toggle" &&
        !this.store.getState().cardSelection.selected.includes(key));
    this.#changeFromView(change, adds ? key : undefined);
  }

  #selectAloneFromView(key: string): void {
    if (selectedAlone(this.store.getState(), key)) return;
    this.#clickFromView({ kind: "click", key });
  }

  #moveFromView(step: 1 | -1): boolean {
    const place = this.#stepFromView({ kind: "move", step });
    if (place === null) return false;
    this.#boundPdfSession()?.navigateToAnnotation(placedKey(place));
    return true;
  }

  #extendFromView(step: 1 | -1): boolean {
    return this.#stepFromView({ kind: "extend", step }) !== null;
  }

  #stepFromView(
    change: Extract<SelectionChange, { kind: "move" | "extend" }>,
  ): CardPlace | null {
    const current = this.store.getState().cardSelection;
    const next = this.#changeFromView(change);
    const place = next.focus;
    if (next === current || place === null) return null;
    const card = this.#placedCardElement(place);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
    return place;
  }

  #clearFromView(): boolean {
    if (this.#closeEditors()) return true;
    const selected =
      this.store.getState().cardSelection.selected.length > 0 ||
      (this.#boundPdfSession()?.selected.length ?? 0) > 0;
    if (selected) this.#changeFromView({ kind: "clear" });
    return selected;
  }

  #closeEditors(): boolean {
    if (!editorOpen(this.store.getState())) return false;
    this.#submitOpenEditor();
    this.store.setState({ editing: null });
    return true;
  }

  #submitOpenEditor(): void {
    const { editing } = this.store.getState();
    if (!editing || editing.field === "tags") return;
    this.#deps.registry.set(annotationWriteCommand, {
      kind: "submit-field",
      key: editing.annotationKey,
      field: editing.field,
      automatic: true,
      complete: (outcomes) => {
        for (const outcome of outcomes)
          if (outcome.kind === "failed")
            new BaseNotice(
              writeFailureMessage(outcome.failure, Temporal.Now.instant()),
            );
      },
    });
  }

  #boundPdfSession(): ReaderSession | null {
    const reader = this.#boundReader;
    return reader?.source === "obsidian-pdf" ? reader : null;
  }

  // #endregion

  scrollToCard(keys: readonly string[]): void {
    for (const key of keys) {
      const el = this.#cardElement(key);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  }

  #cardElement(key: string): HTMLElement | null {
    const el = this.#el?.querySelector(
      `${CARD_SELECTOR}[data-zotero-annotation-key="${key}"]`,
    );
    return el?.instanceOf(HTMLElement) ? el : null;
  }

  #placedCardElement(place: CardPlace): HTMLElement | null {
    const cards = this.#el?.querySelectorAll<HTMLElement>(
      `${CARD_SELECTOR}[data-zotero-annotation-key="${placedKey(place)}"]`,
    );
    return (
      [...(cards ?? [])].find(
        (card) => card.getAttribute("data-card-place") === place,
      ) ?? null
    );
  }

  revealAnnotation(annotationKey: string): void {
    const held = this.store
      .getState()
      .annotations?.some((record) => record.key === annotationKey);
    if (held !== true) return;
    this.#changeFromView({ kind: "click", key: annotationKey });
    this.scrollToCard([annotationKey]);
  }
}
