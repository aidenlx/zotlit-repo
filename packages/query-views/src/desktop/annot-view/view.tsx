import type {
  QueryViewDeps,
  QueryViewHost,
} from "#desktop/query-view/view.tsx";
import { Effect } from "effect";
import { ItemView, Scope } from "obsidian";
import type {
  Menu as ObsidianMenu,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";

import type { ReaderSession } from "@zotlit/annotations/core/reader-session/session.ts";
import { ReaderSessionHost } from "@zotlit/annotations/core/reader-session/session.ts";
import type { AnnotActions } from "@zotlit/annotations/desktop/annot-view/actions.tsx";
import { AnnotView } from "@zotlit/annotations/desktop/annot-view/AnnotView.tsx";
import {
  makeTargetRead,
  readerResolutionAtom,
  resultValue,
  enableLiveUpdatesCommand,
} from "@zotlit/annotations/desktop/annot-view/atoms.ts";
import type { AnnotationsLayout } from "@zotlit/annotations/desktop/annot-view/layout.tsx";
import { buildPaneMenu } from "@zotlit/annotations/desktop/annot-view/pane-menu.ts";
import { viewTargetOpener } from "@zotlit/annotations/desktop/attachment-open/view-opener.ts";
import { sanitizeSavedFilter } from "@zotlit/annotations/obsidian/annot-view/filter.ts";
import type { SavedFilter } from "@zotlit/annotations/obsidian/annot-view/filter.ts";
import {
  holdAnnotViewModel,
  observeRead,
  pinCurrentItem,
  pinItem,
  sameAnnotViewState,
  setFollowMode,
  unpin,
} from "@zotlit/annotations/obsidian/annot-view/model.ts";
import type { AnnotViewModel } from "@zotlit/annotations/obsidian/annot-view/model.ts";
import type { AnnotStore } from "@zotlit/annotations/obsidian/annot-view/model.ts";
import { resolveLoadTarget } from "@zotlit/annotations/obsidian/annot-view/resolve-target.ts";
import type {
  ActiveLeafTarget,
  LoadTarget,
} from "@zotlit/annotations/obsidian/annot-view/resolve-target.ts";
import {
  INITIAL_FILTER_STATE,
  selectActiveAttachment,
} from "@zotlit/annotations/obsidian/annot-view/state.ts";
import type {
  AnnotState,
  FollowMode,
} from "@zotlit/annotations/obsidian/annot-view/state.ts";
import {
  parseAnnotViewState,
  readSidebarQuery,
  serializeAnnotViewState,
} from "@zotlit/annotations/obsidian/annot-view/view-state.ts";
import type { AnnotViewState } from "@zotlit/annotations/obsidian/annot-view/view-state.ts";
import type { HistorySurface } from "@zotlit/annotations/obsidian/annotation-repository/actions.ts";
import {
  annotationCapabilityAtom,
  attachmentCapabilityAtom,
} from "@zotlit/annotations/obsidian/annotation-repository/atoms.ts";
import type {
  AnnotationRecord,
  AnnotationSource,
  HistoryDirection,
} from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { pdfSessionsAtom } from "@zotlit/annotations/obsidian/pdf-annotation-editor/atoms.ts";
import type { AnnotViewAttachment } from "@zotlit/db";
import { registerMigratingWindowEvent } from "@zotlit/obsidian-kit/disposables.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { ItemSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ItemLookupHandle } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { pickItem } from "@zotlit/plugin-services/obsidian/item-lookup/search-modal.ts";
import { libraryRowsAtom } from "@zotlit/plugin-services/obsidian/library-scope/atoms.ts";
import {
  liveUpdatesAtom,
  readerClosedAtom,
} from "@zotlit/plugin-services/obsidian/local-server/atoms.ts";
import {
  activeKeyAtom,
  activeNoteAtom,
  noteSourceAtom,
} from "@zotlit/plugin-services/obsidian/note-index/atoms.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { openTemplateDataExplorer } from "@zotlit/template-workbench/desktop/data-explorer/register.ts";
import { startTemplateWorkbenchAction } from "@zotlit/template-workbench/desktop/editor/actions.ts";
import type { WorkbenchActionDeps } from "@zotlit/template-workbench/desktop/editor/actions.ts";
import {
  zoteroRevisionAtom,
  zoteroStateAtom,
} from "@zotlit/zotero-reads/client/atoms.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";
import { annotationOpenUri } from "@zotlit/zotero-types/uri";

import { SidebarFilterModal } from "./filter-modal.tsx";
import { saveSidebarAsQueryFile } from "./save-query-file.ts";
import { addSidebarQueryMenu, sidebarQueryText } from "./sidebar-query.ts";

import { QueryView } from "#desktop/query-view/view.tsx";
import { sourceText } from "#obsidian/query-view/reader-failure.ts";

export const ANNOT_VIEW_TYPE = "zotero-annotation-view";

const STAGED_LOADING_MS = 150;

interface Staged {
  load: object;
  patch: Partial<AnnotState>;
  bound: { itemKey: string | null; attachmentKey: string | null } | null;
  late: boolean;
  timer: { win: Window; id: number } | null;
}

const STORAGE_KEY_PREFIX = "zotlit-annot-atch-";
const FILTER_STORAGE_KEY_PREFIX = "zotlit-annot-filter-";

const VIEW_MENU_SECTIONS = [
  "close",
  "pane",
  "open",
  "action",
  "find",
  "info",
  "info.copy",
  "view",
  "view.linked",
  "system",
  "",
  "danger",
] as const;

export interface AnnotViewDeps extends QueryViewDeps {
  bridge: Pick<EffectBridge, "runSync">;
  itemLookup: Pick<ItemLookupHandle, "openSession">;
  settings: Pick<PluginSettings["Service"], "current">;
  registry: ViewRegistryHandle;
  explorer: WorkbenchActionDeps;
}

export class AnnotationView extends ItemView implements HistorySurface {
  override scope: Scope;
  readonly #query: QueryView;
  #unreadable = false;
  get #queryText(): string | null {
    return this.#deps.registry.get(this.model.query);
  }
  readonly #layout: AnnotationsLayout;
  readonly #store: AnnotStore;
  readonly #deps: AnnotViewDeps;
  readonly model: AnnotViewModel;
  #release: (() => void) | null;
  #opened: DisposableStack | null = null;
  #loadDisposables: DisposableStack | null = null;
  #loading: object | null = null;
  #zoteroReader: ReaderSessionHost | null = null;
  #targetRead: Disposable | null = null;
  #leafSession: (() => void) | null = null;
  #memoryKey: string | null = null;
  #itemKey: string | null = null;
  #reading = Promise.resolve();
  #closed = false;
  #staged: Staged | null = null;

  get read(): Promise<void> {
    return this.#reading.then(() => this.#query.settled);
  }

  get #followState(): AnnotViewState {
    return this.#deps.registry.get(this.model.state);
  }

  get #followMode(): FollowMode {
    return this.#followState.followMode;
  }

  constructor(leaf: WorkspaceLeaf, deps: AnnotViewDeps) {
    super(leaf);
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root");
    this.#deps = deps;
    this.#query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => this.#sourcePath(),
      context: () => {
        const { itemKey, attachmentKey } = this.#bound();
        return {
          item: itemKey ?? undefined,
          attachment: attachmentKey ?? undefined,
        };
      },
      contextSource: "sidebar",
      keepsRowsOnRebind: true,
      save: (text) => {
        this.#deps.registry.set(this.model.query, text);
      },
      layout: {
        ...this.#layoutHost(),
        showNewRecords: true,
        publishing: (attachmentKeys) => {
          const staged = this.#staged;
          const key = staged?.bound?.attachmentKey;
          return staged && key && attachmentKeys.includes(key)
            ? this.#takeStaged(staged)
            : null;
        },
      },
      attachments: () => {
        const key = this.#bound().attachmentKey;
        return key === null ? [] : [key];
      },
    });
    this.#layout = this.#query.layout;
    this.#store = this.#layout.store;
    this.model = this.#store.model;
    this.#release = this.#holdModel();
  }

  #holdModel(): () => void {
    return holdAnnotViewModel(this.#deps.registry, this.model);
  }

  #layoutHost(): QueryViewHost["layout"] {
    return {
      gestures: {
        setSelectedAttachmentKey: (key) => {
          if (!this.#staged)
            this.#store.setState({ selectedAttachmentKey: key });
        },
        onSetFollowMode: (mode) => this.#setFollowMode(mode),
        onPinCurrentItem: () => this.#pinCurrentItem(),
        onPinItem: () => this.#pickItemToPin(),
        onUnpin: () => this.#unpin(),
        onEnableLiveUpdates: () => this.#enableLiveUpdates(),
        onOpenPdf: () => this.#openPdf(),
        fillViewMenu: (menu) => this.#fillViewMenu(menu),
        onExploreAnnotation: (annotationKey) => {
          if (!this.#itemKey) return;
          startTemplateWorkbenchAction(
            this.#deps.explorer,
            "open-template-data-explorer",
            openTemplateDataExplorer({
              itemIndexedKey: this.#itemKey,
              anchorAnnotationKey: annotationKey,
            }),
          );
        },
      },
      onList: (node) =>
        node === this.containerEl ||
        node === this.contentEl ||
        node === node.doc.body,
      onEscape: () => {
        const { leftSplit, rightSplit } = this.#deps.app.workspace;
        const root = this.leaf.getRoot();
        if (root === leftSplit || root === rightSplit) return;
        return false;
      },
    };
  }

  override getViewType(): string {
    return ANNOT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.annot_view_name();
  }

  override getIcon(): string {
    return "highlighter";
  }

  override getState(): Record<string, unknown> {
    const query = this.#queryText;
    return {
      ...serializeAnnotViewState(this.#followState),
      ...(query !== null && { query }),
    };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    this.#deps.registry.set(this.model.state, parseAnnotViewState(state));
    this.#deps.registry.set(this.model.query, readSidebarQuery(state));
    this.#reload();
  }

  get snapshot(): Readonly<
    AnnotState & { annotationSource: AnnotationSource | null }
  > {
    const state = this.#store.getState();
    const { selectedAttachmentKey } = state;
    return {
      ...state,
      annotationSource:
        selectedAttachmentKey === null
          ? null
          : (state.sources.get(selectedAttachmentKey)?.source ?? null),
    };
  }

  get gestures(): AnnotActions | null {
    return this.#layout.actions;
  }

  get historyAttachment(): string | null {
    return this.#store.getState().selectedAttachmentKey;
  }

  stepHistory(direction: HistoryDirection): void {
    const attachmentKey = this.historyAttachment;
    if (attachmentKey === null) return;
    this.#layout.stepHistory(direction, attachmentKey);
  }

  override onPaneMenu(menu: ObsidianMenu, source: string): void {
    super.onPaneMenu(menu, source);
    const actions = this.#layout.actions;
    if (!actions) return;
    const { file, view } = this.#query.state.getState();
    buildPaneMenu(menu, {
      state: this.snapshot,
      actions,
      now: Temporal.Now.instant(),
      query: (target) =>
        addSidebarQueryMenu(target, {
          view: file ? view : null,
          edit: (edit) => this.#query.document.editView(edit),
          openFilter: () =>
            new SidebarFilterModal(this.#deps.app, this.#query).open(),
          ...(file &&
            view &&
            this.#itemKey !== null && {
              saveAs: () => {
                const state = this.#store.getState();
                void saveSidebarAsQueryFile(this.#deps.app, {
                  file,
                  view,
                  filter: {
                    query: state.filterQuery,
                    colors: state.selectedColors,
                    tags: state.selectedTags,
                  },
                  itemKey: state.itemKey,
                  attachmentKey: state.selectedAttachmentKey,
                });
              },
            }),
        }),
    });
  }

  #fillViewMenu(menu: ObsidianMenu): void {
    menu.addSections(VIEW_MENU_SECTIONS);
    this.onPaneMenu(menu, "more-options");
    this.#deps.app.workspace.trigger("leaf-menu", menu, this.leaf);
  }

  protected override async onOpen(): Promise<void> {
    const { registry } = this.#deps;
    const opened = new DisposableStack();
    this.#opened = opened;
    this.register(() => opened.dispose());
    this.#release ??= this.#holdModel();
    let saved = registry.get(this.model.state);
    opened.defer(
      registry.subscribe(this.model.state, (state) => {
        if (sameAnnotViewState(state, saved)) return;
        saved = state;
        this.leaf.updateHeader();
        void this.#deps.app.workspace.requestSaveLayout();
      }),
    );

    this.#closed = false;
    opened.defer(
      registry.subscribe(this.model.query, () => {
        void this.#deps.app.workspace.requestSaveLayout();
      }),
    );
    this.#zoteroReader = new ReaderSessionHost({
      source: "zotero",
      navigate: (key) => this.#openInZotero(key),
      select: () => {},
    });
    opened.defer(() => this.#zoteroReader?.[Symbol.dispose]());
    opened.defer(
      registry.subscribe(
        readerResolutionAtom,
        (result) => {
          const resolution = resultValue(result);
          if (result.waiting) return;
          this.#zoteroReader?.setTarget(resolution?.target ?? null);
          this.#zoteroReader?.reportSelection(resolution?.selected ?? []);
        },
        { immediate: true },
      ),
    );
    opened.defer(registry.mount(enableLiveUpdatesCommand));
    this.#query.load();
    opened.defer(
      this.#query.state.subscribe(({ phase }, last) => {
        if (
          phase === "failed" &&
          last.phase !== "failed" &&
          this.#staged?.bound
        )
          this.#commitStaged(this.#staged);
        this.#syncQueryProblem();
      }),
    );

    this.#layout.render(this.contentEl, <AnnotView />);
    opened.defer(registry.subscribe(zoteroRevisionAtom, () => this.#reload()));
    opened.defer(registry.subscribe(zoteroStateAtom, () => this.#reload()));
    opened.defer(registry.subscribe(libraryRowsAtom, () => this.#reload()));
    opened.defer(
      registry.subscribe(
        activeKeyAtom,
        () => {
          if (this.#followMode === "active-tab") this.#reload();
        },
        { immediate: true },
      ),
    );
    this.registerEvent(
      this.#deps.app.workspace.on("active-leaf-change", () => {
        if (this.#deps.app.workspace.activeLeaf === this.leaf) {
          this.#layout.revalidate();
        }
        if (this.#followMode === "active-tab") this.#reload();
      }),
    );

    opened.defer(
      registry.subscribe(
        pdfSessionsAtom,
        () => {
          if (this.#followMode === "active-tab") this.#reload();
        },
        { immediate: true },
      ),
    );

    const windowFocus = registerMigratingWindowEvent(
      this.containerEl,
      "focus",
      () => this.#layout.revalidate(),
    );
    opened.defer(() => windowFocus[Symbol.dispose]());

    const zoteroReader = this.#zoteroReader;
    opened.defer(
      zoteroReader.on("target-changed", () => {
        if (this.#followMode === "zotero-reader") this.#reload();
      }),
    );
    opened.defer(
      zoteroReader.on("selection-changed", () =>
        this.#layout.readerSelectionChanged(zoteroReader),
      ),
    );

    opened.defer(
      registry.subscribe(
        liveUpdatesAtom,
        (available) => {
          this.#store.setState({ liveUpdatesOn: available });
          if (this.#followMode === "zotero-reader") this.#reload();
        },
        { immediate: true },
      ),
    );
    opened.defer(
      registry.subscribe(
        readerClosedAtom,
        (closed) => {
          this.#store.setState({ zoteroReaderClosed: closed });
        },
        { immediate: true },
      ),
    );
    opened.defer(
      registry.subscribe(
        annotationCapabilityAtom,
        () => this.#syncCapability(),
        { immediate: true },
      ),
    );
    opened.defer(
      this.#store.subscribe(
        (s) => s.selectedAttachmentKey,
        () => {
          this.#syncCapability();
        },
      ),
    );

    this.#reload();
  }

  protected override async onClose(): Promise<void> {
    this.#closed = true;
    this.#opened?.dispose();
    this.#opened = null;
    this.#loading = null;
    this.#targetRead?.[Symbol.dispose]();
    this.#targetRead = null;
    this.#cancelStaged();
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#leafSession?.();
    this.#leafSession = null;
    this.#query.unload();
    this.#release?.();
    this.#release = null;
  }

  // #region follow mode

  #setFollowMode(mode: Exclude<FollowMode, "pinned">): void {
    this.#commitMode(setFollowMode(mode));
  }

  #pinCurrentItem(): void {
    const { pinnable, selectedAttachmentKey } = this.#store.getState();
    if (pinnable === null) return;
    if (selectedAttachmentKey !== null) {
      this.#saveAttachmentSelection(pinnable, selectedAttachmentKey);
    }
    this.#commitMode(pinCurrentItem(pinnable));
  }

  #openPdf(): void {
    const active = selectActiveAttachment(this.#store.getState());
    if (!active) return;
    viewTargetOpener(this.#deps.registry, this.#deps.opener).open(
      { kind: "attachment", attachmentKey: active.indexedKey },
      false,
    );
  }

  #pickItemToPin(): void {
    void pickItem(
      {
        app: this.#deps.app,
        lookup: this.#deps.itemLookup,
        settings: this.#deps.settings,
        bridge: this.#deps.bridge,
      },
      m.annot_view_pin_placeholder(),
    ).then((hit) => {
      if (hit) this.#commitMode(pinItem(hit.item.indexedKey));
    });
  }

  #unpin(): void {
    this.#commitMode(unpin);
  }

  #commitMode(transition: (state: AnnotViewState) => AnnotViewState): void {
    const current = this.#followState;
    const next = transition(current);
    if (next === current) return;
    this.#deps.bridge.runSync(
      Effect.logDebug("Follow mode changed by a gesture").pipe(
        Effect.annotateLogs({ ...next }),
        withLogCategory("views", "annot-view"),
      ),
    );
    this.#layout.resetSelection();
    this.#deps.registry.set(this.model.state, next);
    this.#reload();
  }

  #enableLiveUpdates(): void {
    this.#deps.registry.set(enableLiveUpdatesCommand, undefined);
  }

  // #endregion

  // #region resolve + load

  #reload(): void {
    if (this.#closed) return;
    this.#followLeafSession(
      this.#followMode === "active-tab" ? this.#activePdfSession() : null,
    );
    this.#layout.bindReader(this.#followedSession());
    if (this.#deps.registry.get(zoteroStateAtom).state !== "ready") {
      this.#clearState();
      this.#unreadable =
        this.#deps.registry.get(zoteroStateAtom).state === "degraded";
      this.#syncQueryProblem();
      return;
    }
    this.#unreadable = false;
    this.#loadTarget(this.#resolveTarget());
  }

  #syncQueryProblem(): void {
    const { phase, failure, results } = this.#query.state.getState();
    const failed = phase === "failed" && failure !== null;
    const keptResults = results !== null;
    this.#store.setState({
      queryProblem: this.#unreadable
        ? { message: m.annot_view_zotero_unreadable(), detail: "" }
        : failed && !keptResults
          ? {
              message: m.annot_view_query_failed(),
              detail: sourceText(failure.reader),
            }
          : null,
      filterError:
        !this.#unreadable &&
        failed &&
        keptResults &&
        failure.filterIssue !== null,
    });
  }

  #resolveTarget(): LoadTarget | null {
    const libraries = this.#deps.registry.get(libraryRowsAtom);
    switch (this.#followMode) {
      case "active-tab":
        return resolveLoadTarget({
          mode: "active-tab",
          leaf: this.#resolveActiveLeaf(),
          libraries,
        });
      case "zotero-reader":
        return this.#store.getState().liveUpdatesOn
          ? resolveLoadTarget({
              mode: "zotero-reader",
              target: this.#zoteroReader?.target ?? null,
              libraries,
            })
          : null;
      case "pinned":
        return resolveLoadTarget({
          mode: "pinned",
          pinnedItemKey: this.#followState.pinnedItemKey,
          libraries,
        });
    }
  }

  #resolveActiveLeaf(): ActiveLeafTarget | null {
    const activeFile = this.#deps.app.workspace.getActiveFile();
    if (!activeFile) return null;
    const session = this.#activePdfSession();
    if (session) {
      return session.target ? { kind: "pdf", target: session.target } : null;
    }
    const itemKey = this.#deps.registry.get(activeNoteAtom).key;
    return itemKey === null ? null : { kind: "note", itemKey };
  }

  #followLeafSession(session: ReaderSession | null): void {
    this.#leafSession?.();
    this.#leafSession = null;
    if (!session) return;
    const stack = new DisposableStack();
    stack.defer(session.addSelectionSurface(this.contentEl));
    stack.defer(session.on("target-changed", () => this.#reload()));
    stack.defer(
      session.on("selection-changed", () =>
        this.#layout.readerSelectionChanged(session),
      ),
    );
    this.#leafSession = () => stack.dispose();
  }

  #activePdfSession(): ReaderSession | null {
    const view = this.#deps.app.workspace.getMostRecentLeaf()?.view;
    return view
      ? (this.#deps.registry.get(pdfSessionsAtom).get(view) ?? null)
      : null;
  }

  #loadTarget(target: LoadTarget | null): void {
    if (!target) {
      this.#clearState();
      return;
    }

    const { itemKey, lockedAttachmentKey, lock, key, groupID } = target;
    const memoryKey = itemKey ?? lockedAttachmentKey ?? key;
    const memoryChanged = memoryKey !== this.#memoryKey;
    this.#itemKey = itemKey;
    this.#memoryKey = memoryKey;

    if (memoryChanged) {
      this.#loadDisposables?.[Symbol.dispose]();
      this.#loadDisposables = null;
      this.#layout.cancelReads();
    }
    this.#targetRead?.[Symbol.dispose]();
    const read = observeRead(
      this.#deps.registry,
      makeTargetRead(target, this.#followMode),
    );
    this.#targetRead = read;
    const load = {};
    this.#loading = load;
    this.#cancelStaged();
    const state = {
      groupID,
      itemKey,
      attachmentLock: lock,
      pinnable: itemKey,
    } satisfies Partial<AnnotState>;

    if (memoryChanged) {
      this.#reading = this.#stage(
        target,
        { load, reading: read.promise },
        {
          ...INITIAL_FILTER_STATE,
          ...state,
        },
      );
      return;
    }

    const sameItem = itemKey === this.#store.getState().itemKey;
    this.#store.setState({
      ...state,
      ...(!sameItem && { itemDisplay: null }),
    });
    this.#reading = read.promise.then((answer) => {
      if (!answer || this.#loading !== load) return;
      const { attachments, itemDisplay } = answer;
      this.#store.setState({ attachments, itemDisplay });
      const activeKey = this.#activeAttachment(target, attachments);
      this.#store.setState({ selectedAttachmentKey: activeKey });
      return this.#followAttachment(target, activeKey, {
        attachments,
        memoryChanged: false,
      });
    });
  }

  async #stage(
    target: LoadTarget,
    {
      load,
      reading,
    }: {
      load: object;
      reading: Promise<{
        attachments: AnnotViewAttachment[];
        itemDisplay: ItemSummary | null;
      } | null>;
    },
    patch: Partial<AnnotState>,
  ): Promise<void> {
    const staged: Staged = {
      load,
      patch,
      bound: null,
      late: false,
      timer: null,
    };
    this.#staged = staged;
    const win = this.contentEl.win;
    staged.timer = {
      win,
      id: win.setTimeout(() => {
        staged.timer = null;
        staged.late = true;
        if (staged.bound) this.#commitStaged(staged, true);
      }, STAGED_LOADING_MS),
    };
    let attachments: AnnotViewAttachment[];
    let itemDisplay: ItemSummary | null;
    try {
      const answer = await reading;
      if (!answer) {
        if (this.#loading === load) this.#clearState();
        return;
      }
      ({ itemDisplay, attachments } = answer);
    } catch (err) {
      if (this.#loading !== load) return;
      this.#deps.bridge.runSync(
        Effect.logWarning("Failed to load annot view data").pipe(
          Effect.annotateLogs({
            key: target.key,
            error: err,
          }),
          withLogCategory("views", "annot-view"),
        ),
      );
      this.#clearState();
      return;
    }
    if (this.#loading !== load) return;
    const activeKey = this.#activeAttachment(target, attachments);
    staged.patch = {
      ...staged.patch,
      itemDisplay,
      attachments,
      selectedAttachmentKey: activeKey,
    };
    if (activeKey === null) {
      this.#commitStaged(staged);
      this.#query.clear();
      return;
    }
    staged.bound = { itemKey: target.itemKey, attachmentKey: activeKey };
    if (staged.late) this.#commitStaged(staged, true);
    return this.#followAttachment(target, activeKey, {
      attachments,
      memoryChanged: true,
    });
  }

  #bound(): { itemKey: string | null; attachmentKey: string | null } {
    const { itemKey, selectedAttachmentKey } = this.#store.getState();
    return (
      this.#staged?.bound ?? { itemKey, attachmentKey: selectedAttachmentKey }
    );
  }

  #takeStaged(staged: Staged): Partial<AnnotState> {
    if (staged.timer) staged.timer.win.clearTimeout(staged.timer.id);
    staged.timer = null;
    if (this.#staged === staged) this.#staged = null;
    return staged.patch;
  }

  #commitStaged(staged: Staged, loading = false): void {
    if (this.#staged !== staged) return;
    this.#store.setState(this.#takeStaged(staged));
    const attachmentKey = staged.bound?.attachmentKey;
    if (loading && attachmentKey) this.#layout.clearCardsFor(attachmentKey);
  }

  #cancelStaged(): void {
    if (this.#staged) this.#takeStaged(this.#staged);
  }

  #activeAttachment(
    { lockedAttachmentKey }: LoadTarget,
    attachments: readonly AnnotViewAttachment[],
  ): string | null {
    const held = (k: string | null): string | null =>
      k !== null && attachments.some((a) => a.indexedKey === k) ? k : null;
    const saved =
      lockedAttachmentKey === null && this.#memoryKey !== null
        ? this.#loadAttachmentSelection(this.#memoryKey)
        : null;
    return (
      held(lockedAttachmentKey) ??
      held(saved) ??
      attachments[0]?.indexedKey ??
      null
    );
  }

  #followAttachment(
    { lockedAttachmentKey, key, libraryID }: LoadTarget,
    activeKey: string | null,
    {
      attachments,
      memoryChanged,
    }: { attachments: readonly AnnotViewAttachment[]; memoryChanged: boolean },
  ): Promise<void> | undefined {
    const memoryKey = this.#memoryKey;
    if (activeKey === null || memoryKey === null) {
      this.#query.clear();
      return;
    }
    this.#loadDisposables?.[Symbol.dispose]();
    const load = new DisposableStack();
    this.#loadDisposables = load;
    const reading = this.#showAnnotations(activeKey, {
      restoreFilter: memoryChanged,
    });

    let placing = memoryChanged && this.#staged !== null;
    load.defer(
      this.#store.subscribe(
        (s) => s.selectedAttachmentKey,
        (attachmentKey) => {
          if (placing) {
            placing = false;
            if (attachmentKey === activeKey) return;
          }
          if (attachmentKey === null) return;
          if (lockedAttachmentKey === null) {
            this.#saveAttachmentSelection(memoryKey, attachmentKey);
          }
          void this.#showAnnotations(attachmentKey, { restoreFilter: false });
        },
      ),
    );

    load.defer(
      this.#store.subscribe(
        (s) => [s.selectedColors, s.selectedTags] as const,
        ([colors, tags]) =>
          this.#saveFilterSelection(memoryKey, { colors, tags }),
        {
          equalityFn: ([aColors, aTags], [bColors, bTags]) =>
            aColors === bColors && aTags === bTags,
        },
      ),
    );

    this.#deps.bridge.runSync(
      Effect.logDebug("Annot view loaded").pipe(
        Effect.annotateLogs({
          followMode: this.#followMode,
          key,
          libraryID,
          attachments: attachments.length,
        }),
        withLogCategory("views", "annot-view"),
      ),
    );
    return reading;
  }

  #showAnnotations(
    attachmentKey: string,
    { restoreFilter }: { restoreFilter: boolean },
  ): Promise<void> {
    const memoryKey = this.#memoryKey;
    this.#query.setText(this.#queryText ?? sidebarQueryText());
    this.#query.contextChanged();
    return this.#query.settled.then(() => {
      const landed =
        this.#query.state.getState().phase === "ready" &&
        this.#store.getState().selectedAttachmentKey === attachmentKey;
      if (!landed || !restoreFilter || memoryKey === null) return;
      const { annotations } = this.#store.getState();
      const saved = this.#loadFilterSelection(memoryKey, annotations ?? []);
      if (saved) {
        this.#store.setState({
          selectedColors: saved.colors,
          selectedTags: saved.tags,
        });
      }
    });
  }

  #syncCapability(): void {
    const { selectedAttachmentKey } = this.#store.getState();
    this.#store.setState({
      capability:
        selectedAttachmentKey === null
          ? this.#deps.registry.get(annotationCapabilityAtom)
          : (resultValue(
              this.#deps.registry.get(
                attachmentCapabilityAtom(selectedAttachmentKey),
              ),
            ) ?? this.#deps.registry.get(annotationCapabilityAtom)),
    });
  }

  // #endregion

  #sourcePath(): string {
    if (this.#itemKey === null) return "";
    return this.#deps.registry.get(noteSourceAtom(this.#itemKey));
  }

  revealAnnotation(annotationKey: string): void {
    this.#layout.revealAnnotation(annotationKey);
  }

  pinItem(itemKey: string): void {
    this.#commitMode(pinItem(itemKey));
  }

  #followedSession(): ReaderSession | null {
    switch (this.#followMode) {
      case "active-tab":
        return this.#activePdfSession();
      case "zotero-reader":
        return this.#zoteroReader;
      case "pinned":
        return null;
    }
  }

  #openInZotero(annotationKey: string): void {
    const annot = this.#store
      .getState()
      .annotations?.find((record) => record.key === annotationKey);
    const annotation = annot && parseIndexedKey(annot.key);
    const attachment = annot && parseIndexedKey(annot.parentKey);
    if (!annot || !annotation || !attachment) return;
    this.contentEl.win.open(
      annotationOpenUri({
        attachmentKey: attachment.key,
        annotationKey: annotation.key,
        pageLabel: annot.pageLabel,
        groupID: annotation.groupID,
      }),
    );
  }

  #clearState(): void {
    this.#targetRead?.[Symbol.dispose]();
    this.#targetRead = null;
    this.#cancelStaged();
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#loading = null;
    this.#store.setState({
      ...INITIAL_FILTER_STATE,
      itemKey: null,
      itemDisplay: null,
      attachments: null,
      selectedAttachmentKey: null,
      attachmentLock: null,
      pinnable: null,
    });
    this.#query.clear();
    this.#itemKey = null;
    this.#memoryKey = null;
  }

  #loadAttachmentSelection(memoryKey: string): string | null {
    const raw = this.#deps.app.loadLocalStorage(STORAGE_KEY_PREFIX + memoryKey);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  }

  #saveAttachmentSelection(memoryKey: string, attachmentKey: string): void {
    this.#deps.app.saveLocalStorage(
      STORAGE_KEY_PREFIX + memoryKey,
      attachmentKey,
    );
  }

  #loadFilterSelection(
    memoryKey: string,
    annots: readonly AnnotationRecord[],
  ): SavedFilter | null {
    const raw = this.#deps.app.loadLocalStorage(
      FILTER_STORAGE_KEY_PREFIX + memoryKey,
    );
    return sanitizeSavedFilter(raw, annots);
  }

  #saveFilterSelection(memoryKey: string, filter: SavedFilter): void {
    const { colors, tags } = filter;
    const key = FILTER_STORAGE_KEY_PREFIX + memoryKey;
    if (colors.length === 0 && tags.length === 0) {
      this.#deps.app.saveLocalStorage(key, null);
      return;
    }
    this.#deps.app.saveLocalStorage(key, JSON.stringify({ colors, tags }));
  }
}
