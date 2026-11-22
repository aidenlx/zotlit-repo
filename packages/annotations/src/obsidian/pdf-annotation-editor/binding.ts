import type { PdfReads } from "#core/pdf-annotation-editor/reads.ts";
import type { ReaderSession } from "#core/reader-session/session.ts";
import type { InsertRunner } from "#obsidian/annot-view/insert-run.ts";
import type { HistorySurface } from "#obsidian/annotation-repository/actions.ts";
import type { CapabilityAffordance } from "#obsidian/annotation-repository/capability-copy.ts";
import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepository,
  AnnotationSource,
  HistoryDirection,
} from "#obsidian/annotation-repository/service.ts";
import type { BorrowedExcerptDocument } from "#obsidian/excerpt-image/reader-borrow.ts";
import { Effect } from "effect";
import { Platform, TExternalFile } from "obsidian";
import type {
  FileSystemAdapter,
  HoverParent,
  HoverPopover,
  TFile,
  View,
} from "obsidian";

import type { ParsedAnnotationSubpath } from "@zotlit/db";
import {
  registerDomEvent,
  registerMigratingWindowEvent,
} from "@zotlit/obsidian-kit/disposables.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { watch } from "@zotlit/obsidian-kit/view-atoms.ts";
import { PdfTextStructure } from "@zotlit/pdf-structure";
import type {
  PdfPosition,
  RangeAdjustment,
  SelectedText,
} from "@zotlit/pdf-structure";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { themeAttribute } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  AttachmentResolution,
  AttachmentResolver,
} from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import type { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { ReaderDocument } from "@zotlit/reader-api";

import { borrowReaderDocument } from "./borrow.ts";
import {
  isEditGesture,
  removeCapabilityAffordance,
  renderCapabilityAffordance,
} from "./capability-affordance.ts";
import { MarkCreation } from "./creation.ts";
import type { ReaderPage } from "./creation.ts";
import { isRangeGrip, rangeHandles } from "./geometry-edit.ts";
import type { TextRotation } from "./geometry-edit.ts";
import type { HostedReader } from "./hosted-reader.ts";
import { decideMarkLanding } from "./mark-landing.ts";
import type { MarkLandingMiss, MarkLandingTarget } from "./mark-landing.ts";
import { MarkPopupHost } from "./mark-popup-host.ts";
import {
  oneAtATime,
  pressHistory,
  readMarks,
  reportBlockedEdit,
  settledOf,
  stepMarkHistory,
} from "./operations.ts";
import type { BindingWrites, WriteRun } from "./operations.ts";
import { mountReaderKeymap } from "./reader-keymap.ts";
import {
  current,
  ingestAnnotations,
  listenAnnotationEvents,
  makeReaderSurfaceModel,
  update,
} from "./reader-surface-model.ts";
import type {
  ReaderSurface,
  ReaderSurfaceRegistry,
} from "./reader-surface-model.ts";
import {
  ingestCapability,
  initialReaderSurfaceState,
  selectAdjust,
  selectCapture,
  selectMarkHandles,
  selectSelectedKey,
  selectTextDraft,
} from "./reader-surface-state.ts";
import type { Adjustment, ReaderSurfaceState } from "./reader-surface-state.ts";
import {
  groupAnnotationsByPage,
  interfaceFont,
  patchSelectedMark,
  renderAnnotationOverlay,
  renderCapture,
  renderLiveStroke,
  scrollMarkIntoView,
  withPosition,
} from "./render.ts";
import type { PdfPageAnnotation } from "./render.ts";
import { MarkSelection } from "./selection.ts";
import type { MarkGestures } from "./selection.ts";
import {
  createTextDraftArea,
  placeTextDraft,
  removeTextDraftArea,
} from "./text-draft.ts";
import { readerPageSource } from "./text-structure.ts";
import type { MarkTool, ToolColorStore } from "./tools.ts";

import { ReaderSessionHost } from "#core/reader-session/session.ts";
import { editingLive } from "#obsidian/annot-view/card-controls.ts";
import { createCommentRenderer } from "#obsidian/annot-view/comment-render.ts";
import { createDragInsertHandler } from "#obsidian/annot-view/drag-insert.ts";

const KEPT_MISSES = new Set<MarkLandingMiss>([
  "attachment-pending",
  "annotations-pending",
]);

const COUNTDOWN_INTERVAL = Temporal.Duration.from({ seconds: 1 });

export type AnnotationReads = Pick<
  AnnotationRepository["Service"],
  | "annotationState"
  | "annotationChanged"
  | "annotationsChanged"
  | "capability"
  | "capabilityChanges"
  | "capabilityFor"
  | "closeHistory"
  | "textDraftFor"
  | "createAnnotation"
  | "deleteAnnotation"
  | "deleteAnnotations"
  | "discardTextDraft"
  | "discardTagDraft"
  | "editTextField"
  | "editTags"
  | "hold"
  | "openHistory"
  | "patchColor"
  | "patchColors"
  | "patchGeometry"
  | "peek"
  | "probe"
  | "read"
  | "redo"
  | "refresh"
  | "retryTextDraft"
  | "submitTextField"
  | "submitTags"
  | "undo"
>;

export type AttachmentReads = Pick<
  AttachmentResolver["Service"],
  "resolve" | "resolutionsChanged"
>;

export interface CapabilityGestures {
  reportBlockedGesture: (attachmentKey: string) => void;
  allowEditing: () => void;
}

type CommentNotes = Pick<NoteIndex["Service"], "getNotesByItemKey">;

export interface PdfViewBindingDeps {
  view: View;
  file: TFile;
  reader: HostedReader;
  adapter: Pick<FileSystemAdapter, "getFullPath">;
  attachments: AttachmentReads;
  annotations: AnnotationReads;
  bridge: Pick<
    EffectBridge,
    "runSync" | "runPromise" | "runPromiseExit" | "runAndForget" | "subscribe"
  >;
  writes: BindingWrites;
  notifier: Notifier["Service"];
  capabilityGestures: CapabilityGestures;
  markGestures: Pick<MarkGestures, "blockedPress" | "revealAnnotation">;
  toolColors: ToolColorStore;
  noteIndex: CommentNotes;
  libraryTagNames: (annotationKey: string) => Promise<readonly string[]>;
  reads?: PdfReads;
  anchor?: ParsedAnnotationSubpath | null;
  openedAt?: Temporal.Instant | null;
  now?: () => Temporal.Instant;
  registry: ReaderSurfaceRegistry;
  inserts: InsertRunner<never>;
  sourceScope: () => string | null;
}

export class PdfViewBinding implements Disposable, HistorySurface, HoverParent {
  hoverPopover: HoverPopover | null = null;
  readonly #view;
  readonly #file;
  readonly #reader;
  readonly #adapter;
  readonly #attachments;
  readonly #annotations;
  readonly #bridge;
  readonly #writes;
  readonly #notifier;
  readonly #gestures;
  readonly #markGestures;
  readonly #toolColors;
  readonly #noteIndex;
  readonly #libraryTagNames;
  readonly #now;
  readonly #reads;
  readonly #openedAt;
  readonly #registry;
  readonly #dragOut: ReturnType<typeof createDragInsertHandler<never>>;
  readonly #session = new ReaderSessionHost({
    source: "obsidian-pdf",
    navigate: (annotationKey) => void this.#landOn(annotationKey),
    select: (annotationKeys) => {
      this.#landing = null;
      this.#landingAsk++;
      this.#cancelScroll();
      this.#selection?.selectMarks(annotationKeys);
    },
  });
  readonly #surfaces = new DisposableStack();
  readonly #painted = new Set<number>();
  #capturedOn: number | null = null;
  #strokeOn: number | null = null;
  #draftArea: HTMLTextAreaElement | null = null;
  #patchedOn: { key: string; pages: ReadonlySet<number> } | null = null;
  #attachment: AttachmentResolution = { kind: "pending" };
  #filePath: string | null = null;
  #absolutePath: string | null = null;
  #attached = false;
  #marks: ReadonlyMap<number, readonly PdfPageAnnotation[]> = new Map();
  #records: readonly AnnotationRecord[] = [];
  #source: AnnotationSource | null = null;
  #read = false;
  #selection: MarkSelection | null = null;
  #landing: MarkLandingTarget | null = null;
  #anchor: ParsedAnnotationSubpath | null;
  #landingFrame: number | null = null;
  #landingAsk = 0;
  #creation: MarkCreation | null = null;
  #popupHost: MarkPopupHost | null = null;
  #surface: ReaderSurface | null = null;
  #held: {
    document: ReaderDocument;
    structure: PdfTextStructure;
    idle: number;
    win: Window;
  } | null = null;
  readonly #textRotation: TextRotation = (pageIndex, rect) =>
    this.#held?.structure.textRotation(pageIndex, rect) ?? 0;
  #refreshing = Promise.resolve();
  #refreshSerial = 0;
  #drawCapability: (affordance: CapabilityAffordance | null) => void = () =>
    undefined;
  #capabilitySlot: HTMLElement | null = null;
  #toolbarMounted = false;
  #gesturing: WriteRun | null = null;
  readonly #presses = oneAtATime();
  #stepping: WriteRun | null = null;

  constructor({
    view,
    file,
    reader,
    adapter,
    attachments,
    annotations,
    bridge,
    writes,
    notifier,
    capabilityGestures,
    markGestures,
    toolColors,
    noteIndex,
    libraryTagNames,
    now = () => Temporal.Now.instant(),
    reads,
    openedAt = null,
    anchor = null,
    registry,
    inserts,
    sourceScope,
  }: PdfViewBindingDeps) {
    this.#view = view;
    this.#file = file;
    this.#anchor = anchor;
    this.#reader = reader;
    this.#adapter = adapter;
    this.#attachments = attachments;
    this.#annotations = annotations;
    this.#bridge = bridge;
    this.#writes = writes;
    this.#notifier = notifier;
    this.#gestures = capabilityGestures;
    this.#markGestures = markGestures;
    this.#toolColors = toolColors;
    this.#noteIndex = noteIndex;
    this.#libraryTagNames = libraryTagNames;
    this.#now = now;
    this.#reads = reads;
    this.#registry = registry;
    this.#openedAt = openedAt;
    this.#dragOut = createDragInsertHandler({
      ...inserts,
      app: view.app,
      notify: (message) => bridge.runAndForget(notifier.show(message)),
      snapshot: (annotation) => ({
        source: this.#records.some(({ key }) => key === annotation.key)
          ? this.#source
          : null,
        sourceScope: sourceScope(),
      }),
    });
  }

  #commentSourcePath(): string {
    if (this.#attachment.kind !== "resolved") return "";
    const { itemKey } = this.#attachment;
    if (itemKey === null) return "";
    return (
      this.#bridge.runSync(this.#noteIndex.getNotesByItemKey(itemKey))[0]
        ?.path ?? ""
    );
  }

  get filePath(): string | null {
    return this.#filePath;
  }

  get absolutePath(): string | null {
    return this.#absolutePath;
  }

  get attachment(): AttachmentResolution {
    return this.#attachment;
  }

  get historyAttachment(): string | null {
    return this.#attachment.kind === "resolved"
      ? this.#attachment.attachmentKey
      : null;
  }

  get session(): ReaderSession {
    return this.#session;
  }

  borrow(): BorrowedExcerptDocument | null {
    return borrowReaderDocument(
      this.#reader.document.get(),
      this.#absolutePath,
    );
  }

  async sortIndex(position: PdfPosition): Promise<string | null> {
    const structure = this.#structure();
    return structure ? await structure.sortIndex(position) : null;
  }

  async adjustRange(adjustment: RangeAdjustment): Promise<SelectedText | null> {
    const structure = this.#structure();
    return structure ? await structure.adjustRange(adjustment) : null;
  }

  get refreshed(): Promise<void> {
    return this.#refreshing;
  }

  get gestured(): Promise<void> {
    return settledOf(this.#bridge, this.#gesturing);
  }

  get stepped(): Promise<void> {
    return settledOf(this.#bridge, this.#stepping);
  }

  get settled(): Promise<void> {
    return this.#creation?.settled ?? Promise.resolve();
  }

  placePopup(): void {
    this.#popupHost?.sync();
  }

  activate(): void {
    if (this.#attachment.kind === "resolved") {
      this.#bridge.runAndForget(
        this.#annotations.refresh(this.#attachment.attachmentKey),
      );
    }
  }

  aim(anchor: ParsedAnnotationSubpath | null): void {
    this.#anchor = anchor;
  }

  land(): void {
    void this.refreshed.then(() => this.#land());
  }

  load(): void {
    const file = this.#file;
    this.#filePath = file.path;
    const absolutePath = absolutePathOf(file, this.#adapter);
    this.#absolutePath = absolutePath;
    this.#surfaces.defer(() => this.#cancelScroll());
    this.#surfaces.defer(
      this.#bridge.subscribe(this.#attachments.resolutionsChanged, () =>
        this.#resolve(absolutePath),
      ),
    );
    this.#resolve(absolutePath);
  }

  close(): void {
    if (this.#attachment.kind === "resolved")
      this.#reads?.record(this.#attachment, "close");
  }

  [Symbol.dispose](): void {
    this.#session[Symbol.dispose]();
    this.#surfaces.dispose();
    this.#dragOut.cancel();
  }

  get renamed(): boolean {
    if (this.#attachment.kind !== "resolved" || this.#absolutePath === null)
      return false;
    const named = this.#anchor?.attachment ?? null;
    if (named === null || named === this.#attachment.attachmentKey)
      return false;
    const resolution = this.#bridge.runSync(
      this.#attachments.resolve(this.#absolutePath, { attachmentKey: named }),
    );
    return (
      resolution.kind === "resolved" &&
      resolution.attachmentKey !== this.#attachment.attachmentKey
    );
  }

  #resolve(absolutePath: string): void {
    if (this.#surfaces.disposed || this.#attachment.kind !== "pending") return;
    this.#attachment = this.#bridge.runSync(
      this.#attachments.resolve(absolutePath, {
        attachmentKey: this.#anchor?.attachment ?? null,
      }),
    );
    this.#bridge.runSync(
      Effect.logDebug("PDF view resolved").pipe(
        Effect.annotateLogs({
          path: this.#filePath,
          attachment: this.#attachment,
        }),
        withLogCategory("pdf-annotation-editor"),
      ),
    );
    if (this.#attachment.kind === "resolved" && this.#openedAt)
      this.#reads?.record(this.#attachment, "open", this.#openedAt);
    this.#session.setTarget(
      this.#attachment.kind === "resolved"
        ? {
            attachmentKey: this.#attachment.attachmentKey,
            itemKey: this.#attachment.itemKey,
          }
        : null,
    );
    if (this.#attachment.kind !== "resolved") {
      this.land();
      return;
    }
    const { attachmentKey } = this.#attachment;
    this.#surfaces.use(
      this.#bridge.runSync(this.#annotations.hold([attachmentKey])),
    );
    this.#bridge.runSync(this.#annotations.openHistory(attachmentKey));
    this.#surfaces.defer(() =>
      this.#bridge.runSync(this.#annotations.closeHistory(attachmentKey)),
    );
    this.#mountSelection(attachmentKey);
    this.#mountToolbar();
    this.#surfaces.defer(
      this.#bridge.subscribe(
        this.#annotations.annotationsChanged,
        (changedKey) => {
          if (changedKey !== attachmentKey) return;
          const held = this.#read
            ? this.#bridge.runSync(this.#annotations.peek(attachmentKey))
            : null;
          if (held) this.#draw(held.value);
          this.#refresh();
        },
      ),
    );
    this.#surfaces.use(
      registerDomEvent(this.#view.containerEl, "focusin", (event) => {
        if (event.target === this.#draftArea) return;
        this.#bridge.runAndForget(this.#annotations.refresh(attachmentKey));
      }),
    );
    this.#surfaces.use(
      registerMigratingWindowEvent(this.#view.containerEl, "focus", () => {
        this.#bridge.runAndForget(this.#annotations.refresh(attachmentKey));
      }),
    );
    this.#surfaces.defer(() => this.#unpaint());
    this.#refresh();
  }

  #navigate(annotationKey: string): void {
    const pageIndex = pageOfMark(this.#marks, annotationKey);
    if (pageIndex === null || !this.#attached) {
      this.#bridge.runSync(
        Effect.logDebug("No page holds this annotation").pipe(
          Effect.annotateLogs({
            path: this.filePath,
            annotationKey,
          }),
          withLogCategory("pdf-annotation-editor"),
        ),
      );
      return;
    }
    void this.#reader.navigate({ pageIndex });
  }

  attachDocument(): void {
    if (this.#surfaces.disposed || this.#attached) return;
    this.#attached = true;
    const reader = this.#reader;
    this.#surfaces.defer(() => this.#closeStructure());
    this.#structure();
    this.#mountToolbar();
    this.#surfaces.defer(
      reader.on("page-rendered", ({ page }) => {
        this.#structure();
        this.#paint(page.pageIndex);
        if (this.#landing?.pageIndex === page.pageIndex) this.#applyLanding();
        this.#popupHost?.sync();
      }),
    );
    this.#surfaces.defer(
      reader.on("page-change", ({ cause }) => {
        if (cause !== "restore" && this.#attachment.kind === "resolved")
          this.#reads?.record(this.#attachment, "page");
      }),
    );
    this.#repaint();
    this.land();
  }

  #mountToolbar(): void {
    const creation = this.#creation;
    const surface = this.#surface;
    if (this.#toolbarMounted || !creation || !surface) return;
    const { registry, model } = surface;
    if (!this.#attached) return;
    const slot = this.#reader.slot("toolbar-end");
    this.#toolbarMounted = true;
    let ticking: number | null = null;
    const stopTicking = (): void => {
      if (ticking === null) return;
      slot.win.clearInterval(ticking);
      ticking = null;
    };

    this.#drawCapability = (affordance) => {
      const capabilitySlot = this.#capabilitySlot;
      if (this.#surfaces.disposed || !capabilitySlot) return;
      renderCapabilityAffordance(capabilitySlot, affordance);
    };
    const runClock = (capability: EditingCapability): void => {
      if (capability.kind === "cooldown") {
        ticking ??= slot.win.setInterval(
          () => this.#ingestCapability(),
          COUNTDOWN_INTERVAL.total("milliseconds"),
        );
      } else stopTicking();
    };

    this.#surfaces.defer(() => {
      stopTicking();
      this.#drawCapability = () => undefined;
      if (this.#capabilitySlot)
        removeCapabilityAffordance(this.#capabilitySlot);
      this.#capabilitySlot = null;
    });
    this.#surfaces.defer(
      watch(registry, model.capabilityAffordance, (affordance) =>
        this.#drawCapability(affordance),
      ),
    );
    runClock(registry.get(model.capability));
    this.#surfaces.defer(watch(registry, model.capability, runClock));
    this.#surfaces.use(
      registerDomEvent(this.#view.containerEl, "keydown", (event) => {
        if (isEditGesture(event)) this.#editGesture();
      }),
    );
    creation.mountToolbar(slot);
  }

  #mountSelection(attachmentKey: string): void {
    if (this.#selection) return;
    const registry = this.#registry;
    const model = makeReaderSurfaceModel(
      initialReaderSurfaceState({
        colors: this.#toolColors.current(),
        recentColors: this.#toolColors.recent(),
        capability: this.#capability(),
        now: this.#now(),
      }),
    );
    const surface: ReaderSurface = { registry, model };
    this.#surface = surface;
    this.#surfaces.defer(
      this.#bridge.subscribe(this.#annotations.capabilityChanges, () =>
        this.#ingestCapability(),
      ),
    );
    this.#surfaces.use(
      listenAnnotationEvents(surface, this.#annotations, this.#bridge),
    );
    const popup = {
      contains: (node: Node | null) => host.contains(node),
      sync: () => host.sync(),
    };
    const creation = new MarkCreation({
      app: this.#view.app,
      containerEl: this.#view.containerEl,
      popup,
      attachmentKey,
      pages: () => this.#pages(),
      records: () => this.#records,
      structure: () => this.#structure(),
      repaint: () => this.#repaint(),
      reveal: (annotationKey, { commenting } = {}) => {
        void this.refreshed.then(() =>
          this.#selection?.select(annotationKey, { commenting }),
        );
      },
      reportBlockedGesture: () => this.#editGesture(),
      reportCreateFailure: (reason) =>
        this.#bridge.runAndForget(
          this.#notifier.show(m.pdf_create_failed({ reason })),
        ),
      renderCapability: (slot) => {
        this.#capabilitySlot = slot;
        this.#drawCapability(registry.get(model.capabilityAffordance));
      },
      focusReader: () => {
        this.#view.app.workspace.setActiveLeaf(this.#view.leaf, {
          focus: true,
        });
        this.#reader.focus();
      },
      colors: this.#toolColors,
      surface,
      annotations: this.#annotations,
      bridge: this.#bridge,
      writes: this.#writes,
      now: this.#now,
    });
    this.#creation = creation;
    const selection = new MarkSelection({
      app: this.#view.app,
      renderComment: createCommentRenderer({
        app: this.#view.app,
        component: this.#view,
        getSourcePath: () => this.#commentSourcePath(),
      }),
      libraryTagNames: this.#libraryTagNames,
      containerEl: this.#view.containerEl,
      popup,
      selectionSurfaces: this.#session,
      marks: () => this.#visibleMarks(),
      records: () => this.#records,
      pageAt: (pageIndex) => this.#pageAt(pageIndex),
      repaint: () => this.#repaint(),
      navigate: (annotationKey) => this.#navigate(annotationKey),
      report: (annotationKeys) => this.#session.reportSelection(annotationKeys),
      annotations: this.#annotations,
      bridge: this.#bridge,
      writes: this.#writes,
      notifier: this.#notifier,
      colors: this.#toolColors,
      surface,
      gestures: {
        revealAnnotation: (annotationKey) =>
          this.#markGestures.revealAnnotation(annotationKey),
        blockedPress: (block) => this.#markGestures.blockedPress(block),
        reportBlockedGesture: () => this.#editGesture(),
        allowEditing: () => this.#gestures.allowEditing(),
      },
      creation,
      sortIndex: (position) => this.sortIndex(position),
      adjustRange: (adjustment) => this.adjustRange(adjustment),
      textRotation: this.#textRotation,
      now: this.#now,
      dragOut: this.#dragOut,
    });
    this.#selection = selection;
    this.#surfaces.defer(
      mountReaderKeymap(
        this.#view,
        {
          escape: () => selection.escape() || creation.escape(),
          undo: () => this.stepHistory("undo"),
          redo: () => this.stepHistory("redo"),
          copy: () => selection.copy(),
        },
        { isMacOS: Platform.isMacOS },
      ),
    );
    this.#surfaces.defer(
      watch(registry, model.adjust, (adjust) => {
        this.#patchSelected();
        this.#showAdjusting(adjust);
      }),
    );
    this.#surfaces.defer(() => this.#showAdjusting(null));
    this.#surfaces.defer(
      watch(registry, model.selectedKey, (key) => this.#readRangeText(key)),
    );
    this.#surfaces.defer(
      watch(registry, model.capture, () => this.#drawCapture()),
    );
    this.#surfaces.defer(
      watch(registry, model.textDraft, () => this.#drawTextDraft()),
    );
    this.#surfaces.defer(() => this.#dropTextDraftArea());
    this.#surfaces.defer(
      watch(registry, model.liveStroke, () => this.#drawLiveStroke()),
    );
    this.#surfaces.defer(
      watch(registry, model.drawing, (drawing) => this.#showDrawing(drawing)),
    );
    this.#surfaces.defer(() => this.#showDrawing(false));
    this.#surfaces.defer(
      watch(registry, model.pendingStrokes, (pending, before) => {
        const pages = new Set(
          [...pending, ...before].map(({ pageIndex }) => pageIndex),
        );
        for (const pageIndex of pages) this.#paint(pageIndex);
      }),
    );
    this.#showArmed(registry.get(model.armed));
    this.#surfaces.defer(
      watch(registry, model.armed, (armed) => this.#showArmed(armed)),
    );
    this.#surfaces.defer(() => this.#showArmed(null));
    this.#surfaces.defer(
      watch(registry, model.editingLive, () => this.#repaint()),
    );
    selection.load();
    const host = new MarkPopupHost({
      parent: this,
      doc: () => this.#view.containerEl.doc,
      surface,
      shown: () => this.#view.containerEl.isShown(),
      variants: {
        selected: {
          anchor: () => selection.anchor(),
          render: (content) => selection.popupView(content),
        },
        create: {
          anchor: () => creation.anchor(),
          render: () => creation.popupView(),
          unanchored: () => creation.unanchored(),
        },
      },
    });
    this.#popupHost = host;
    this.#surfaces.defer(() => {
      this.#selection = null;
      this.#creation = null;
      this.#popupHost = null;
      this.#surface = null;
      selection[Symbol.dispose]();
      creation[Symbol.dispose]();
      host[Symbol.dispose]();
    });
  }

  #structure(): PdfTextStructure | null {
    const document_ = this.#attached ? this.#reader.document.get() : null;
    if (!document_?.current()) return null;
    if (this.#held?.document === document_) return this.#held.structure;
    this.#closeStructure();
    const structure = new PdfTextStructure(readerPageSource(document_));
    const win = this.#view.containerEl.win;
    const idle = win.requestIdleCallback(() => {
      void structure.pageLabels().catch((error: unknown) => {
        this.#bridge.runSync(
          Effect.logWarning("The PDF page label pass did not finish").pipe(
            Effect.annotateLogs({
              error,
              path: this.filePath,
            }),
            withLogCategory("pdf-annotation-editor"),
          ),
        );
      });
    });
    this.#held = { document: document_, structure, idle, win };
    return structure;
  }

  #closeStructure(): void {
    const held = this.#held;
    if (!held) return;
    held.win.cancelIdleCallback(held.idle);
    held.structure.close();
    this.#held = null;
  }

  #pages(): ReaderPage[] {
    if (!this.#attached) return [];
    return this.#reader
      .renderedPages()
      .map((page) => ({ pageIndex: page.pageIndex, view: page }));
  }

  #pageAt(pageIndex: number) {
    return this.#attached ? this.#reader.pageAt(pageIndex) : null;
  }

  #state(): ReaderSurfaceState | undefined {
    return this.#surface ? current(this.#surface) : undefined;
  }

  #visibleMarks(): ReadonlyMap<number, readonly PdfPageAnnotation[]> {
    const state = this.#state();
    if (state?.marksVisible === false) return new Map();
    const key = state ? selectSelectedKey(state) : null;
    const adjust = state ? selectAdjust(state) : null;
    return key !== null && adjust
      ? withPosition(this.#marks, key, adjust.proposal)
      : this.#marks;
  }

  #handles(): boolean {
    const state = this.#state();
    return state !== undefined && selectMarkHandles(state);
  }

  #patchSelected(): void {
    const state = this.#state();
    const key = state ? selectSelectedKey(state) : null;
    if (!this.#attached || key === null) return;
    const drawn = new Set<number>();
    for (const [pageIndex, placements] of this.#visibleMarks()) {
      const placement = placements.find(
        ({ annotation }) => annotation.key === key,
      );
      if (placement) drawn.add(pageIndex);
      const page = placement && this.#pageAt(pageIndex);
      if (!page) continue;
      if (
        !patchSelectedMark(page, placement, {
          handles: this.#handles(),
          textRotation: this.#textRotation,
          font: interfaceFont(page.div.win),
        })
      )
        this.#paint(pageIndex);
    }
    const before =
      this.#patchedOn?.key === key
        ? this.#patchedOn.pages
        : pagesDrawing(this.#marks, key);
    for (const pageIndex of before.difference(drawn)) this.#paint(pageIndex);
    this.#patchedOn = { key, pages: drawn };
  }

  #drawCapture(): void {
    const state = this.#state();
    const capture = state ? selectCapture(state) : null;
    const held = this.#capturedOn;
    this.#capturedOn = capture?.pageIndex ?? null;
    if (!this.#attached) return;
    if (held !== null && held !== capture?.pageIndex) {
      const page = this.#pageAt(held);
      if (page) renderCapture(page, null);
    }
    if (!capture || !state) return;
    const page = this.#pageAt(capture.pageIndex);
    if (page)
      renderCapture(page, { rect: capture.rect, color: state.colors.image });
  }

  #drawTextDraft(): void {
    const creation = this.#creation;
    const state = this.#state();
    const draft = state ? selectTextDraft(state) : null;
    if (!draft || !this.#attached || !creation) {
      this.#dropTextDraftArea();
      return;
    }
    const page = this.#pageAt(draft.pageIndex);
    if (!page) return;
    const area = (this.#draftArea ??= createTextDraftArea(
      page.div.doc,
      {
        input: (text) => creation.typeDraft(text),
        finish: () => creation.finishDraft(),
      },
      {
        scope: this.#view.scope ?? this.#view.app.scope,
        keymap: this.#view.app.keymap,
      },
    ));
    placeTextDraft(area, page, {
      draft,
      font: interfaceFont(page.div.win),
    });
    if (area.parentElement === page.div) return;
    page.div.append(area);
    if (draft.phase === "typing") area.focus({ preventScroll: true });
  }

  #dropTextDraftArea(): void {
    if (this.#draftArea) removeTextDraftArea(this.#draftArea);
    this.#draftArea = null;
  }

  #drawLiveStroke(): void {
    const stroke = this.#state()?.liveStroke ?? null;
    const held = this.#strokeOn;
    this.#strokeOn = stroke?.pageIndex ?? null;
    if (!this.#attached) return;
    if (held !== null && held !== stroke?.pageIndex) {
      const page = this.#pageAt(held);
      if (page) renderLiveStroke(page, null);
    }
    if (!stroke) return;
    const page = this.#pageAt(stroke.pageIndex);
    if (page) renderLiveStroke(page, stroke);
  }

  #showArmed(armed: MarkTool | null): void {
    const { containerEl } = this.#view;
    containerEl.toggleAttribute(themeAttribute.pdfInking, armed === "ink");
    if (armed) containerEl.dataset.ztArmed = armed;
    else delete containerEl.dataset.ztArmed;
  }

  #showDrawing(drawing: boolean): void {
    this.#view.containerEl.toggleAttribute("data-zt-drawing", drawing);
  }

  #showAdjusting(adjust: Adjustment | null): void {
    const moving =
      adjust?.phase === "dragging" && isRangeGrip(adjust.grip) ? "text" : null;
    if (moving) this.#view.containerEl.dataset.ztAdjusting = moving;
    else delete this.#view.containerEl.dataset.ztAdjusting;
  }

  #ingestCapability(): void {
    const surface = this.#surface;
    if (surface)
      update(surface, ingestCapability(this.#capability(), this.#now()));
  }

  #capability(): EditingCapability {
    return this.#attachment.kind === "resolved"
      ? this.#bridge.runSync(
          this.#annotations.capabilityFor(this.#attachment.attachmentKey),
        )
      : this.#bridge.runSync(this.#annotations.capability);
  }

  #editGesture(): void {
    if (editingLive(this.#capability())) return;
    this.#gesturing = this.#writes(
      reportBlockedEdit(this.#annotations, () => {
        if (this.#attachment.kind !== "resolved") return;
        this.#gestures.reportBlockedGesture(this.#attachment.attachmentKey);
      }),
    );
  }

  stepHistory(direction: HistoryDirection): void {
    if (this.#attachment.kind !== "resolved") return;
    const { attachmentKey } = this.#attachment;
    this.#stepping = this.#writes(
      pressHistory(
        this.#presses,
        stepMarkHistory(this.#annotations, this.#notifier, {
          attachmentKey,
          direction,
          now: () => this.#now(),
        }),
        (outcome) => {
          switch (outcome.kind) {
            case "stepped":
              return this.#landOn(outcome.annotationKey);
            case "removed":
              return this.#landOnPage(outcome.pageIndex);
            case "blocked":
              this.#editGesture();
              return;
            case "changed":
            case "failed":
            case "locked":
            case "idle":
              return;
          }
        },
      ),
    );
  }

  #landOn(annotationKey: string): Promise<void> {
    const ask = this.#landingAsk;
    return this.refreshed.then(() => {
      if (this.#surfaces.disposed || ask !== this.#landingAsk) return;
      const pageIndex = pageOfMark(this.#marks, annotationKey);
      if (pageIndex === null || !this.#attached) {
        this.#bridge.runSync(
          Effect.logDebug("No page holds this annotation").pipe(
            Effect.annotateLogs({
              path: this.filePath,
              annotationKey,
            }),
            withLogCategory("pdf-annotation-editor"),
          ),
        );
        return;
      }
      this.#landing = { annotationKey, pageIndex };
      if (this.#rendered().has(pageIndex)) {
        this.#applyLanding();
        return;
      }
      void this.#reader.navigate({ pageIndex });
    });
  }

  #landOnPage(pageIndex: number): Promise<void> {
    return this.refreshed.then(() => {
      if (this.#surfaces.disposed) return;
      this.#landing = null;
      this.#selection?.select(null, { popup: false });
      if (this.#attached) void this.#reader.navigate({ pageIndex });
    });
  }

  #land(): void {
    if (this.#surfaces.disposed) return;
    const anchor = this.#anchor;
    if (!anchor || !this.#attached) return;

    const landing = decideMarkLanding({
      anchor,
      attachment: this.#attachment,
      read: this.#read,
      records: this.#records,
      marks: this.#marks,
      rendered: this.#rendered(),
    });
    if (landing.kind === "drop") return;
    if (landing.kind === "page") {
      this.#bridge.runSync(
        Effect.logDebug("An Annotation Anchor did not reach its Mark").pipe(
          Effect.annotateLogs({
            path: this.filePath,
            annotationKey: anchor.annotation,
            reason: landing.reason,
          }),
          withLogCategory("pdf-annotation-editor"),
        ),
      );
      if (!KEPT_MISSES.has(landing.reason)) this.#anchor = null;
      return;
    }

    this.#anchor = null;
    this.#landing = {
      annotationKey: landing.annotationKey,
      pageIndex: landing.pageIndex,
    };
    this.#bridge.runSync(
      Effect.logDebug("An Annotation Anchor reached its Mark").pipe(
        Effect.annotateLogs({
          path: this.filePath,
          annotationKey: landing.annotationKey,
          page: landing.pageIndex + 1,
          rendered: landing.kind === "select",
        }),
        withLogCategory("pdf-annotation-editor"),
      ),
    );
    if (landing.kind === "wait")
      void this.#reader.navigate({ pageIndex: landing.pageIndex });
    else this.#applyLanding();
  }

  #applyLanding(): void {
    const landing = this.#landing;
    if (!landing) return;
    this.#landing = null;
    const selected = this.#selection?.selected;
    if (!(selected && selected.size > 1 && selected.has(landing.annotationKey)))
      this.#selection?.select(landing.annotationKey, { popup: false });
    this.#scrollToMark(landing);
  }

  #scrollToMark(target: MarkLandingTarget): void {
    const win = this.#view.containerEl.win;
    this.#cancelScroll();
    this.#landingFrame = win.requestAnimationFrame(() => {
      this.#landingFrame = null;
      const page = this.#pageAt(target.pageIndex);
      if (page) scrollMarkIntoView(page, target.annotationKey);
    });
  }

  #cancelScroll(): void {
    if (this.#landingFrame === null) return;
    this.#view.containerEl.win.cancelAnimationFrame(this.#landingFrame);
    this.#landingFrame = null;
  }

  #refresh(): void {
    if (this.#attachment.kind !== "resolved") return;
    const { attachmentKey } = this.#attachment;
    const serial = ++this.#refreshSerial;
    const path = this.filePath;
    this.#refreshing = this.#bridge
      .runPromiseExit(readMarks(this.#annotations, attachmentKey, path))
      .then((exit) => {
        if (exit._tag === "Failure") return;
        const list = exit.value;
        if (this.#surfaces.disposed || serial !== this.#refreshSerial) return;
        if (list === null) {
          this.#bridge.runSync(
            Effect.logDebug(
              "No annotation list stands for this attachment yet",
            ).pipe(
              Effect.annotateLogs({
                path: this.filePath,
                attachmentKey,
              }),
              withLogCategory("pdf-annotation-editor"),
            ),
          );
          this.#land();
          return;
        }
        this.#read = true;
        this.#draw(list);
      })
      .catch((error: unknown) => {
        this.#bridge.runSync(
          Effect.logWarning(
            "Failed to draw the annotations of an open PDF",
          ).pipe(
            Effect.annotateLogs({
              error,
              path,
              attachmentKey,
            }),
            withLogCategory("pdf-annotation-editor"),
          ),
        );
      });
  }

  #draw(list: AnnotationList): void {
    this.#records = list.annotations;
    this.#source = list.source;
    this.#marks = groupAnnotationsByPage(list.annotations);
    if (this.#surface)
      ingestAnnotations(this.#surface, list.annotations, {
        annotations: this.#annotations,
        bridge: this.#bridge,
      });
    this.#bridge.runSync(
      Effect.logDebug("Annotation marks rebuilt for a PDF view").pipe(
        Effect.annotateLogs({
          path: this.filePath,
          source: list.source.kind,
          annotations: list.annotations.length,
          pages: this.#marks.size,
        }),
        withLogCategory("pdf-annotation-editor"),
      ),
    );
    this.#repaint();
    this.#popupHost?.sync();
    this.#land();
  }

  #readRangeText(key: string | null): void {
    const record = this.#records.find((held) => held.key === key);
    const handles = record ? rangeHandles(record, 0, this.#textRotation) : [];
    const structure = handles.length > 0 ? this.#structure() : null;
    if (
      !structure ||
      handles.every(
        ({ pageIndex, rect }) =>
          structure.textRotation(pageIndex, rect) !== null,
      )
    )
      return;
    void Promise.all(
      handles.map(({ pageIndex }) => structure.page(pageIndex)),
    ).then(
      () => this.#patchSelected(),
      (error: unknown) => {
        this.#bridge.runSync(
          Effect.logDebug(
            "Could not read the text under a range's handles",
          ).pipe(
            Effect.annotateLogs({
              error,
              annotationKey: key,
            }),
            withLogCategory("pdf-annotation-editor"),
          ),
        );
      },
    );
  }

  #repaint(): void {
    for (const pageIndex of this.#painted.union(new Set(this.#marks.keys()))) {
      this.#paint(pageIndex);
    }
  }

  #paint(pageIndex: number): void {
    const page = this.#pageAt(pageIndex);
    if (!page) return;
    const annotations = this.#visibleMarks().get(pageIndex) ?? [];
    const pending = (this.#state()?.pendingStrokes ?? []).filter(
      (stroke) => stroke.pageIndex === pageIndex,
    );
    renderAnnotationOverlay(page, {
      annotations,
      pending,
      selected: this.#selection?.selected,
      handles: this.#handles(),
      textRotation: this.#textRotation,
      font: interfaceFont(page.div.win),
    });
    if (this.#capturedOn === pageIndex) this.#drawCapture();
    if (this.#strokeOn === pageIndex) this.#drawLiveStroke();
    if (
      this.#surface &&
      selectTextDraft(current(this.#surface))?.pageIndex === pageIndex
    )
      this.#drawTextDraft();
    if (annotations.length > 0 || pending.length > 0)
      this.#painted.add(pageIndex);
    else this.#painted.delete(pageIndex);
  }

  #unpaint(): void {
    this.#landing = null;
    this.#marks = new Map();
    this.#records = [];
    this.#source = null;
    this.#repaint();
    this.#attached = false;
  }

  #rendered(): Set<number> {
    return new Set(this.#reader.renderedPages().map((page) => page.pageIndex));
  }
}

function pageOfMark(
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>,
  key: string,
): number | null {
  for (const [pageIndex, placements] of marks) {
    if (placements.some(({ annotation }) => annotation.key === key))
      return pageIndex;
  }
  return null;
}

function pagesDrawing(
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>,
  key: string,
): Set<number> {
  const pages = new Set<number>();
  for (const [pageIndex, placements] of marks) {
    if (placements.some(({ annotation }) => annotation.key === key))
      pages.add(pageIndex);
  }
  return pages;
}

function absolutePathOf(
  file: { path: string },
  adapter: Pick<FileSystemAdapter, "getFullPath">,
): string {
  return file instanceof TExternalFile
    ? file.getRealPath()
    : adapter.getFullPath(file.path);
}
