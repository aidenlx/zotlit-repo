import type {
  LockBlock,
  LockedVerb,
} from "#core/annotation-repository/lock.ts";
import type { ReaderSessionHost } from "#core/reader-session/session.ts";
import type {
  CardBlock,
  CardControl,
} from "#obsidian/annot-view/card-controls.ts";
import type { CommentRenderer } from "#obsidian/annot-view/comment-render.ts";
import type { AnnotationDragStart } from "#obsidian/annot-view/drag-insert.ts";
import type {
  CaretPoint,
  TextDraftActions,
  EditorSheet,
  HeldDraftActions,
} from "#obsidian/annot-view/editor-sheet.ts";
import type { EndTagSession } from "#obsidian/annot-view/tag-editor.tsx";
import type { CopyInstant } from "#obsidian/annotation-repository/capability-copy.ts";
import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type {
  AnnotationRecord,
  AnnotationRepository,
  GeometryInput,
} from "#obsidian/annotation-repository/service.ts";
import type { WriteFailure } from "#obsidian/annotation-repository/write.ts";
import { Effect } from "effect";
import type { App } from "obsidian";
import { Keymap, setIcon } from "obsidian";
import { createElement } from "react";
import type { ReactNode, RefObject } from "react";

import { confirm } from "@zotlit/obsidian-kit/confirm.ts";
import { registerDomEvent } from "@zotlit/obsidian-kit/disposables.ts";
import { raiseMenu } from "@zotlit/obsidian-kit/menu-events.ts";
import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { watch } from "@zotlit/obsidian-kit/view-atoms.ts";
import type {
  PdfPosition,
  RangeAdjustment,
  SelectedText,
} from "@zotlit/pdf-structure";
import { passAborted } from "@zotlit/plugin-kernel/abort-error.ts";
import { ANNOTATION_COLORS } from "@zotlit/plugin-kernel/annotation-colors.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { inTextEntry, isEditGesture } from "./capability-affordance.ts";
import { annotationColorMenu } from "./color-menu.ts";
import type { CreationGestures } from "./creation.ts";
import {
  bodyRect,
  gripAt,
  HANDLE_RADIUS,
  handleLayout,
  isEditablePosition,
  isRangeGrip,
  keyedPosition,
  keyEdit,
  proposePosition,
  RANGE_HANDLE_PADDING,
  rangeGripAt,
  rangeHandles,
  releasedPosition,
} from "./geometry-edit.ts";
import type {
  Arrow,
  EditablePosition,
  FreeTextContent,
  Grip,
  PdfPoint,
  RangeGrip,
  TextRotation,
} from "./geometry-edit.ts";
import {
  distance,
  markAnchor,
  marksAtPoint,
  pagePointOf,
  resolveMarkClick,
} from "./hit-test.ts";
import type {
  HitPage,
  MarkSelectionPoint,
  PageBox,
  Point,
} from "./hit-test.ts";
import type { MarkPopupHost } from "./mark-popup-host.ts";
import { tagSectionShows } from "./mark-popup-tags.tsx";
import type { MarkPopupTagSectionProps } from "./mark-popup-tags.tsx";
import { markPopupRow, SelectedMarkPopup } from "./mark-popup.tsx";
import type {
  MarkPopupControlId,
  MarkPopupRowInput,
  SelectedMarkPopupProps,
  SelectedPopupComment,
} from "./mark-popup.tsx";
import {
  eraseMarks,
  recolorMarks,
  reportWrite,
  reportWrites,
  saveGeometry,
  settledOf,
} from "./operations.ts";
import type { BindingWrites } from "./operations.ts";
import {
  current,
  modify,
  recordColorUse,
  update,
} from "./reader-surface-model.ts";
import type { ReaderSurface } from "./reader-surface-model.ts";
import {
  beginAdjust,
  cancelAdjust,
  endAdjust,
  moveAdjust,
  selectAdjust,
  selectSelectedRowInput,
  selectFloatingHead,
  selectMark,
  selectMarkHandles,
  selectGroup,
  selectSelectedDraft,
  selectSelectedKey,
  selectSelectedKeys,
  selectSelectedTagDraft,
  setCommenting,
  setTagging,
  stepStack,
} from "./reader-surface-state.ts";
import type {
  ReaderSurfaceState,
  SelectedRowInput,
} from "./reader-surface-state.ts";
import { readingOrder, stepReadingOrder } from "./reading-order.ts";
import {
  freeTextOf,
  interfaceFont,
  markTargets,
  unitPointOf,
  unitsPerPixel,
} from "./render.ts";
import type { OverlayPageView, PdfPageAnnotation } from "./render.ts";
import {
  colorMenu,
  drawnBoxOf,
  onScreen,
  pageBoxOf,
  pdfPointAt,
  pdfPointOf,
  releaseCapture,
  selectionCollapsed,
  unitsOf,
} from "./surface.ts";
import type { ToolColorStore } from "./tools.ts";

import { typeIcon } from "#core/annot-view/type-icon.ts";
import {
  firstLockRefusal,
  lockBlock,
} from "#core/annotation-repository/lock.ts";
import {
  fieldEditorControls,
  editingLive,
  heldTagDraft,
  heldTextDraft,
  pressControl,
  shownComment,
  tagEditorControls,
  textFieldWording,
} from "#obsidian/annot-view/card-controls.ts";
import {
  copyText,
  deleteConfirmation,
} from "#obsidian/annot-view/card-verbs.ts";
import { controlEntry } from "#obsidian/annot-view/comment-parts.tsx";
import {
  writeFailureMessage,
  writeFailureReason,
} from "#obsidian/annotation-repository/write.ts";

export type AnnotationEdits = Pick<
  AnnotationRepository["Service"],
  | "textDraftFor"
  | "deleteAnnotation"
  | "deleteAnnotations"
  | "discardTextDraft"
  | "discardTagDraft"
  | "editTextField"
  | "editTags"
  | "patchColor"
  | "patchColors"
  | "patchGeometry"
  | "retryTextDraft"
  | "submitTextField"
  | "submitTags"
>;

export interface SelectOptions {
  popup?: boolean;
  commenting?: boolean;
}

export interface MarkGestures {
  revealAnnotation: (annotationKey: string) => void;
  reportBlockedGesture: () => void;
  blockedPress: (block: CardBlock) => void;
  allowEditing: () => void;
}

export interface MarkSelectionDeps {
  containerEl: HTMLElement;
  app: App;
  renderComment: CommentRenderer;
  libraryTagNames: (annotationKey: string) => Promise<readonly string[]>;
  popup: Pick<MarkPopupHost, "contains" | "sync">;
  selectionSurfaces: Pick<ReaderSessionHost, "onSelectionSurface">;
  marks: () => ReadonlyMap<number, readonly PdfPageAnnotation[]>;
  records: () => readonly AnnotationRecord[];
  pageAt: (pageIndex: number) => OverlayPageView | null;
  repaint: () => void;
  navigate: (annotationKey: string) => void;
  report: (annotationKeys: readonly string[]) => void;
  annotations: AnnotationEdits;
  bridge: Pick<EffectBridge, "runSync" | "runPromise" | "runPromiseExit">;
  writes: BindingWrites;
  notifier: Notifier["Service"];
  colors: ToolColorStore;
  surface: ReaderSurface;
  gestures: MarkGestures;
  creation: CreationGestures | null;
  sortIndex: (position: PdfPosition) => Promise<string | null>;
  adjustRange: (adjustment: RangeAdjustment) => Promise<SelectedText | null>;
  textRotation: TextRotation;
  now: () => Temporal.Instant;
  dragOut: (event: AnnotationDragStart, annotation: AnnotationRecord) => void;
}

export class MarkSelection implements Disposable {
  readonly #deps;
  readonly #surfaces = new DisposableStack();
  #at: Pick<MarkSelectionPoint, "pageIndex" | "point"> | null = null;
  readonly #sheet: RefObject<EditorSheet | null> = { current: null };
  #caretAt: CaretPoint | undefined;
  readonly #tagSection: RefObject<HTMLDivElement | null> = { current: null };
  readonly #endSession: RefObject<EndTagSession | null> = { current: null };
  readonly #suggest: RefObject<HTMLElement | null> = { current: null };
  #pressedAt: Point | null = null;
  #dragging: { pointerId: number; client: Point } | null = null;
  #pressedHandle = false;
  #pressedStroke = false;
  #dragOutPage: HTMLElement | null = null;
  #adjusting = Promise.resolve();
  #ranging = Promise.resolve();
  #rangeAsk = 0;

  constructor(deps: MarkSelectionDeps) {
    this.#deps = deps;
  }

  get selected(): ReadonlySet<string> {
    return new Set(this.#selectedKeys());
  }

  get adjusted(): Promise<void> {
    return this.#adjusting;
  }

  load(): void {
    const { containerEl } = this.#deps;
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointerdown", (event) => {
        this.#pressedAt = { x: event.clientX, y: event.clientY };
        this.#pressGrip(event);
        if (!this.#dragging)
          this.#deps.creation?.grab(event, {
            onMark: () => this.#onMark(event),
          });
        this.#pressedStroke =
          event.button === 0 && this.#state().armed === "ink";
        this.#armDragOut(event);
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "dragstart", (event) => {
        const armed = this.#dragOutPage !== null;
        this.#disarmDragOut();
        const record = armed ? this.#record() : null;
        const { dataTransfer } = event;
        if (!record || !dataTransfer) return;
        dragGhost(
          containerEl.doc,
          { dataTransfer, clientX: event.clientX, clientY: event.clientY },
          record,
        );
        this.#deps.dragOut(
          {
            dataTransfer,
            currentTarget: containerEl,
            preventDefault: () => event.preventDefault(),
          },
          record,
        );
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointermove", (event) => {
        if (event.pointerId !== this.#dragging?.pointerId) {
          this.#deps.creation?.move(event);
          return;
        }
        this.#dragging.client = { x: event.clientX, y: event.clientY };
        this.#propose();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointerup", (event) => {
        if (event.pointerId === this.#dragging?.pointerId) this.#release();
        else this.#deps.creation?.release(event);
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "selectstart", (event) => {
        if (this.#dragging || this.#deps.creation?.capturing)
          event.preventDefault();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointercancel", (event) => {
        if (event.pointerId === this.#dragging?.pointerId) this.#cancelDrag();
        else this.#deps.creation?.cancel(event);
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "lostpointercapture", (event) => {
        if (event.pointerId !== this.#dragging?.pointerId)
          this.#deps.creation?.cancel(event);
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "click", (event) => this.#click(event)),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl.doc, "pointerup", () => {
        this.#disarmDragOut();
        this.#deps.creation?.settle();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "keydown", (event) => {
        this.#key(event);
        if (!event.defaultPrevented) this.#deps.creation?.key(event);
      }),
    );
    this.#surfaces.use(
      registerDomEvent(
        containerEl,
        "scroll",
        () => {
          if (this.#dragging) this.#propose();
          this.#deps.popup.sync();
        },
        { capture: true },
      ),
    );
    this.#surfaces.use(
      registerDomEvent(
        containerEl.doc,
        "pointerdown",
        (event) => {
          this.#deps.creation?.press(event);
          this.#outsidePress(event);
        },
        { capture: true },
      ),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl.doc, "selectionchange", () => {
        if (
          this.#selectedKeys().length > 0 &&
          !selectionCollapsed(this.#deps.containerEl)
        )
          this.#apply(null);
        this.#deps.creation?.changed();
      }),
    );
    const { registry, model } = this.#deps.surface;
    this.#surfaces.defer(
      watch(registry, model.selectedKeys, (keys) => {
        this.#deps.repaint();
        this.#deps.report(keys);
      }),
    );
    this.#surfaces.defer(
      watch(registry, model.floatingHead, (head, previous) => {
        const { kind, commenting } = head;
        if (kind !== "selected" || !commenting) this.#closeCommentEditor();
        if (!previous.tagging || previous.key === null) return;
        if (head.tagging && head.key === previous.key) return;
        this.#endTags();
        this.#submitTags(previous.key);
      }),
    );
  }

  select(
    annotationKey: string | null,
    { popup = true, commenting = false }: SelectOptions = {},
  ): void {
    this.#apply(annotationKey, null, { popup, commenting });
  }

  selectMarks(annotationKeys: readonly string[]): void {
    if (annotationKeys.length < 2) {
      this.select(annotationKeys[0] ?? null, { popup: false });
      return;
    }
    this.#submitAndCloseCommentEditor();
    this.#at = null;
    update(this.#deps.surface, selectGroup(annotationKeys));
  }

  [Symbol.dispose](): void {
    this.#submitAndCloseCommentEditor();
    this.#endTagSession();
    this.#disarmDragOut();
    this.#surfaces.dispose();
    this.#rangeAsk++;
    if (this.#selectedKeys().length > 0)
      update(this.#deps.surface, selectMark(null));
  }

  #apply(
    key: string | null,
    at: {
      pageIndex: number;
      point: Point;
      stack: readonly string[];
    } | null = null,
    { popup = true, commenting = false }: SelectOptions = {},
  ): void {
    if (key !== this.#selectedKey()) {
      this.#submitAndCloseCommentEditor();
    }
    this.#at =
      key !== null && at !== null
        ? { pageIndex: at.pageIndex, point: at.point }
        : null;
    update(
      this.#deps.surface,
      selectMark(key, {
        stack: at?.stack,
        quiet: !popup,
        commenting,
      }),
    );
  }

  #click(event: MouseEvent): void {
    const pressed = this.#pressedAt;
    this.#pressedAt = null;
    if (this.#pressedHandle) {
      this.#pressedHandle = false;
      return;
    }
    if (this.#pressedStroke) {
      this.#pressedStroke = false;
      return;
    }
    const client = { x: event.clientX, y: event.clientY };
    const page = this.#pageUnder(client);
    const outcome = resolveMarkClick({
      page,
      travel: pressed === null ? 0 : distance(pressed, client),
      collapsed: selectionCollapsed(this.#deps.containerEl),
      onLink: linkUnder(event.target),
      altKey: event.altKey,
      previous: this.#previous(),
    });
    switch (outcome.kind) {
      case "ignore":
        return;
      case "deselect":
        if (this.#selectedKeys().length > 0) this.#apply(null);
        return;
      case "select":
        if (page) {
          this.#apply(outcome.key, {
            pageIndex: page.index,
            point: page.at.point,
            stack: outcome.stack,
          });
        }
        return;
    }
  }

  escape(): boolean {
    if (this.#selectedKeys().length === 0) return false;
    if (selectFloatingHead(this.#state()).tagging && this.#endTags(false))
      return true;
    if (this.#dragging) this.#cancelDrag();
    else this.#apply(null);
    return true;
  }

  copy(): boolean {
    const selected = this.#selectedKeys();
    if (selected.length === 0 || !selectionCollapsed(this.#deps.containerEl))
      return false;
    const records = new Map(
      this.#deps.records().map((record) => [record.key, record]),
    );
    return copyText(selected.flatMap((key) => records.get(key) ?? []));
  }

  #key(event: KeyboardEvent): void {
    if (inTextEntry(event.target)) return;
    if (this.#geometryKey(event)) return;
    if (event.ctrlKey || event.metaKey) return;
    const walk =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : null;
    if (walk !== null) {
      const order = readingOrder(this.#deps.records());
      const selected = this.#selectedKeys();
      const next = stepReadingOrder(
        order,
        order.find((key) => selected.includes(key)) ?? null,
        walk,
      );
      if (next === null) return;
      event.preventDefault();
      this.#apply(next);
      this.#deps.navigate(next);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      const selected = this.#selectedKeys();
      if (selected.length === 0) return;
      event.preventDefault();
      if (!this.#live()) {
        this.#deps.gestures.reportBlockedGesture();
        return;
      }
      const locked = this.#lockOn(selected, "delete");
      if (locked) this.#deps.gestures.blockedPress(locked);
      else if (selected.length === 1) this.#erase(selected);
      else
        void confirm(deleteConfirmation(selected.length), this.#deps.app).then(
          (confirmed) => {
            if (confirmed) this.#erase(selected);
          },
        );
      return;
    }
    const selected = this.#selectedKeys();
    if (selected.length === 0) return;
    const swatch = ANNOTATION_COLORS[Number(event.key) - 1];
    if (swatch !== undefined) {
      if (!isEditGesture(event)) return;
      if (this.#live()) {
        event.preventDefault();
        const locked = this.#lockOn(selected, "color");
        if (locked) this.#deps.gestures.blockedPress(locked);
        else this.#recolor(selected, swatch);
      }
      return;
    }
  }

  #geometryKey(event: KeyboardEvent): boolean {
    const arrow = ARROWS[event.key];
    const record = this.#record();
    if (!arrow || !record || !isEditablePosition(record.position)) return false;
    const mod = Keymap.isModifier(event, "Mod");
    if ((event.ctrlKey || event.metaKey) && !mod) return false;
    const edit = keyEdit(record.type, {
      shift: event.shiftKey,
      alt: event.altKey,
      mod,
    });
    if (!edit) return false;
    if (this.#dragging || selectAdjust(this.#state())) return true;
    event.preventDefault();
    if (!this.#live()) {
      this.#deps.gestures.reportBlockedGesture();
      return true;
    }
    const locked = lockBlock(record.lock, "geometry");
    if (locked) {
      this.#deps.gestures.blockedPress(locked);
      return true;
    }
    const surface = this.#deps.surface;
    const { position } = record;
    if (edit.kind === "range") {
      if (position.kind !== "pdf-rects") return true;
      update(surface, beginAdjust({ grip: edit.end, from: [0, 0] }));
      const ask = ++this.#rangeAsk;
      this.#adjusting = this.#deps
        .adjustRange({ position, end: edit.end, step: arrow })
        .then((selected) => {
          if (ask !== this.#rangeAsk) return;
          if (!selected) {
            update(surface, cancelAdjust);
            return;
          }
          update(surface, moveAdjust(rectsPositionOf(selected), selected.text));
          return this.#settle(record.key, "keyboard");
        })
        .catch((error: unknown) => {
          if (!this.#surfaces.disposed) update(surface, cancelAdjust);
          this.#deps.bridge.runSync(
            Effect.logWarning("Could not step a highlight's range").pipe(
              Effect.annotateLogs({
                error,
                annotationKey: record.key,
              }),
              withLogCategory("pdf-annotation-editor"),
            ),
          );
        });
      return true;
    }
    const page = this.#deps.pageAt(position.pageIndex);
    const keyed =
      page &&
      keyedPosition({
        confirmed: position,
        edit: edit.kind,
        arrow,
        viewBox: page.viewport.viewBox,
        text: this.#textContent(record),
      });
    if (!keyed) return true;
    update(surface, beginAdjust({ grip: keyed.grip, from: [0, 0] }));
    update(surface, moveAdjust(keyed.proposal));
    const saving = this.#settle(record.key, "keyboard");
    if (saving) this.#adjusting = saving;
    return true;
  }

  #pressGrip(event: PointerEvent): void {
    this.#pressedHandle = false;
    const record = this.#record();
    if (event.button !== 0 || !record || !this.#live()) return;
    const state = this.#state();
    if (!selectMarkHandles(state)) return;
    if (!state.marksVisible || selectAdjust(state)) return;
    if (!isEditablePosition(record.position)) return;
    const client = { x: event.clientX, y: event.clientY };
    const range = this.#rangeGripAt(record, client);
    if (range) {
      this.#holdGrip(event, range.grip, range.from);
      return;
    }
    const page = this.#deps.pageAt(record.position.pageIndex);
    if (!page) return;
    const box = drawnBoxOf(page);
    const point = unitsOf(box, { x: event.clientX, y: event.clientY });
    const rect = bodyRect(record);
    let body: [number, number, number, number] | null = null;
    if (rect) {
      const a = unitPointOf(page, [rect[0], rect[1]]);
      const b = unitPointOf(page, [rect[2], rect[3]]);
      body = [
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.max(a.x, b.x),
        Math.max(a.y, b.y),
      ];
    }
    const grip = gripAt({
      handles: handleLayout(record).map(({ grip, at }) => ({
        grip,
        at: unitPointOf(page, at),
      })),
      body,
      point,
      radius: HANDLE_RADIUS * unitsPerPixel(page),
    });
    if (!grip) return;
    this.#holdGrip(event, grip, pdfPointOf(page, point));
  }

  #holdGrip(event: PointerEvent, grip: Grip, from: PdfPoint): void {
    event.preventDefault();
    this.#deps.containerEl.setPointerCapture(event.pointerId);
    this.#dragging = {
      pointerId: event.pointerId,
      client: { x: event.clientX, y: event.clientY },
    };
    this.#pressedHandle = grip !== "body";
    update(this.#deps.surface, beginAdjust({ grip, from }));
  }

  #rangeGripAt(
    record: AnnotationRecord,
    client: Point,
  ): { grip: RangeGrip; from: PdfPoint } | null {
    const { pageIndex } = record.position as EditablePosition;
    const page = this.#deps.pageAt(pageIndex);
    if (!page) return null;
    const handles = rangeHandles(
      record,
      RANGE_HANDLE_PADDING * unitsPerPixel(page),
      this.#deps.textRotation,
    );
    const pointOn = (index: number): PdfPoint | null => {
      const on = this.#deps.pageAt(index);
      return on && pdfPointAt(on, client);
    };
    const grip = rangeGripAt(handles, pointOn);
    const on = handles.find((handle) => handle.grip === grip);
    const from = on && pointOn(on.pageIndex);
    return grip && from ? { grip, from } : null;
  }

  #propose(): void {
    const record = this.#record();
    const adjust = selectAdjust(this.#state());
    const dragging = this.#dragging;
    if (!record || !adjust || !dragging) return;
    if (!isEditablePosition(record.position)) return;
    if (isRangeGrip(adjust.grip)) {
      this.#proposeRange(record, adjust.grip, dragging.client);
      return;
    }
    const page = this.#deps.pageAt(record.position.pageIndex);
    if (!page) return;
    update(
      this.#deps.surface,
      moveAdjust(
        proposePosition({
          confirmed: record.position,
          grip: adjust.grip,
          from: adjust.from,
          to: pdfPointAt(page, dragging.client),
          viewBox: page.viewport.viewBox,
          text: this.#textContent(record),
        }),
      ),
    );
  }

  #textContent(record: AnnotationRecord): FreeTextContent {
    const win = this.#deps.containerEl.win;
    return {
      comment: freeTextOf(record),
      measure: (text, fontSize) => interfaceFont(win).measure(text, fontSize),
    };
  }

  #proposeRange(
    record: AnnotationRecord,
    grip: RangeGrip,
    client: Point,
  ): void {
    const position = record.position;
    if (position.kind !== "pdf-rects") return;
    const pages = [position.pageIndex, position.pageIndex + 1].flatMap(
      (pageIndex) => {
        const page = this.#deps.pageAt(pageIndex);
        return page ? [{ pageIndex, page, box: drawnBoxOf(page) }] : [];
      },
    );
    const [on] = pages
      .filter(
        ({ pageIndex }) => grip === "end" || pageIndex === position.pageIndex,
      )
      .toSorted(
        (a, b) => boxDistance(a.box, client) - boxDistance(b.box, client),
      );
    if (!on) return;
    const [x, y] = pdfPointAt(on.page, client);
    const ask = ++this.#rangeAsk;
    const surface = this.#deps.surface;
    this.#ranging = this.#deps
      .adjustRange({
        position,
        end: grip,
        point: { pageIndex: on.pageIndex, x, y },
      })
      .then((selected) => {
        if (ask !== this.#rangeAsk || !selected) return;
        update(surface, moveAdjust(rectsPositionOf(selected), selected.text));
      })
      .catch((error: unknown) => {
        this.#deps.bridge.runSync(
          Effect.logWarning("Could not place a highlight's dragged range").pipe(
            Effect.annotateLogs({
              error,
              annotationKey: record.key,
            }),
            withLogCategory("pdf-annotation-editor"),
          ),
        );
      });
  }

  #release(): void {
    this.#dragging = releaseCapture(this.#deps.containerEl, this.#dragging);
    const key = this.#selectedKey();
    const surface = this.#deps.surface;
    const settle = () =>
      key === null || this.#surfaces.disposed
        ? undefined
        : this.#settle(key, "pointer");
    const adjust = selectAdjust(current(surface));
    if (isRangeGrip(adjust?.grip ?? "body")) {
      this.#adjusting = this.#ranging.then(settle);
      return;
    }
    const record = this.#record();
    const page =
      record &&
      isEditablePosition(record.position) &&
      this.#deps.pageAt(record.position.pageIndex);
    if (adjust?.phase === "dragging" && record && page) {
      update(
        surface,
        moveAdjust(
          releasedPosition({
            proposal: adjust.proposal,
            grip: adjust.grip,
            viewBox: page.viewport.viewBox,
            text: this.#textContent(record),
          }),
        ),
      );
    }
    const saving = settle();
    if (saving) this.#adjusting = saving;
  }

  #settle(key: string, input: GeometryInput): Promise<void> | undefined {
    const surface = this.#deps.surface;
    const text = selectAdjust(current(surface))?.text;
    const proposal = modify(surface, endAdjust);
    return proposal
      ? this.#saveGeometry(key, proposal, { text, input })
      : undefined;
  }

  #cancelDrag(): void {
    this.#dragging = releaseCapture(this.#deps.containerEl, this.#dragging);
    this.#rangeAsk++;
    update(this.#deps.surface, cancelAdjust);
  }

  #saveGeometry(
    key: string,
    proposal: EditablePosition,
    { text, input }: { text?: string; input: GeometryInput },
  ): Promise<void> {
    const surface = this.#deps.surface;
    const end = () => {
      if (selectAdjust(current(surface))?.proposal === proposal)
        update(surface, cancelAdjust);
    };
    if (!this.#live()) {
      end();
      this.#deps.gestures.reportBlockedGesture();
      return Promise.resolve();
    }
    return settledOf(
      this.#deps.bridge,
      this.#deps.writes(
        saveGeometry(this.#deps.annotations, this.#deps.notifier, {
          readSortIndex: this.#deps.sortIndex,
          key,
          proposal,
          text,
          input,
          end,
          now: () => this.#deps.now(),
          message: geometryFailureMessage,
        }),
      ),
    );
  }

  #outsidePress(event: PointerEvent): void {
    if (this.#selectedKeys().length === 0) return;
    const target = event.target as Node | null;
    if (this.#deps.containerEl.contains(target)) return;
    if (this.#deps.popup.contains(target)) return;
    if (this.#tagsContain(target)) return;
    if (this.#deps.selectionSurfaces.onSelectionSurface(target)) return;
    this.#apply(null);
  }

  popupView(content: HTMLElement): ReactNode | undefined {
    const input = selectSelectedRowInput(this.#state());
    if (!input) return undefined;
    const { annotation } = input;
    const row = markPopupRow(input);
    return createElement(SelectedMarkPopup, {
      app: this.#deps.app,
      row,
      activate: (id, node) => this.#activate(id, node, annotation),
      comment: this.#commentSlot(content, input, row.comment),
      conflict: this.#conflictSlot(input),
      tags: this.#tagSlot(content, input),
    });
  }

  #tagSlot(
    content: HTMLElement,
    input: MarkPopupRowInput,
  ): MarkPopupTagSectionProps | null {
    const { annotation, tagging } = input;
    const draft = selectSelectedTagDraft(this.#state());
    const block = input.blocks.tags;
    const { readOnly, hint } = tagEditorControls(block, draft, input.now);
    const held = heldTagDraft(block, draft, input.now);
    if (!tagSectionShows({ annotation, draft, tagging, held })) return null;
    const { annotations, surface } = this.#deps;
    return {
      sectionRef: this.#tagSection,
      endSession: this.#endSession,
      suggestRef: this.#suggest,
      annotation,
      draft,
      tagging,
      readOnly,
      hint,
      held,
      heldActions: this.#heldTagsActions(annotation),
      libraryNames: () => this.#deps.libraryTagNames(annotation.key),
      onChange: (names) => {
        const state = this.#state();
        if (
          !selectFloatingHead(state).tagging &&
          !state.tagDrafts.has(annotation.key)
        )
          return;
        this.#deps.bridge.runSync(annotations.editTags(annotation.key, names));
      },
      onClose: () => update(surface, setTagging(false)),
      within: content,
    };
  }

  #tagsContain(node: Node | null): boolean {
    return (
      (this.#tagSection.current?.contains(node) ?? false) ||
      (this.#suggest.current?.contains(node) ?? false)
    );
  }

  #endTags(withText = true): boolean {
    const end = this.#endSession.current;
    end?.(withText);
    return end !== null;
  }

  #submitTags(annotationKey: string): void {
    void this.#write(
      this.#deps.annotations.submitTags(annotationKey, { automatic: true }),
    );
  }

  #commentSlot(
    content: HTMLElement,
    input: SelectedRowInput,
    control: CardControl,
  ): SelectedPopupComment {
    const { annotation } = input;
    const sheet = input.commenting
      ? this.#commentEditorSlot(content, input)
      : null;
    if (sheet) return sheet;
    const entry = controlEntry(control, (at) =>
      this.#pressComment(annotation, control, at),
    );
    const held = heldTextDraft(
      "comment",
      this.#deps.bridge.runSync(
        this.#deps.annotations.textDraftFor("comment", annotation.key),
      ),
      { block: input.blocks.comment, now: input.now },
    );
    if (held) {
      return {
        kind: "held",
        held,
        actions: this.#draftActions(annotation),
        entry,
      };
    }
    return {
      kind: "view",
      html: annotation.comment,
      render: this.#deps.renderComment,
      entry,
    };
  }

  #pressComment(
    annotation: AnnotationRecord,
    control: CardControl,
    caretAt?: CaretPoint,
  ): void {
    pressControl(control, {
      act: () => this.#openComment(annotation, caretAt),
      onBlocked: (block) => this.#deps.gestures.blockedPress(block),
    });
  }

  #conflictSlot(input: SelectedRowInput): SelectedMarkPopupProps["conflict"] {
    const { annotation } = input;
    const draft = this.#deps.bridge.runSync(
      this.#deps.annotations.textDraftFor("comment", annotation.key),
    );
    if (input.commenting || draft?.state.kind !== "conflict") return null;
    return {
      conflict: {
        write: "comment",
        attempted: draft.text,
        fresh: draft.state.fresh,
      },
      block: input.blocks.comment,
      actions: this.#draftActions(annotation),
    };
  }

  #draftActions(annotation: AnnotationRecord): TextDraftActions {
    const { annotations, gestures } = this.#deps;
    const discard = () =>
      this.#deps.bridge.runSync(
        annotations.discardTextDraft("comment", annotation.key),
      );
    return {
      save: () =>
        void this.#write(
          annotations.submitTextField("comment", annotation.key),
        ),
      allowEditing: () => gestures.allowEditing(),
      discard,
      applyAgain: () =>
        void this.#write(annotations.retryTextDraft("comment", annotation.key)),
      discardConflict: discard,
    };
  }

  #heldTagsActions(annotation: AnnotationRecord): HeldDraftActions {
    const { annotations, gestures } = this.#deps;
    return {
      save: () => void this.#write(annotations.submitTags(annotation.key)),
      allowEditing: () => gestures.allowEditing(),
      discard: () =>
        this.#deps.bridge.runSync(annotations.discardTagDraft(annotation.key)),
    };
  }

  #commentEditorSlot(
    content: HTMLElement,
    input: SelectedRowInput,
  ): SelectedPopupComment | null {
    const { annotation } = input;
    const standing = selectSelectedDraft(this.#state());
    const draft =
      standing ??
      (this.#sheet.current
        ? null
        : this.#deps.bridge.runSync(
            this.#deps.annotations.editTextField("comment", annotation.key),
          ));
    if (!draft && !this.#sheet.current) {
      update(this.#deps.surface, setCommenting(false));
      return null;
    }
    const close = (): void => {
      this.#submitCommentEditor(annotation, true);
      update(this.#deps.surface, setCommenting(false));
    };
    const caretAt = this.#caretAt;
    this.#caretAt = undefined;
    return {
      kind: "sheet",
      sheet: {
        sheetRef: this.#sheet,
        field: textFieldWording("comment"),
        value: shownComment(annotation, draft),
        text: standing?.text,
        status: this.#commentControls(input),
        onChange: (text) =>
          this.#deps.bridge.runSync(
            this.#deps.annotations.editTextField(
              "comment",
              annotation.key,
              text,
            ),
          ),
        onSubmit: () => this.#submitCommentEditor(annotation),
        onSave: () => this.#submitCommentEditor(annotation),
        onCancel: close,
        onLeave: close,
        within: content,
        caretAt,
      },
    };
  }

  #commentControls({ annotation, blocks, now }: SelectedRowInput) {
    return fieldEditorControls(
      blocks.comment,
      this.#deps.bridge.runSync(
        this.#deps.annotations.textDraftFor("comment", annotation.key),
      ),
      now,
    );
  }

  #submitCommentEditor(annotation: AnnotationRecord, automatic = false): void {
    const editor = this.#sheet.current;
    if (!editor) return;
    this.#deps.bridge.runSync(
      this.#deps.annotations.editTextField(
        "comment",
        annotation.key,
        editor.text(),
      ),
    );
    void this.#write(
      this.#deps.annotations.submitTextField("comment", annotation.key, {
        automatic,
      }),
    );
  }

  #submitAndCloseCommentEditor(): void {
    const annotation = this.#record();
    if (annotation && this.#sheet.current) {
      this.#submitCommentEditor(annotation, true);
    }
    this.#closeCommentEditor();
  }

  #closeCommentEditor(): void {
    this.#sheet.current = null;
  }

  #activate(
    id: MarkPopupControlId,
    node: HTMLElement,
    annotation: AnnotationRecord,
  ): void {
    const { gestures } = this.#deps;
    switch (id) {
      case "color": {
        const menu = colorMenu(annotation.color, (hex) =>
          this.#recolor([annotation.key], hex),
        );
        raiseMenu(menu, {
          workspace: this.#deps.app.workspace,
          event: annotationColorMenu,
          info: { source: "pdf-mark", annotations: [annotation] },
        });
        showMenuAtButton(menu, node);
        return;
      }
      case "tags":
        this.#toggleTags(annotation);
        return;
      case "copy":
        copyText([annotation]);
        return;
      case "delete":
        this.#erase([annotation.key]);
        return;
      case "reveal":
        gestures.revealAnnotation(annotation.key);
        return;
      case "stack":
        this.#step();
        return;
    }
  }

  #openComment(annotation: AnnotationRecord, caretAt?: CaretPoint): void {
    this.#caretAt = caretAt;
    if (
      this.#deps.bridge.runSync(
        this.#deps.annotations.editTextField("comment", annotation.key),
      )
    )
      update(this.#deps.surface, setCommenting(true));
  }

  #toggleTags(annotation: AnnotationRecord): void {
    if (selectFloatingHead(this.#state()).tagging) {
      this.#endTagSession();
      return;
    }
    if (
      !this.#deps.bridge.runSync(
        this.#deps.annotations.editTags(annotation.key),
      )
    )
      return;
    this.#submitCommentEditor(annotation, true);
    update(this.#deps.surface, setTagging(true));
  }

  #endTagSession(): void {
    if (!this.#endTags()) update(this.#deps.surface, setTagging(false));
  }

  #recolor(annotationKeys: readonly string[], color: string): void {
    recordColorUse(this.#deps.surface, this.#deps.colors, color);
    this.#writes(
      recolorMarks(this.#deps.annotations, annotationKeys, color),
      "recolour",
    );
  }

  #erase(annotationKeys: readonly string[]): void {
    this.#writes(eraseMarks(this.#deps.annotations, annotationKeys), "delete");
  }

  #step(): void {
    update(this.#deps.surface, stepStack);
  }

  #write(
    write: Parameters<typeof reportWrite>[1],
    message?: (failure: WriteFailure, now: CopyInstant) => string,
  ): Promise<void> {
    return this.#runReport(
      reportWrite(this.#deps.notifier, write, {
        verb: "edit",
        now: () => this.#deps.now(),
        message,
      }),
    );
  }

  #writes(writes: Parameters<typeof reportWrites>[1], verb: string): void {
    void this.#runReport(
      reportWrites(this.#deps.notifier, writes, {
        verb,
        now: () => this.#deps.now(),
      }),
    );
  }

  #runReport(
    report: Parameters<MarkSelectionDeps["bridge"]["runPromise"]>[0],
  ): Promise<void> {
    return this.#deps.bridge
      .runPromise(report)
      .then(() => undefined, passAborted);
  }

  #live(): boolean {
    return editingLive(this.#capability());
  }

  #lockOn(
    selected: readonly string[],
    verb: Extract<LockedVerb, "color" | "delete">,
  ): LockBlock | null {
    const locks = new Map(
      this.#deps.records().map(({ key, lock }) => [key, lock]),
    );
    const refused = firstLockRefusal(
      selected,
      verb,
      (key) => locks.get(key) ?? null,
    );
    return refused && lockBlock(refused.lock, verb);
  }

  #capability(): EditingCapability {
    return this.#state().capability;
  }

  #state(): ReaderSurfaceState {
    return current(this.#deps.surface);
  }

  #selectedKey(): string | null {
    return selectSelectedKey(this.#state());
  }

  #selectedKeys(): readonly string[] {
    return selectSelectedKeys(this.#state());
  }

  #record(): AnnotationRecord | null {
    return selectSelectedRowInput(this.#state())?.annotation ?? null;
  }

  #armDragOut(event: PointerEvent): void {
    this.#disarmDragOut();
    if (event.button !== 0 || this.#dragging || this.#pressedStroke) return;
    if (this.#deps.creation?.capturing) return;
    if (!selectionCollapsed(this.#deps.containerEl)) return;
    const record = this.#record();
    if (!record) return;
    const page = this.#pageUnder({ x: event.clientX, y: event.clientY });
    if (!page || !marksAtPoint(page.targets, page.at).includes(record.key))
      return;
    const div = this.#deps.pageAt(page.index)?.div;
    if (!div) return;
    div.draggable = true;
    this.#dragOutPage = div;
  }

  #disarmDragOut(): void {
    if (this.#dragOutPage) this.#dragOutPage.draggable = false;
    this.#dragOutPage = null;
  }

  #onMark(event: PointerEvent): boolean {
    const page = this.#pageUnder({ x: event.clientX, y: event.clientY });
    return page !== null && marksAtPoint(page.targets, page.at).length > 0;
  }

  #previous(): MarkSelectionPoint | null {
    const key = this.#selectedKey();
    return key !== null && this.#at !== null ? { key, ...this.#at } : null;
  }

  #pageUnder(client: Point): HitPage | null {
    for (const [index, annotations] of this.#deps.marks()) {
      const page = this.#deps.pageAt(index);
      if (!page) continue;
      const at = pagePointOf(pageBoxOf(page), client);
      if (at) return { index, targets: markTargets(page, annotations), at };
    }
    return null;
  }

  anchor(): Point | null {
    const key = this.#selectedKey();
    if (key === null) return null;
    for (const [index, annotations] of this.#deps.marks()) {
      const drawn = annotations.filter(
        ({ annotation }) => annotation.key === key,
      );
      const page = drawn.length === 0 ? null : this.#deps.pageAt(index);
      if (!page) continue;
      const [target] = markTargets(page, drawn);
      const point = target && markAnchor(target.rects, pageBoxOf(page));
      if (point && onScreen(this.#deps.containerEl, point)) return point;
    }
    return null;
  }
}

const ARROWS: Partial<Record<string, Arrow>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function rectsPositionOf(selected: SelectedText): EditablePosition {
  return {
    kind: "pdf-rects",
    pageIndex: selected.pageIndex,
    rects: selected.rects.map(([x1, y1, x2, y2]) => [x1, y1, x2, y2]),
    ...(selected.nextPageRects && {
      nextPageRects: selected.nextPageRects.map(([x1, y1, x2, y2]) => [
        x1,
        y1,
        x2,
        y2,
      ]),
    }),
  };
}

function boxDistance(box: PageBox, { x, y }: Point): number {
  const dx = Math.max(box.left - x, 0, x - (box.left + box.width));
  const dy = Math.max(box.top - y, 0, y - (box.top + box.height));
  return Math.hypot(dx, dy);
}

function linkUnder(target: EventTarget | null): boolean {
  const node = target as Node | null;
  const element = node?.instanceOf(HTMLElement)
    ? node
    : (node?.parentElement ?? null);
  return element?.closest("a[href], .linkAnnotation") != null;
}

function dragGhost(
  doc: Document,
  {
    dataTransfer,
    clientX,
    clientY,
  }: Pick<DragEvent, "clientX" | "clientY"> & { dataTransfer: DataTransfer },
  { type, text, comment }: AnnotationRecord,
): void {
  const ghost = doc.body.createDiv({ cls: "drag-ghost" });
  ghost.setCssProps({ left: `${clientX}px`, top: `${clientY}px` });
  const self = ghost.createDiv({ cls: "drag-ghost-self" });
  setIcon(self, typeIcon(type));
  self.createSpan({ text: text || comment || "" });
  dataTransfer.setDragImage(ghost, 0, 0);
  doc.win.setTimeout(() => ghost.remove(), 0);
}

export function geometryFailureMessage(
  failure: WriteFailure,
  now: CopyInstant,
): string {
  return failure.kind === "locked"
    ? writeFailureMessage(failure, now)
    : m.pdf_adjust_failed({ reason: writeFailureReason(failure, now) });
}
