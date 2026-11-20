// Needs a DOM, so every consumer runs under `// @vitest-environment happy-dom`.
import {
  DateTime,
  Effect,
  Exit,
  PubSub,
  Scope as EffectScope,
  Stream,
} from "effect";
import type { Duration } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { HoverParent, Scope } from "obsidian";
import { vi } from "vitest";
import type { Mock } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";
import type {
  Observable,
  PageChangeCause,
  ReaderDocument,
  ReaderEvents,
  ReaderPage,
  Subpath,
} from "@zotlit/pdf-reader";
import type { PageViewport } from "@zotlit/pdf-reader/pdfjs";
import { editorApp } from "@zotlit/obsidian-kit/__fixtures__/editor-app.ts";
import { dispatchKey } from "@zotlit/obsidian-kit/__fixtures__/keymap.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import type { PdfPosition, PdfTextStructure } from "@zotlit/pdf-structure";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { passAborted } from "@zotlit/plugin-kernel/abort-error.ts";
import { withRecentColor } from "@zotlit/plugin-kernel/annotation-colors.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { toInstant } from "@zotlit/plugin-kernel/effect-clock.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { AttachmentResolution } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { freshnessSignal } from "@zotlit/plugin-services/obsidian/zotero-local-api/__fixtures__.ts";
import type { WireAnnotation } from "@zotlit/plugin-services/obsidian/zotero-local-api/__fixtures__.ts";

import {
  markExternal,
  nextChange,
  writable,
  zoteroLibrary,
} from "./annotation-repository.ts";
import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepositoryEvent,
  AnnotationState,
  HistoryOutcome,
} from "#obsidian/annotation-repository/service.ts";
import { IDLE } from "#obsidian/annotation-repository/write.ts";
import { ReaderSessionHost } from "#core/reader-session/session.ts";
import { defaults } from "./settings.ts";

import type { AttachmentReads } from "#obsidian/pdf-annotation-editor/binding.ts";
import { MarkCreation } from "#obsidian/pdf-annotation-editor/creation.ts";
import type { AnnotationCreates } from "#obsidian/pdf-annotation-editor/creation.ts";
import type { HostedReader } from "#obsidian/pdf-annotation-editor/hosted-reader.ts";
import { MarkPopupHost } from "#obsidian/pdf-annotation-editor/mark-popup-host.ts";
import { bindingResources } from "#obsidian/pdf-annotation-editor/operations.ts";
import { mountReaderKeymap } from "#obsidian/pdf-annotation-editor/reader-keymap.ts";
import type { HistoryVerb } from "#obsidian/pdf-annotation-editor/reader-keymap.ts";
import {
  current,
  ingestAnnotations,
  listenAnnotationEvents,
  makeReaderSurfaceModel,
} from "#obsidian/pdf-annotation-editor/reader-surface-model.ts";
import type { AnnotationFacts, ReaderSurface } from "#obsidian/pdf-annotation-editor/reader-surface-model.ts";
import { initialReaderSurfaceState } from "#obsidian/pdf-annotation-editor/reader-surface-state.ts";
import type { ReaderSurfaceState } from "#obsidian/pdf-annotation-editor/reader-surface-state.ts";
import { groupAnnotationsByPage } from "#obsidian/pdf-annotation-editor/render.ts";
import type { OverlayPageView } from "#obsidian/pdf-annotation-editor/render.ts";
import { MarkSelection } from "#obsidian/pdf-annotation-editor/selection.ts";
import type { AnnotationEdits, MarkSelectionDeps } from "#obsidian/pdf-annotation-editor/selection.ts";
import {
  DEFAULT_INK_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
  resolveToolColors,
} from "#obsidian/pdf-annotation-editor/tools.ts";
import type {
  AnnotationToolColors,
  InkWidth,
  TextFontSize,
  ToolColorStore,
} from "#obsidian/pdf-annotation-editor/tools.ts";

export const GLYPH = {
  c: "E",
  u: "E",
  rect: [58.0535, 726.9241, 64.1506, 737.4685],
  fontSize: 9.9626,
  fontName: "NimbusRomNo9L-Regu",
  rotation: 0,
  baseline: 726.9241,
};

export const GLYPH_CONTENT = { items: [{ str: "E", chars: [GLYPH] }] };

export const PAGE_BOX = [0, 0, 612, 792] as const;

export interface ViewportOptions {
  rotation?: number;
  scale?: number;
  userUnit?: number;
  box?: readonly [number, number, number, number];
}

export type FakeViewport = Omit<
  PageViewport,
  "convertToViewportPoint" | "convertToPdfPoint" | "clone"
> & {
  convertToViewportPoint(x: number, y: number): [number, number];
  convertToPdfPoint(x: number, y: number): [number, number];
  clone(options?: { scale?: number; rotation?: number }): FakeViewport;
};

export function viewport({
  rotation = 0,
  scale = 1,
  userUnit = 1,
  box = PAGE_BOX,
}: ViewportOptions = {}): FakeViewport {
  const total = scale * userUnit;
  const [x1, y1, x2, y2] = box;
  const axesSwap = rotation === 90 || rotation === 270;
  const convertToViewportPoint = (x: number, y: number): [number, number] => {
    switch (rotation) {
      case 90:
        return [total * (y - y1), total * (x - x1)];
      case 180:
        return [total * (x2 - x), total * (y - y1)];
      case 270:
        return [total * (y2 - y), total * (x2 - x)];
      default:
        return [total * (x - x1), total * (y2 - y)];
    }
  };
  const convertToPdfPoint = (x: number, y: number): [number, number] => {
    switch (rotation) {
      case 90:
        return [x1 + y / total, y1 + x / total];
      case 180:
        return [x2 - x / total, y1 + y / total];
      case 270:
        return [x2 - y / total, y2 - x / total];
      default:
        return [x1 + x / total, y2 - y / total];
    }
  };
  const [e, f] = convertToViewportPoint(0, 0);
  const [ax, bx] = convertToViewportPoint(1, 0);
  const [cy, dy] = convertToViewportPoint(0, 1);
  const width = total * (axesSwap ? y2 - y1 : x2 - x1);
  const height = total * (axesSwap ? x2 - x1 : y2 - y1);
  return {
    viewBox: [...box],
    userUnit,
    scale,
    rotation,
    offsetX: 0,
    offsetY: 0,
    transform: [ax - e, bx - f, cy - e, dy - f, e, f],
    width,
    height,
    rawDims: { pageWidth: width, pageHeight: height, pageX: 0, pageY: 0 },
    convertToViewportPoint,
    convertToPdfPoint,
    clone: ({ scale: next = scale, rotation: turned = rotation } = {}) =>
      viewport({ rotation: turned, scale: next, userUnit, box }),
  };
}

export interface FakePageView {
  div: HTMLElement;
  viewport: FakeViewport;
  pdfPage: {
    view: number[];
    getTextContent: Mock;
  };
}

export function pageView(content: unknown = GLYPH_CONTENT): FakePageView {
  return {
    div: createDiv(),
    viewport: viewport({ scale: 1.5 }),
    pdfPage: {
      view: [0, 0, 612, 792],
      getTextContent: vi.fn(async () => content),
    },
  };
}

export function readerDocument(
  page: FakePageView,
  { bytes = new Uint8Array([37, 80, 68, 70]) }: { bytes?: Uint8Array } = {},
) {
  let live = true;
  const whileLive = <A>(value: () => A) =>
    vi.fn(async (pageIndex?: number) =>
      live && (pageIndex === undefined || pageIndex === 0) ? value() : null,
    );
  const document_ = stubService<ReaderDocument>("ReaderDocument", {
    proxy: stubService<ReaderDocument["proxy"]>("PDFDocumentProxy", {
      numPages: 1,
      getPageLabels: vi.fn(async () => null),
    }),
    fingerprint: "fake-fingerprint",
    key: "attachments/rougier-2014.pdf",
    current: () => live,
    bytes: whileLive(() => bytes),
    page: whileLive(() => page.pdfPage) as unknown as ReaderDocument["page"],
    textContent: whileLive(() => page.pdfPage.getTextContent()),
  });
  return {
    document: document_,
    retire: () => {
      live = false;
    },
  };
}

type Listeners = {
  [K in keyof ReaderEvents]: Set<ReaderEvents[K]>;
};

function observable<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(next: T, previous: T) => void>();
  return {
    observable: {
      get: () => value,
      subscribe: (listener: (next: T, previous: T) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies Observable<T>,
    set(next: T) {
      const previous = value;
      value = next;
      for (const listener of Array.from(listeners)) listener(next, previous);
    },
  };
}

function subpathOf(raw: string): Subpath {
  const params = new Map<string, string>(
    new URLSearchParams(raw.replace(/^#/, "")),
  );
  const page = params.has("page") ? Number(params.get("page")) : null;
  return {
    raw,
    page,
    offset: null,
    selection: null,
    annotation: null,
    height: null,
    dest: null,
    zoom: null,
    search: null,
    params,
  };
}

export function pdfReader(page = pageView()) {
  const root = createDiv();
  const toolbarEl = root.createDiv();
  const container = root.createDiv();
  const listeners: Listeners = {
    document: new Set(),
    ready: new Set(),
    "page-rendered": new Set(),
    "page-change": new Set(),
    subpath: new Set(),
    "window-migrated": new Set(),
  };
  const emit = <K extends keyof ReaderEvents>(
    event: K,
    payload: Parameters<ReaderEvents[K]>[0],
  ) => {
    for (const listener of Array.from(listeners[event]))
      (listener as (event: typeof payload) => void)(payload);
  };
  const document_ = observable<ReaderDocument | null>(null);
  let held: ReturnType<typeof readerDocument> | null = null;
  let rendered = false;
  let first = true;
  const readerPage = stubService<ReaderPage>("ReaderPage", {
    pageIndex: 0,
    get div() {
      return page.div as HTMLDivElement;
    },
    get viewport() {
      return page.viewport;
    },
    get rendered() {
      return rendered;
    },
  });
  const open = (next: ReturnType<typeof readerDocument>) => {
    held = next;
    document_.set(next.document);
    emit("document", { document: next.document });
    emit("ready", { document: next.document, first });
    first = false;
  };
  const navigate = vi.fn<HostedReader["navigate"]>(async () => "shown");
  const focus = vi.fn();
  const reader: HostedReader = {
    root,
    container,
    state: stubService<HostedReader["state"]>("ReaderState", {}),
    document: document_.observable,
    pageAt: (pageIndex) => (held && pageIndex === 0 ? readerPage : null),
    renderedPages: () => (held && rendered ? [readerPage] : []),
    navigate,
    slot: () => toolbarEl,
    focus,
    on: (event, listener) => {
      listeners[event].add(listener as never);
      return () => listeners[event].delete(listener as never);
    },
  };
  return {
    reader,
    page,
    container,
    toolbarEl,
    navigate,
    focus,
    get document() {
      return held?.document ?? null;
    },
    get listening(): number {
      return Object.values(listeners).reduce((sum, set) => sum + set.size, 0);
    },
    openDocument: (next = readerDocument(page)) => open(next),
    paintBeforeReady: () => {
      rendered = true;
    },
    renderFirstPage: () => {
      rendered = true;
      emit("page-rendered", { page: readerPage });
    },
    turnPage: (cause: PageChangeCause = "user") => {
      emit("page-change", { pageIndex: 1, previous: 0, cause });
    },
    navigateTo: (subpath: string) => {
      emit("subpath", { subpath: subpathOf(subpath) });
    },
    reloadDocument: (next = readerDocument(page)) => {
      held?.retire();
      held = null;
      rendered = false;
      document_.set(null);
      emit("document", { document: null });
      open(next);
    },
    closeDocument: () => {
      held?.retire();
      held = null;
      rendered = false;
      document_.set(null);
    },
  };
}

export type FakeReader = ReturnType<typeof pdfReader>;

/**
 * One Annotation as the repository answers it, from the Fixture's own rows on
 * `rougier-2014.pdf`.
 *
 * @see packages/scripts/lib/fixture/spec.ts — `ANNOTATIONS`
 */
export function annotation(
  key: string,
  type: AnnotationRecord["type"],
  position: unknown,
): AnnotationRecord {
  return {
    key,
    type,
    color: "#2ea8e5",
    comment: null,
    text: null,
    parentKey: "RGRPDF24",
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    position: parseAnnotationPosition(
      position as AnnotationPositionRaw,
      "application/pdf",
    ),
    version: null,
    lock: null,
  };
}

/**
 * The attachment resolver, reduced to the lookup and the re-resolution a
 * binding takes.
 *
 * @param resolution what the resolver answers for every path, starting with
 *   `pending` — what a resolver whose database is still loading answers.
 */
export function attachmentReads(
  resolution: AttachmentResolution = { kind: "pending" },
): AttachmentReads & {
  resolve: Mock<AttachmentReads["resolve"]>;
  answer(next: AttachmentResolution): void;
} {
  const changes = Effect.runSync(PubSub.unbounded<void>());
  let current = resolution;
  return {
    resolve: vi.fn<AttachmentReads["resolve"]>(() =>
      Effect.sync(() => current),
    ),
    resolutionsChanged: Stream.fromPubSub(changes),
    /** What the resolver does once the database it waited on is readable. */
    answer(next: AttachmentResolution): void {
      current = next;
      PubSub.publishUnsafe(changes, undefined);
    },
  };
}

/**
 * The annotation repository, reduced to the reads, the Editing Capability, and
 * the two changes a binding takes.
 *
 * @param records the Annotations every read answers with.
 * @param capability what every Attachment, and the session, may do.
 */
export function annotationReads(
  records: readonly AnnotationRecord[] = [],
  capability: EditingCapability = { kind: "writable" },
) {
  const events = Effect.runSync(PubSub.unbounded<AnnotationRepositoryEvent>());
  const databaseSource = {
    kind: "zotero-db" as const,
    database: { userID: null, localUserKey: null, serverID: null },
    libraryID: 1,
    libraryRevision: 0,
  };
  let list: AnnotationList = {
    source: databaseSource,
    annotations: records,
  };
  let current = capability;
  /** How many PDF views hold each Attachment's Annotation History open. */
  const histories = new Map<string, number>();
  const eventStream = Stream.fromPubSub(events);
  /** Called once per run of the `probe` Effect, so a test counts the probes. */
  const probeRuns = vi.fn(() => Effect.void);
  return {
    read: vi.fn(() => Effect.succeed(list)),
    peek: vi.fn(() =>
      Effect.succeed({
        value: list,
        status: "fresh" as const,
        settled: Promise.resolve(list),
      }),
    ),
    refresh: vi.fn(() => Effect.succeed(list)),
    capabilityFor: vi.fn(() => Effect.sync(() => current)),
    annotationState: vi.fn(() =>
      Effect.sync((): AnnotationState => ({
        mutation: IDLE,
        textDrafts: { comment: null, text: null },
        tagDraft: null,
        hidden: false,
        gone: false,
      })),
    ),
    textDraftFor: vi.fn(() => Effect.succeed(null)),
    editTextField: vi.fn(() => Effect.succeed(null)),
    submitTextField: vi.fn(() => Effect.succeed(IDLE)),
    editTags: vi.fn(() => Effect.succeed(null)),
    submitTags: vi.fn(() => Effect.succeed(IDLE)),
    discardTextDraft: vi.fn(() => Effect.void),
    discardTagDraft: vi.fn(() => Effect.void),
    retryTextDraft: vi.fn(() => Effect.succeed(IDLE)),
    patchColor: vi.fn(() => Effect.succeed(IDLE)),
    patchColors: vi.fn((keys: readonly string[]) =>
      Effect.succeed(keys.map(() => IDLE)),
    ),
    patchGeometry: vi.fn(() => Effect.succeed(IDLE)),
    deleteAnnotation: vi.fn(() => Effect.succeed(IDLE)),
    deleteAnnotations: vi.fn((keys: readonly string[]) =>
      Effect.succeed(keys.map(() => IDLE)),
    ),
    createAnnotation: vi.fn(() =>
      Effect.succeed({ kind: "created" as const, annotationKey: "MADE2345" }),
    ),
    capability: Effect.sync(() => current),
    probe: Effect.suspend(probeRuns),
    probeRuns,
    hold: vi.fn(() =>
      Effect.succeed<Disposable>({ [Symbol.dispose]: () => {} }),
    ),
    openHistory: vi.fn((attachmentKey: string) =>
      Effect.sync(() => {
        histories.set(attachmentKey, (histories.get(attachmentKey) ?? 0) + 1);
      }),
    ),
    closeHistory: vi.fn((attachmentKey: string) =>
      Effect.sync(() => {
        const left = (histories.get(attachmentKey) ?? 1) - 1;
        if (left > 0) histories.set(attachmentKey, left);
        else histories.delete(attachmentKey);
      }),
    ),
    undo: vi.fn((_attachmentKey: string): Effect.Effect<HistoryOutcome> =>
      Effect.succeed({ kind: "idle" }),
    ),
    redo: vi.fn((_attachmentKey: string): Effect.Effect<HistoryOutcome> =>
      Effect.succeed({ kind: "idle" }),
    ),
    /** The Attachments a history stands open for, and how many views hold each. */
    get histories(): ReadonlyMap<string, number> {
      return histories;
    },
    annotationsChanged: eventStream.pipe(
      Stream.filter(
        (
          event,
        ): event is Extract<
          AnnotationRepositoryEvent,
          { _tag: "annotations-changed" }
        > => event._tag === "annotations-changed",
      ),
      Stream.map(({ attachmentKey }) => attachmentKey),
    ),
    annotationChanged: eventStream.pipe(
      Stream.filter(
        (
          event,
        ): event is Extract<
          AnnotationRepositoryEvent,
          { _tag: "annotation-changed" }
        > => event._tag === "annotation-changed",
      ),
      Stream.map(({ annotationKey }) => annotationKey),
    ),
    capabilityChanges: eventStream.pipe(
      Stream.filter(
        (
          event,
        ): event is Extract<
          AnnotationRepositoryEvent,
          { _tag: "capability-changed" }
        > => event._tag === "capability-changed",
      ),
      Stream.as(undefined),
    ),
    /** What a landed Capability Probe does: another capability, announced. */
    setCapability(next: EditingCapability): void {
      current = next;
      PubSub.publishUnsafe(events, { _tag: "capability-changed" });
    },
    /** What a dropped Zotero DB partition does: a whole new list, announced. */
    replace(attachmentKey: string, next: readonly AnnotationRecord[]): void {
      list = { source: databaseSource, annotations: next };
      PubSub.publishUnsafe(events, {
        _tag: "annotations-changed",
        attachmentKey,
      });
    },
  };
}

/** The blocked-edit gesture the PDF reader hands to its UI seam. */
export function capabilityGestures() {
  return {
    reportBlockedGesture: vi.fn(),
    allowEditing: vi.fn(),
  };
}

/** The gestures the Mark Popup hands to its UI seam. */
export function markGestures() {
  return { revealAnnotation: vi.fn(), blockedPress: vi.fn() };
}

/**
 * The settings the reader keeps each tool's colour in: the shipped defaults,
 * with a write held in memory the way a save holds it on disk.
 */
export function readerSettings(): Pick<
  PluginSettings["Service"],
  "current" | "update"
> {
  let current: Settings = { ...defaults };
  return {
    current: Effect.sync(() => current),
    update: (patchOrUpdater) =>
      Effect.sync(() => {
        const patch =
          typeof patchOrUpdater === "function"
            ? patchOrUpdater(current)
            : patchOrUpdater;
        current = { ...current, ...patch } as Settings;
        return current;
      }),
  };
}

/** Each tool's colour, held the way the settings-backed store holds it. */
export function toolColors(): ToolColorStore {
  let stored: AnnotationToolColors = {};
  let recent: readonly string[] = [];
  let inkWidth: InkWidth = DEFAULT_INK_WIDTH;
  let textFontSize: TextFontSize = DEFAULT_TEXT_FONT_SIZE;
  return {
    current: () => resolveToolColors(stored),
    set: (tool, color) => {
      stored = { ...stored, [tool]: color };
    },
    recent: () => recent,
    use: (color) => {
      recent = withRecentColor(recent, color);
    },
    inkWidth: () => inkWidth,
    setInkWidth: (width) => {
      inkWidth = width;
    },
    textFontSize: () => textFontSize,
    setTextFontSize: (size) => {
      textFontSize = size;
    },
  };
}

export { dispatchKey };

/** A Reader Surface over a registry of its own, as a binding holds one. */
export function readerSurface(
  initial: Parameters<typeof initialReaderSurfaceState>[0],
): ReaderSurface {
  return {
    registry: AtomRegistry.make(),
    model: makeReaderSurfaceModel(initialReaderSurfaceState(initial)),
  };
}

/**
 * A selection of the state the model carries no atom for, as a derived atom
 * with `equals`.
 */
export function selection<A>(
  { model }: ReaderSurface,
  select: (state: ReaderSurfaceState) => A,
  equals?: (a: A, b: A) => boolean,
): Atom.Atom<A> {
  const selected = Atom.map(model.state, select);
  return equals ? Atom.withEquality(selected, equals) : selected;
}

/** The instant the reader surfaces read their clock at. */
export const READER_NOW = toInstant(
  DateTime.makeUnsafe("2026-09-17T10:00:00Z"),
);

export interface ReaderSurfacesOptions {
  /** The PDF view's container, where the gestures are heard. */
  containerEl: HTMLElement;
  /** The one page the reader holds, at page index 0. */
  page: OverlayPageView;
  /** What the last read answered. */
  records: readonly AnnotationRecord[];
  capability?: EditingCapability;
  annotations: AnnotationEdits & AnnotationCreates & AnnotationFacts;
  bridge: Pick<
    EffectBridge,
    "runSync" | "runPromise" | "runPromiseExit" | "subscribe"
  >;
  /**
   * This document's Structured Characters; `null` until one is open. As a
   * function, read on each ask, as the viewer is.
   */
  structure?: PdfTextStructure | null | (() => PdfTextStructure | null);
  /** The Sort Index a Geometry Edit is saved with. */
  sortIndex?: (position: PdfPosition) => Promise<string | null>;
  /** The range a text range's dragged end reaches. */
  adjustRange?: MarkSelectionDeps["adjustRange"];
  /** The text rotation a range's handles lie across. */
  textRotation?: MarkSelectionDeps["textRotation"];
  /** Each tool's colour and the ink width; held in memory unless given. */
  colors?: ToolColorStore;
  /**
   * The platform the Reader Keymap binds the Annotation History keys for.
   *
   * @default false
   */
  isMacOS?: boolean;
  /** Where the surfaces' notices go; a recording one unless given. */
  notifier?: ReturnType<typeof testNotifier>;
}

/**
 * The reader surfaces over one page, wired the way the binding wires them: one
 * Reader Surface State, the Mark Selection and the Mark Creation that draw from
 * it, and the one popup host over both.
 */
export function readerSurfaces({
  containerEl,
  page,
  records,
  capability = { kind: "writable" },
  annotations,
  bridge,
  structure = null,
  sortIndex = async () => null,
  adjustRange = async () => null,
  textRotation = () => 0,
  colors = toolColors(),
  isMacOS = false,
  notifier = testNotifier(),
}: ReaderSurfacesOptions) {
  const parent: HoverParent = { hoverPopover: null };
  /** Each drag of a selected mark out of the reader, as the selection started it. */
  const draggedOut = vi.fn<MarkSelectionDeps["dragOut"]>();
  // The view's own Scope, which holds its registry and its writes, as the
  // editor's does, and which the disposal closes.
  const scope = EffectScope.makeUnsafe();
  let closed = false;
  const { registry, writes } = Effect.runSync(
    bindingResources.pipe(EffectScope.provide(scope)),
  );
  const surface: ReaderSurface = {
    registry,
    model: makeReaderSurfaceModel(
      initialReaderSurfaceState({
        colors: colors.current(),
        capability,
        now: READER_NOW,
      }),
    ),
  };
  // The view holds its Attachment's list while it is open, as the binding
  // does.
  const viewHold = bridge.runSync(annotations.hold(["RGRPDF24"]));
  let held = records;
  ingestAnnotations(surface, held, { annotations, bridge });
  const listening = listenAnnotationEvents(surface, annotations, bridge);
  const gestures = {
    revealAnnotation: vi.fn(),
    blockedPress: vi.fn(),
    reportBlockedGesture: vi.fn(),
    allowEditing: vi.fn(),
  };
  /** Why each create that made nothing said it made nothing, in order. */
  const reportCreateFailure = vi.fn<(reason: string) => void>();
  /** Each time the toolbar handed the keyboard to the pages. */
  const focusReader = vi.fn();
  const reported: (readonly string[])[] = [];
  /** The session a consumer names its selection surfaces on. */
  const session = new ReaderSessionHost({
    source: "obsidian-pdf",
    navigate: vi.fn(),
    select: vi.fn(),
  });
  const navigated: string[] = [];
  const revealed: string[] = [];
  /** The options each reveal was asked with, in reveal order. */
  const revealedWith: { commenting?: boolean }[] = [];
  const popup = {
    contains: (node: Node | null) => host.contains(node),
    sync: () => host.sync(),
  };
  const app = editorApp();
  const creation = new MarkCreation({
    app,
    containerEl,
    popup,
    attachmentKey: "RGRPDF24",
    pages: () => [{ pageIndex: 0, view: page }],
    records: () => held,
    structure: typeof structure === "function" ? structure : () => structure,
    repaint: vi.fn(),
    reveal: (annotationKey, options = {}) => {
      revealed.push(annotationKey);
      revealedWith.push(options);
    },
    reportBlockedGesture: gestures.reportBlockedGesture,
    reportCreateFailure,
    renderCapability: vi.fn(),
    focusReader,
    colors,
    surface,
    annotations,
    bridge,
    writes,
    now: () => READER_NOW,
  });
  const selection = new MarkSelection({
    app,
    renderComment: (el, html) => {
      el.setText(html);
      return () => el.empty();
    },
    libraryTagNames: async () => [],
    containerEl,
    popup,
    selectionSurfaces: session,
    marks: () =>
      current(surface).marksVisible ? groupAnnotationsByPage(held) : new Map(),
    records: () => held,
    pageAt: (pageIndex) => (pageIndex === 0 ? page : null),
    repaint: vi.fn(),
    navigate: (key) => navigated.push(key),
    report: (keys) => reported.push(keys),
    annotations,
    bridge,
    writes,
    notifier: notifier.service,
    colors,
    surface,
    gestures,
    creation,
    sortIndex,
    adjustRange,
    textRotation,
    now: () => READER_NOW,
    dragOut: draggedOut,
  });
  selection.load();
  const view: { scope: Scope | null; app: typeof app } = { scope: null, app };
  /** Each press of the Annotation History keys this fixture answered, in order. */
  const stepped: HistoryVerb[] = [];
  const unmountKeymap = mountReaderKeymap(
    view,
    {
      escape: () => selection.escape() || creation.escape(),
      undo: () => stepped.push("undo"),
      redo: () => stepped.push("redo"),
      copy: () => selection.copy(),
    },
    { isMacOS },
  );
  const host = new MarkPopupHost({
    parent,
    doc: () => containerEl.doc,
    surface,
    shown: () => true,
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

  return {
    app,
    surface,
    host,
    selection,
    creation,
    session,
    parent,
    colors,
    gestures,
    reportCreateFailure,
    draggedOut,
    /** Every notice the surfaces showed, in order. */
    notices: notifier.notices,
    focusReader,
    reported,
    navigated,
    revealed,
    revealedWith,
    stepped,
    /** The records the last read answered, kept past the reader's close. */
    drawn: (): readonly AnnotationRecord[] => held,
    /**
     * What a refresh does once the read answers: the records, replaced. A
     * closed reader takes them into no state, as the binding's does.
     */
    replace(next: readonly AnnotationRecord[]) {
      held = next;
      if (!closed) ingestAnnotations(surface, next, { annotations, bridge });
    },
    /**
     * What the binding does once a page re-rendered. A closed reader hears no
     * page, as the binding's does.
     */
    sync() {
      if (!closed) host.sync();
    },
    /**
     * One keystroke as Obsidian delivers it: the view's Scope hears it first,
     * and the page hears it only when no handler there took it.
     *
     * @param target where the focus sits; the container when not given.
     */
    key(init: KeyboardEventInit, target: EventTarget = containerEl) {
      return dispatchKey(view.scope!, init, target);
    },
    // Once, as the binding's own disposer runs: the Scope it closes takes
    // the registry with it.
    [Symbol.dispose]() {
      if (closed) return;
      closed = true;
      unmountKeymap();
      selection[Symbol.dispose]();
      creation[Symbol.dispose]();
      host[Symbol.dispose]();
      session[Symbol.dispose]();
      listening.dispose();
      viewHold[Symbol.dispose]();
      Effect.runFork(EffectScope.close(scope, Exit.void));
    },
  };
}

/** One reader record as the Zotero Local API writes it. */
export function wireOf(record: AnnotationRecord): WireAnnotation {
  return {
    key: record.key,
    version: record.version ?? 1,
    type: record.type,
    ...(record.color !== null && { color: record.color }),
    ...(record.comment !== null && { comment: record.comment }),
    ...(record.text !== null && { text: record.text }),
    ...(record.pageLabel !== null && { pageLabel: record.pageLabel }),
    sortIndex: record.sortIndex,
    position:
      record.position.kind === "unknown"
        ? record.position.raw
        : record.position,
    tags: record.tags,
  };
}

/**
 * The real Annotation Repository over a Zotero that holds `records` on
 * `RGRPDF24`, with Write Authorization already remembered and the list read.
 * What Zotero holds, through `zotero`, is the oracle a write is checked by.
 */
export async function repositoryOver(
  stack: AsyncDisposableStack,
  records: readonly AnnotationRecord[],
  { external }: { external?: readonly string[] } = {},
) {
  const zotero = zoteroLibrary(records.map(wireOf));
  const {
    repository,
    service,
    bridge,
    requests,
    client,
    dbEvents,
    serverEvents,
    localApiService,
    runtime,
    adjustLayerClock,
  } = await writable(stack, zotero.answers, { external });
  const list = await repository.read("RGRPDF24");
  return {
    repository,
    service,
    bridge,
    zotero,
    requests,
    list,
    localApiService,
    /**
     * Move the repository's TestClock, which its autosave timers run on;
     * Vitest's fake timers do not reach them.
     */
    adjustRepositoryClock(duration: Duration.Input): Promise<void> {
      return runtime.runPromise(adjustLayerClock(duration));
    },
    /**
     * Zotero imports one Annotation from the PDF file, and a database refresh
     * tells the repository, which locks it.
     */
    importFromPdf(key: string): void {
      markExternal(client, key);
      dbEvents.emit("changed");
    },
    /**
     * Zotero quits, and the device's database turns out to be another one:
     * the switch that hides every draft made against the first.
     */
    async switchDatabase(): Promise<void> {
      zotero.quit();
      const lost = nextChange(repository);
      freshnessSignal(serverEvents);
      await lost;
      client.$client.exec(
        "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
      );
      dbEvents.emit("changed");
      await repository.read("RGRPDF24");
    },
  };
}

/**
 * The reader surfaces over {@link repositoryOver}. Every announcement is drawn
 * as the binding draws it: the list the repository holds at once, then the
 * list the read that follows answers. A test therefore sees the Pending
 * Proposals, failures and conflicts the repository itself produces.
 */
export async function readerOverZotero(
  stack: AsyncDisposableStack,
  {
    external,
    ...options
  }: Omit<ReaderSurfacesOptions, "annotations" | "bridge"> & {
    /** The Annotations Zotero imported from the PDF file, by key. */
    external?: readonly string[];
  },
) {
  const zoteroSide = await repositoryOver(stack, options.records, {
    external,
  });
  const { repository, service, bridge, list } = zoteroSide;
  const reader = stack.use(
    readerSurfaces({
      ...options,
      records: list?.annotations ?? [],
      annotations: service,
      bridge,
    }),
  );
  let open = true;
  stack.defer(() => {
    open = false;
  });
  const draw = (next: AnnotationList | null | undefined) => {
    if (!open || !next) return;
    reader.replace(next.annotations);
    reader.sync();
  };
  stack.defer(
    repository.listen("annotations-changed", (attachmentKey) => {
      draw(repository.peek(attachmentKey)?.value);
      void repository.read(attachmentKey).then(draw).catch(passAborted);
    }),
  );
  return { ...reader, ...zoteroSide, closeRuntime: () => stack.disposeAsync() };
}
