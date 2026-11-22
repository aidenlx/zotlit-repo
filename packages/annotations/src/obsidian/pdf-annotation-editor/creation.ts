import type {
  EditorSheet,
  EditorSheetStatus,
} from "#obsidian/annot-view/editor-sheet.ts";
import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type {
  AnnotationRecord,
  AnnotationRepository,
} from "#obsidian/annotation-repository/service.ts";
import type {
  InkPosition,
  TextPosition,
} from "#obsidian/annotation-repository/write.ts";
import { Effect } from "effect";
import { Platform } from "obsidian";
import type { App } from "obsidian";
import { createElement } from "react";
import type { ReactNode, RefObject } from "react";

import { registerDomEvent } from "@zotlit/obsidian-kit/disposables.ts";
import { raiseMenu } from "@zotlit/obsidian-kit/menu-events.ts";
import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import * as toast from "@zotlit/obsidian-kit/toast.ts";
import { watch } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { PdfTextStructure, SelectedText } from "@zotlit/pdf-structure";
import { ANNOTATION_COLORS } from "@zotlit/plugin-kernel/annotation-colors.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import {
  withLogCategory,
  logLevelEnabled,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { inTextEntry, isEditGesture } from "./capability-affordance.ts";
import { annotationColorMenu } from "./color-menu.ts";
import { CreateMarkPopup, createPopupRow } from "./create-popup.tsx";
import type { CreatePopupAction } from "./create-popup.tsx";
import {
  removeCreationToolbar,
  renderCreationToolbar,
} from "./creation-toolbar.ts";
import type {
  CreationToolbarControl,
  CreationToolbarNodes,
} from "./creation-toolbar.ts";
import { captureRect } from "./geometry-edit.ts";
import type { PdfPoint, PdfRect } from "./geometry-edit.ts";
import { CLICK_SLOP, distance } from "./hit-test.ts";
import type { Point } from "./hit-test.ts";
import { InkStroke } from "./ink-stroke.ts";
import type { MarkPopupHost } from "./mark-popup-host.ts";
import {
  createMark,
  oneAtATime,
  placeSelection,
  queued,
  settledOf,
} from "./operations.ts";
import type { BindingWrites, CreateWrite, WriteRun } from "./operations.ts";
import {
  current,
  modify,
  recordColorUse,
  setToolColor,
  update,
} from "./reader-surface-model.ts";
import type { ReaderSurface } from "./reader-surface-model.ts";
import {
  appendPendingStroke,
  arm,
  beginCapture,
  cancelCapture,
  captureSelection,
  clearFloating,
  dropPendingStroke,
  dropTextDraft,
  endCapture,
  finishTextDraft,
  moveCapture,
  openTextDraft,
  refitTextDraft,
  selectCapture,
  selectCreateRowInput,
  setCommenting,
  setInFlight,
  selectTextDraft,
  settlePendingStroke,
  settleTextDraft,
  textDraftPosition,
  toggleMarks,
} from "./reader-surface-state.ts";
import type {
  AnchorAt,
  Floating,
  PendingStroke,
  ReaderSurfaceState,
  TextDraft,
} from "./reader-surface-state.ts";
import { interfaceFont } from "./render.ts";
import type { OverlayPageView } from "./render.ts";
import { selectionPagesOf } from "./selection-capture.ts";
import type { SelectionPage } from "./selection-capture.ts";
import type { SelectOptions } from "./selection.ts";
import {
  addInkWidths,
  addTextFontSizes,
  colorMenu,
  onScreen,
  pageContentBox,
  pdfPointAt,
  selectionCollapsed,
  releaseCapture,
} from "./surface.ts";
import {
  MARK_TOOLS,
  gestureOf,
  isClickTool,
  isSelectionTool,
  selectionToolOf,
} from "./tools.ts";
import type {
  ClickTool,
  MarkTool,
  SelectionTool,
  ToolColorStore,
} from "./tools.ts";

import {
  capabilityBlock,
  fieldEditorControls,
  editingLive,
  textFieldWording,
} from "#obsidian/annot-view/card-controls.ts";
import { blockedReason } from "#obsidian/annotation-repository/write.ts";

const NOTE_SIZE = 22;

let inkGroupSerial = 0;

function nextInkGroup(): string {
  inkGroupSerial += 1;
  return `ink-${inkGroupSerial}`;
}

interface ClickPress {
  pointerId: number;
  tool: ClickTool;
  pageIndex: number;
  at: PdfPoint;
  client: Point;
}

export interface ReaderPage {
  pageIndex: number;
  view: OverlayPageView;
}

export type AnnotationCreates = Pick<
  AnnotationRepository["Service"],
  "createAnnotation" | "hold"
>;

export interface CreationGestures {
  press: (event: PointerEvent) => void;
  settle: () => void;
  changed: () => void;
  key: (event: KeyboardEvent) => void;
  grab: (event: PointerEvent, options: { onMark: () => boolean }) => void;
  move: (event: PointerEvent) => void;
  release: (event: PointerEvent) => void;
  cancel: (event: PointerEvent) => void;
  readonly capturing: boolean;
}

interface MarkDraft {
  type: MarkTool;
  color: string;
  comment: string;
  text: string;
  position:
    | {
        pageIndex: number;
        rects: SelectedText["rects"];
        nextPageRects?: SelectedText["rects"];
      }
    | InkPosition
    | (TextPosition & { rects: SelectedText["rects"] });
}

interface CreateOptions extends Pick<SelectOptions, "commenting"> {
  structure?: PdfTextStructure | null;
  group?: string;
  uninterruptible?: boolean;
  settle?: (annotationKey: string | null) => void;
}

const CREATE_EFFECTS: Record<
  MarkTool,
  { foreground: boolean; disarm: boolean }
> = {
  highlight: { foreground: true, disarm: false },
  underline: { foreground: true, disarm: false },
  note: { foreground: true, disarm: true },
  text: { foreground: true, disarm: false },
  image: { foreground: true, disarm: true },
  ink: { foreground: false, disarm: false },
};

export interface MarkCreationDeps {
  app: App;
  containerEl: HTMLElement;
  popup: Pick<MarkPopupHost, "contains">;
  attachmentKey: string;
  pages: () => readonly ReaderPage[];
  records: () => readonly AnnotationRecord[];
  structure: () => PdfTextStructure | null;
  repaint: () => void;
  reveal: (
    annotationKey: string,
    options?: Pick<SelectOptions, "commenting">,
  ) => void;
  reportBlockedGesture: () => void;
  reportCreateFailure: (reason: string) => void;
  renderCapability: (slot: HTMLElement) => void;
  focusReader: () => void;
  colors: ToolColorStore;
  surface: ReaderSurface;
  annotations: AnnotationCreates;
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  writes: BindingWrites;
  now: () => Temporal.Instant;
}

export class MarkCreation implements CreationGestures, Disposable {
  readonly #deps;
  readonly #surfaces = new DisposableStack();
  readonly #sheet: RefObject<EditorSheet | null> = { current: null };
  #writing = false;
  #creating: WriteRun | null = null;
  #settling: WriteRun | null = null;
  #gesture = 0;
  #pressedOnPage = false;
  #draftStructure: PdfTextStructure | null = null;
  #clickPress: ClickPress | null = null;
  #capturing: { pointerId: number; page: ReaderPage } | null = null;
  #stroke: InkStroke | null = null;
  #pinching: number | null = null;
  readonly #inking = oneAtATime();
  #strokeSerial = 0;
  #inkGroup: string | null = null;

  constructor(deps: MarkCreationDeps) {
    this.#deps = deps;
    this.#surfaces.defer(
      watch(
        deps.surface.registry,
        deps.surface.model.floatingHead,
        ({ kind, commenting }) => {
          if (kind !== "create" || !commenting) this.#dropSheet();
        },
      ),
    );
    this.#surfaces.defer(
      watch(deps.surface.registry, deps.surface.model.armed, (armed) => {
        if (armed !== "ink") this.#discardStroke();
        this.#dropClickPress();
        if (armed !== null) this.finishDraft();
      }),
    );
  }

  get created(): Promise<void> {
    return settledOf(this.#deps.bridge, this.#creating);
  }

  get settled(): Promise<void> {
    return settledOf(this.#deps.bridge, this.#settling);
  }

  mountToolbar(slot: HTMLElement): CreationToolbarNodes {
    this.#surfaces.defer(() => removeCreationToolbar(slot));
    const { registry, model } = this.#deps.surface;
    const draw = (controls: readonly CreationToolbarControl[]) =>
      renderCreationToolbar(slot, controls, (id, node) =>
        this.#toolbarActivate(id, node),
      );
    const nodes = draw(registry.get(model.toolbar));
    this.#surfaces.use(
      registerDomEvent(nodes.root, "mousedown", (event) => {
        event.preventDefault();
        this.#deps.focusReader();
      }),
    );
    this.#surfaces.defer(watch(registry, model.toolbar, draw));
    this.#deps.renderCapability(nodes.capabilitySlot);
    return nodes;
  }

  press(event: PointerEvent): void {
    this.#gesture++;
    if (this.#capturing && event.pointerId !== this.#capturing.pointerId)
      this.#cancelCapture();
    this.#pinching = null;
    if (this.#stroke && event.pointerId !== this.#stroke.pointerId) {
      this.#pinching = event.pointerId;
      this.#discardStroke();
    }
    if (this.#clickPress && event.pointerId !== this.#clickPress.pointerId) {
      this.#pinching = event.pointerId;
      this.#dropClickPress();
    }
    if (
      !(event.target as Element | null)?.closest?.(`.${themeHook.pdfTextDraft}`)
    )
      this.finishDraft();
    const inPopup = this.#deps.popup.contains(event.target as Node);
    if (!inPopup) this.#clear();
    this.#pressedOnPage =
      !inPopup && this.#pageUnder({ x: event.clientX, y: event.clientY });
  }

  settle(): void {
    const onPage = this.#pressedOnPage;
    this.#pressedOnPage = false;
    if (!onPage || this.#writing) return;
    const gesture = this.#gesture;
    const read = this.#readSelection();
    if (!read) return;
    const { structure, text, pages } = read;
    this.#settling = this.#deps.writes(
      placeSelection(structure, { text, pages }, (captured) => {
        if (gesture !== this.#gesture || this.#writing) return;
        if (selectionCollapsed(this.#deps.containerEl)) return;
        const { armed, colors } = this.#state();
        if (isSelectionTool(armed)) {
          this.#creating = this.#create({
            type: armed,
            color: colors[armed],
            comment: "",
            ...selectionDraft(captured),
          });
          return;
        }
        const anchorAt = anchorFractionOf(pages, captured.pageIndex);
        if (anchorAt)
          update(this.#deps.surface, captureSelection({ captured, anchorAt }));
      }),
    );
  }

  changed(): void {
    const floating = this.#floating();
    if (floating.kind !== "create" || floating.commenting || floating.inFlight)
      return;
    if (selectionCollapsed(this.#deps.containerEl)) this.#clear();
  }

  key(event: KeyboardEvent): void {
    if (inTextEntry(event.target)) return;
    if (!isEditGesture(event)) return;
    const key = event.key.toLowerCase();
    const tool: SelectionTool | null =
      key === "h" ? "highlight" : key === "u" ? "underline" : null;
    const swatch = ANNOTATION_COLORS[Number(key) - 1];
    const waiting = this.#floating().kind === "create";

    const live = editingLive(this.#capability());
    if (tool !== null) {
      event.preventDefault();
      if (waiting) this.#commit(tool, this.#state().colors[tool]);
      else if (live) this.#arm(this.#state().armed === tool ? null : tool);
      return;
    }
    if (swatch !== undefined) {
      event.preventDefault();
      const { armed } = this.#state();
      if (waiting) this.#commit(selectionToolOf(armed), swatch);
      else if (live) this.#setColor(armed ?? "highlight", swatch);
      return;
    }
    if (key !== "c" || !waiting) return;
    event.preventDefault();
    update(this.#deps.surface, setCommenting(true));
  }

  unanchored(): void {
    this.#clear();
  }

  grab(event: PointerEvent, { onMark }: { onMark: () => boolean }): void {
    const pinching = this.#pinching === event.pointerId;
    this.#pinching = null;
    if (event.button !== 0) return;
    const { armed } = this.#state();
    const gesture = gestureOf(armed);
    if (gesture === "stroke") {
      if (!pinching) this.#beginStroke(event);
      return;
    }
    if (gesture !== "click" && gesture !== "rectangle") return;
    if (pinching || this.#capturing || this.#writing || onMark()) return;
    const client = { x: event.clientX, y: event.clientY };
    const page = this.#pressedPage(event);
    if (!page || this.#inSelection(client)) return;
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    event.preventDefault();
    this.#collapse();
    this.#deps.containerEl.setPointerCapture(event.pointerId);
    if (isClickTool(armed)) {
      this.#holdClick({
        pointerId: event.pointerId,
        tool: armed,
        pageIndex: page.pageIndex,
        at: pdfPointAt(page.view, client),
        client,
      });
      return;
    }
    this.#capturing = { pointerId: event.pointerId, page };
    update(
      this.#deps.surface,
      beginCapture({
        pageIndex: page.pageIndex,
        from: pdfPointAt(page.view, client),
      }),
    );
  }

  move(event: PointerEvent): void {
    if (this.#stroke) {
      if (event.pointerId === this.#stroke.pointerId) this.#stroke.move(event);
      return;
    }
    const capturing = this.#capturing;
    const capture = selectCapture(this.#state());
    if (!capturing || event.pointerId !== capturing.pointerId || !capture)
      return;
    const { view } = capturing.page;
    update(
      this.#deps.surface,
      moveCapture(
        captureRect({
          from: capture.from,
          to: pdfPointAt(capturing.page.view, {
            x: event.clientX,
            y: event.clientY,
          }),
          viewBox: view.viewport.viewBox,
        }),
      ),
    );
  }

  release(event: PointerEvent): void {
    if (this.#stroke) {
      if (event.pointerId === this.#stroke.pointerId) this.#releaseStroke();
      return;
    }
    const click = this.#clickPress;
    if (click && event.pointerId === click.pointerId) {
      this.#holdClick(releaseCapture(this.#deps.containerEl, click));
      const travel = distance(click.client, {
        x: event.clientX,
        y: event.clientY,
      });
      if (travel >= CLICK_SLOP) return;
      if (click.tool === "note")
        this.#creating = this.#createNote(click.pageIndex, click.at);
      else this.#openDraft(click.pageIndex, click.at);
      return;
    }
    const capturing = this.#capturing;
    if (!capturing || event.pointerId !== capturing.pointerId) return;
    this.#capturing = releaseCapture(this.#deps.containerEl, this.#capturing);
    const rect = modify(this.#deps.surface, endCapture);
    if (!rect) return;
    this.#creating = this.#createImage(capturing.page.pageIndex, rect);
  }

  cancel(event: PointerEvent): void {
    if (event.pointerId === this.#clickPress?.pointerId) this.#dropClickPress();
    if (event.pointerId === this.#capturing?.pointerId) this.#cancelCapture();
    if (event.pointerId === this.#stroke?.pointerId) this.#discardStroke();
  }

  get capturing(): boolean {
    return (
      this.#capturing !== null ||
      this.#stroke !== null ||
      this.#clickPress !== null
    );
  }

  [Symbol.dispose](): void {
    this.#gesture++;
    this.finishDraft();
    this.#dropClickPress();
    this.#cancelCapture();
    this.#discardStroke();
    this.#surfaces.dispose();
    this.#clear();
  }

  #arm(tool: MarkTool | null): void {
    update(this.#deps.surface, arm(tool));
  }

  #setColor(tool: MarkTool, color: string): void {
    setToolColor(this.#deps.surface, this.#deps.colors, { tool, color });
  }

  #state(): ReaderSurfaceState {
    return current(this.#deps.surface);
  }

  #floating(): Floating {
    return this.#state().floating;
  }

  escape(): boolean {
    return this.#stepBack();
  }

  #stepBack(): boolean {
    if (this.#stroke) {
      this.#discardStroke();
      return true;
    }
    const floating = this.#floating();
    if (floating.kind === "text-draft" && floating.phase === "typing") {
      this.finishDraft();
      return true;
    }
    if (floating.kind === "capture" && floating.phase !== "saving") {
      this.#cancelCapture();
      return true;
    }
    if (floating.kind === "create" && floating.commenting) {
      update(this.#deps.surface, setCommenting(false));
      return true;
    }
    if (floating.kind === "create") {
      this.#clear();
      return true;
    }
    if (this.#state().armed === null) return false;
    this.#arm(null);
    return true;
  }

  #toolbarActivate(id: string, node: HTMLElement): void {
    if (id === "visibility") {
      update(this.#deps.surface, toggleMarks);
      this.#deps.repaint();
      return;
    }
    const tool = MARK_TOOLS.find(
      (candidate) => id === candidate || id === `${candidate}-color`,
    );
    if (!tool) return;
    if (id === tool) this.#arm(this.#state().armed === tool ? null : tool);
    else this.#openColorMenu(tool, node);
  }

  #openColorMenu(tool: MarkTool, node: HTMLElement): void {
    const { colors } = this.#deps;
    const menu = colorMenu(colors.current()[tool], (hex) =>
      this.#setColor(tool, hex),
    );
    if (tool === "ink")
      addInkWidths(menu, colors.inkWidth(), (width) =>
        colors.setInkWidth(width),
      );
    if (tool === "text")
      addTextFontSizes(menu, colors.textFontSize(), (size) =>
        colors.setTextFontSize(size),
      );
    raiseMenu(menu, {
      workspace: this.#deps.app.workspace,
      event: annotationColorMenu,
      info: {
        source: "pdf-tool",
        tool,
      },
    });
    showMenuAtButton(menu, node, "end");
  }

  popupView(): ReactNode | undefined {
    const input = selectCreateRowInput(this.#state());
    if (!input) return undefined;
    const tool = selectionToolOf(this.#state().armed);
    const commit = (): void => this.#commit(tool, this.#state().colors[tool]);
    return createElement(CreateMarkPopup, {
      app: this.#deps.app,
      controls: createPopupRow(input),
      activate: (action) => this.#activate(action),
      sheet: input.commenting
        ? {
            sheetRef: this.#sheet,
            field: textFieldWording("comment"),
            value: "",
            status: sheetStatus(input.capability, input.now),
            onSubmit: commit,
            commit: {
              label:
                tool === "underline"
                  ? m.pdf_toolbar_underline()
                  : m.pdf_toolbar_highlight(),
              run: commit,
            },
            onCancel: () => update(this.#deps.surface, setCommenting(false)),
          }
        : null,
    });
  }

  #activate(action: CreatePopupAction): void {
    switch (action.kind) {
      case "tool":
        this.#commit(action.tool, this.#state().colors[action.tool]);
        return;
      case "color": {
        const tool = selectionToolOf(this.#state().armed);
        this.#setColor(tool, action.color);
        this.#commit(tool, action.color);
        return;
      }
      case "comment": {
        const floating = this.#floating();
        update(
          this.#deps.surface,
          setCommenting(floating.kind === "create" && !floating.commenting),
        );
        return;
      }
      case "copy": {
        const floating = this.#floating();
        if (floating.kind !== "create") return;
        const { text } = floating.captured;
        void toast.promise(navigator.clipboard.writeText(text), {
          success: m.annot_view_copied_text(),
          error: m.annot_view_copy_failed(),
        });
        return;
      }
    }
  }

  #commit(type: SelectionTool, color: string): void {
    const floating = this.#floating();
    if (floating.kind !== "create" || this.#writing) return;
    this.#creating = this.#create({
      type,
      color,
      comment: floating.commenting ? (this.#sheet.current?.text() ?? "") : "",
      ...selectionDraft(floating.captured),
    });
  }

  #createNote(pageIndex: number, [x, y]: PdfPoint): WriteRun | null {
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return null;
    }
    const half = NOTE_SIZE / 2;
    return this.#create(
      {
        type: "note",
        color: this.#state().colors.note,
        comment: "",
        text: "",
        position: {
          pageIndex,
          rects: [[x - half, y - half, x + half, y + half]],
        },
      },
      { commenting: true },
    );
  }

  #openDraft(pageIndex: number, at: PdfPoint): void {
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    update(
      this.#deps.surface,
      openTextDraft({
        pageIndex,
        at,
        fontSize: this.#deps.colors.textFontSize(),
        color: this.#state().colors.text,
      }),
    );
    if (logLevelEnabled("debug"))
      this.#deps.bridge.runSync(
        Effect.logDebug("A Text Draft was opened").pipe(
          Effect.annotateLogs({ pageIndex }),
          withLogCategory("pdf-annotation-editor"),
        ),
      );
    const structure = this.#deps.structure();
    this.#draftStructure = structure;
    void structure?.page(pageIndex).catch(() => undefined);
    void structure?.pageLabels().catch(() => undefined);
  }

  typeDraft(text: string): void {
    const draft = selectTextDraft(this.#state());
    const page = this.#deps
      .pages()
      .find(({ pageIndex }) => pageIndex === draft?.pageIndex);
    if (!page) return;
    update(
      this.#deps.surface,
      refitTextDraft(text, {
        measure: interfaceFont(this.#deps.containerEl.win).measure,
        pageBox: page.view.viewport.viewBox,
      }),
    );
  }

  finishDraft(): void {
    if (selectTextDraft(this.#state())?.phase !== "typing") return;
    const structure = this.#draftStructure;
    this.#draftStructure = null;
    const draft = modify(this.#deps.surface, finishTextDraft);
    if (logLevelEnabled("debug"))
      this.#deps.bridge.runSync(
        Effect.logDebug("A Text Draft was finished").pipe(
          Effect.annotateLogs({ committed: draft !== null }),
          withLogCategory("pdf-annotation-editor"),
        ),
      );
    if (draft) this.#creating = this.#createText(draft, structure);
  }

  #createText(
    draft: TextDraft,
    structure: PdfTextStructure | null,
  ): WriteRun | null {
    const surface = this.#deps.surface;
    const capability = this.#capability();
    if (!editingLive(capability)) {
      update(surface, dropTextDraft);
      this.#deps.reportCreateFailure(
        blockedReason(capability, this.#deps.now()),
      );
      return null;
    }
    const settle = (key: string | null) => {
      if (key === null) update(surface, dropTextDraft);
      else update(surface, settleTextDraft(key));
    };
    const run = this.#create(
      {
        type: "text",
        color: draft.color,
        comment: draft.text,
        text: "",
        position: textDraftPosition(draft),
      },
      { structure, uninterruptible: true, settle },
    );
    if (run === null) settle(null);
    return run;
  }

  #createImage(pageIndex: number, rect: PdfRect): WriteRun | null {
    if (!editingLive(this.#capability())) {
      update(this.#deps.surface, cancelCapture);
      this.#deps.reportBlockedGesture();
      return null;
    }
    return this.#create({
      type: "image",
      color: this.#state().colors.image,
      comment: "",
      text: "",
      position: { pageIndex, rects: [rect] },
    });
  }

  #create(draft: MarkDraft, options: CreateOptions = {}): WriteRun | null {
    const write = this.#createWrite(draft, options);
    return write && this.#deps.writes(write);
  }

  #createWrite(
    { type, color, comment, text, position }: MarkDraft,
    {
      structure: given,
      group,
      uninterruptible,
      settle,
      ...reveal
    }: CreateOptions = {},
  ): CreateWrite | null {
    const structure = given ?? this.#deps.structure();
    if (!editingLive(this.#capability())) return null;
    if (!structure) {
      update(this.#deps.surface, cancelCapture);
      this.#deps.bridge.runSync(
        Effect.logWarning(
          "No text structure stands for this PDF; nothing was created",
        ).pipe(withLogCategory("pdf-annotation-editor")),
      );
      this.#deps.reportCreateFailure(m.pdf_create_reason_no_document());
      return null;
    }
    const { foreground, disarm } = CREATE_EFFECTS[type];
    const surface = this.#deps.surface;
    return createMark(
      this.#deps.annotations,
      {
        attachmentKey: this.#deps.attachmentKey,
        structure,
        draft: { type, color, comment, text, position },
        previous: previousAnnotations(this.#deps.records()),
        group,
        uninterruptible,
      },
      {
        begin: () => {
          if (!foreground) return;
          this.#writing = true;
          update(surface, setInFlight(true));
        },
        created: (annotationKey) => {
          recordColorUse(surface, this.#deps.colors, color);
          if (foreground) this.#deps.reveal(annotationKey, reveal);
          if (disarm) this.#arm(null);
        },
        failed: (reason) => this.#deps.reportCreateFailure(reason),
        end: (annotationKey) => {
          if (foreground) {
            this.#writing = false;
            update(surface, setInFlight(false));
            update(surface, cancelCapture);
          }
          if (annotationKey !== null && foreground) {
            this.#clear();
            this.#collapse();
          }
          settle?.(annotationKey);
        },
        now: () => this.#deps.now(),
      },
    );
  }

  #beginStroke(event: PointerEvent): void {
    if (this.#stroke) return;
    const client = { x: event.clientX, y: event.clientY };
    const page = this.#pressedPage(event);
    if (!page) return;
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    event.preventDefault();
    this.#collapse();
    this.#deps.containerEl.setPointerCapture(event.pointerId);
    const width = this.#deps.colors.inkWidth();
    const color = this.#state().colors.ink;
    const group = nextInkGroup();
    this.#inkGroup = group;
    this.#stroke = new InkStroke({
      pointerId: event.pointerId,
      page,
      at: client,
      width,
      color,
      surface: this.#deps.surface,
      win: this.#deps.containerEl.win,
      onSplit: (path) =>
        this.#queueStroke(
          { pageIndex: page.pageIndex, width, color },
          { path, reason: "split", group },
        ),
    });
    if (logLevelEnabled("trace"))
      this.#deps.bridge.runSync(
        Effect.logTrace("An ink stroke began").pipe(
          Effect.annotateLogs({ pageIndex: page.pageIndex }),
          withLogCategory("pdf-annotation-editor"),
        ),
      );
  }

  #releaseStroke(): void {
    const stroke = this.#stroke;
    if (!stroke) return;
    this.#stroke = null;
    const group = this.#inkGroup ?? undefined;
    this.#inkGroup = null;
    releaseCapture(this.#deps.containerEl, stroke);
    this.#queueStroke(
      {
        pageIndex: stroke.page.pageIndex,
        width: stroke.width,
        color: stroke.color,
      },
      { path: stroke.finish(), reason: "release", group },
    );
  }

  #queueStroke(
    stroke: Pick<PendingStroke, "pageIndex" | "width" | "color">,
    {
      path,
      reason,
      group,
    }: { path: number[]; reason: "release" | "split"; group?: string },
  ): void {
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    const pending: PendingStroke = {
      ...stroke,
      id: ++this.#strokeSerial,
      paths: [path],
    };
    update(this.#deps.surface, appendPendingStroke(pending));
    if (logLevelEnabled("debug"))
      this.#deps.bridge.runSync(
        Effect.logDebug("An ink stroke was finished").pipe(
          Effect.annotateLogs({
            reason,
            pageIndex: pending.pageIndex,
            points: path.length / 2,
          }),
          withLogCategory("pdf-annotation-editor"),
        ),
      );
    this.#creating = this.#deps.writes(
      queued(this.#inking, () => this.#createInk(pending, group)),
    );
  }

  #createInk(
    pending: PendingStroke,
    group: string | undefined,
  ): CreateWrite | null {
    const { id, pageIndex, width, color, paths } = pending;
    const settle = (key: string | null) => {
      if (key === null) update(this.#deps.surface, dropPendingStroke(id));
      else update(this.#deps.surface, settlePendingStroke({ id, key }));
    };
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      settle(null);
      return null;
    }
    const write = this.#createWrite(
      {
        type: "ink",
        color,
        comment: "",
        text: "",
        position: { pageIndex, width, paths },
      },
      { group, settle },
    );
    if (write === null) settle(null);
    return write;
  }

  #discardStroke(): void {
    const stroke = this.#stroke;
    if (!stroke) return;
    this.#stroke = null;
    this.#inkGroup = null;
    releaseCapture(this.#deps.containerEl, stroke);
    stroke[Symbol.dispose]();
    if (logLevelEnabled("debug"))
      this.#deps.bridge.runSync(
        Effect.logDebug("An ink stroke was discarded").pipe(
          withLogCategory("pdf-annotation-editor"),
        ),
      );
  }

  #dropClickPress(): void {
    this.#holdClick(releaseCapture(this.#deps.containerEl, this.#clickPress));
  }

  #holdClick(press: ClickPress | null): void {
    this.#clickPress = press;
    this.#deps.containerEl.toggleAttribute("data-zt-clicking", press !== null);
  }

  #cancelCapture(): void {
    this.#capturing = releaseCapture(this.#deps.containerEl, this.#capturing);
    if (selectCapture(this.#state())?.phase !== "saving")
      update(this.#deps.surface, cancelCapture);
  }

  #inSelection({ x, y }: Point): boolean {
    const selection = this.#deps.containerEl.win.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0)
      return false;
    return [...selection.getRangeAt(0).getClientRects()].some(
      (box) =>
        x >= box.left && x <= box.right && y >= box.top && y <= box.bottom,
    );
  }

  #clear(): void {
    this.#dropSheet();
    if (this.#floating().kind === "create")
      update(this.#deps.surface, clearFloating);
  }

  #dropSheet(): void {
    this.#sheet.current = null;
  }

  #collapse(): void {
    this.#deps.containerEl.win.getSelection()?.removeAllRanges();
  }

  #capability(): EditingCapability {
    return this.#state().capability;
  }

  #readSelection(): {
    structure: PdfTextStructure;
    text: string;
    pages: SelectionPage[];
  } | null {
    const selection = this.#deps.containerEl.win.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
      return null;
    }
    const pages = selectionPagesOf(selection.getRangeAt(0), this.#deps.pages());
    const structure = this.#deps.structure();
    if (!pages.length || !structure) return null;
    return { structure, text: selection.toString(), pages };
  }

  anchor(): Point | null {
    const floating = this.#floating();
    if (floating.kind !== "create") return null;
    const at = floating.anchorAt;
    const page = this.#deps
      .pages()
      .find(({ pageIndex }) => pageIndex === at.pageIndex);
    if (!page) return null;
    const rect = pageContentBox(page.view.div);
    if (rect.width <= 0 || rect.height <= 0) return null;
    const point = {
      x: rect.left + at.fx * rect.width,
      y: rect.top + at.fy * rect.height,
    };
    return onScreen(this.#deps.containerEl, point) ? point : null;
  }

  #pageUnder(client: Point): boolean {
    return this.#readerPageUnder(client) !== null;
  }

  #pressedPage(event: PointerEvent): ReaderPage | null {
    const page = this.#readerPageUnder({ x: event.clientX, y: event.clientY });
    return page?.view.div.contains(event.target as Node | null) ? page : null;
  }

  #readerPageUnder({ x, y }: Point): ReaderPage | null {
    return (
      this.#deps.pages().find(({ view }) => {
        const rect = view.div.getBoundingClientRect();
        return (
          x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        );
      }) ?? null
    );
  }
}

function sheetStatus(
  capability: EditingCapability,
  now: Temporal.Instant,
): EditorSheetStatus {
  const controls = fieldEditorControls(
    capabilityBlock(capability, now),
    null,
    now,
  );
  return {
    ...controls,
    manual: false,
    hint:
      controls.hint ??
      (Platform.isMacOS
        ? m.pdf_create_popup_comment_hint_mac()
        : m.pdf_create_popup_comment_hint()),
  };
}

function selectionDraft(captured: SelectedText) {
  return {
    text: captured.text,
    position: {
      pageIndex: captured.pageIndex,
      rects: captured.rects,
      ...(captured.nextPageRects && {
        nextPageRects: captured.nextPageRects,
      }),
    },
  };
}

function previousAnnotations(
  records: readonly AnnotationRecord[],
): { pageLabel: string; pageIndex: number }[] {
  return records.flatMap((record) =>
    record.pageLabel !== null && "pageIndex" in record.position
      ? [{ pageLabel: record.pageLabel, pageIndex: record.position.pageIndex }]
      : [],
  );
}

function anchorFractionOf(
  pages: readonly SelectionPage[],
  pageIndex: number,
): AnchorAt | null {
  const page = pages.find((one) => one.pageIndex === pageIndex);
  if (!page || page.clientRects.length === 0) return null;
  const width = page.box.right - page.box.left;
  const height = page.box.bottom - page.box.top;
  if (width <= 0 || height <= 0) return null;
  const left = Math.min(...page.clientRects.map((rect) => rect.left));
  const right = Math.max(...page.clientRects.map((rect) => rect.right));
  const bottom = Math.max(...page.clientRects.map((rect) => rect.bottom));
  return {
    pageIndex,
    fx: ((left + right) / 2 - page.box.left) / width,
    fy: (bottom - page.box.top) / height,
  };
}
