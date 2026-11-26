import type { FakeReader } from "#__fixtures__/pdf-annotation-editor.ts";
import type { HistoryOutcome } from "#obsidian/annotation-repository/service.ts";
import { DateTime, Effect } from "effect";
import { Scope, TExternalFile } from "obsidian";
import type { App, EventRef, View, Workspace, WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
// @vitest-environment happy-dom
import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { openNoteVault } from "@zotlit/plugin-services/obsidian/note-index/__fixtures__.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";

import type { AttachmentResolution } from "./service.ts";

import {
  annotation,
  annotationReads,
  attachmentReads,
  capabilityGestures,
  dispatchKey,
  markGestures,
  pageView,
  pdfReader,
  readerDocument,
  readerSettings,
} from "#__fixtures__/pdf-annotation-editor.ts";
import { openPdfEditor } from "#__fixtures__/pdf-annotation-editor/editor.ts";
import { editingCapabilityCopy } from "#obsidian/annotation-repository/capability-copy.ts";

beforeEach(() => {
  setMockPlatform({ isMacOS: false });
});

afterEach(async () => {
  resetMockPlatform();
  await noteIndexes.disposeAsync();
  noteIndexes = new AsyncDisposableStack();
});

const RESOLVED = {
  kind: "resolved",
  serverID: null,
  attachmentKey: "ABCD2345",
  itemKey: "WXYZ6789g4711",
  openable: true,
} as const satisfies AttachmentResolution;

const HIGHLIGHT = annotation("PUPR5FG5", "highlight", {
  pageIndex: 0,
  rects: [[265.833, 611.202, 374.503, 620.019]],
});
const UNDERLINE = annotation("K3JRFLFQ", "underline", {
  pageIndex: 0,
  rects: [[67.011, 612.638, 211.485, 620.77]],
});

function pdfView(path: string | null, reader: FakeReader = pdfReader()) {
  return {
    file: path === null ? null : { path },
    fake: reader,
    containerEl: document.createElement("div"),
    scope: new Scope(),
  };
}

type ReaderView = ReturnType<typeof pdfView>;

const openViews = new WeakMap<App, ReaderView[]>();

function PdfAnnotationEditor(
  options: Omit<Parameters<typeof openPdfEditor>[0], "open">,
) {
  return openPdfEditor({ ...options, open: openViews.get(options.app) ?? [] });
}

function workspace(views: { view: ReaderView }[]) {
  const offref = vi.fn<(ref: EventRef) => void>();
  const registered: EventRef[] = [];
  const handlers = new Map<string, ((leaf?: { view: unknown }) => void)[]>();
  const app = stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", {
      getLeavesOfType: () =>
        views.map(({ view }) =>
          stubService<WorkspaceLeaf>("WorkspaceLeaf", {
            view: view as unknown as View,
          }),
        ),
      offref,
      onLayoutReady: (callback: () => void) => callback(),
      on: ((
        name: string,
        callback: (leaf?: { view: unknown }) => void,
      ): EventRef => {
        const eventHandlers = handlers.get(name) ?? [];
        eventHandlers.push(callback);
        handlers.set(name, eventHandlers);
        const ref = stubService<EventRef>("EventRef", {
          e: stubService<App["workspace"]>("WorkspaceEvents", { offref }),
        });
        registered.push(ref);
        return ref;
      }) as Workspace["on"],
    }),
  });

  openViews.set(
    app,
    views.map(({ view }) => view),
  );
  return {
    app,
    offref,
    registered,
    activate: (view: unknown) => {
      for (const handler of handlers.get("active-leaf-change") ?? []) {
        handler({ view });
      }
    },
  };
}

function affordanceIn(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>(`.${themeHook.pdfCapability}`);
}

function secondsShown(slot: HTMLElement): string | null {
  return (
    affordanceIn(slot)?.querySelector("[data-zt-capability-countdown]")
      ?.textContent ?? null
  );
}

let noteIndexes = new AsyncDisposableStack();

async function emptyNoteIndex() {
  return (await openNoteVault({}, noteIndexes)).noteIndex.runtime.runSync(
    NoteIndex,
  );
}

async function standingDeps() {
  return {
    markGestures: markGestures(),
    settings: readerSettings(),
    noteIndex: await emptyNoteIndex(),
  };
}

const NOW = DateTime.makeUnsafe("2026-09-17T10:00:00Z");
const RETRY_AFTER = DateTime.add(NOW, { seconds: 45 });

function selectedKeys(page: { div: HTMLElement }): (string | undefined)[] {
  return [
    ...page.div.querySelectorAll<SVGElement>(
      "[data-zotero-annotation-key].is-selected",
    ),
  ].map((mark) => mark.dataset.zoteroAnnotationKey);
}

function markedKeys(page: { div: HTMLElement }): (string | undefined)[] {
  return [
    ...page.div.querySelectorAll<SVGElement>("[data-zotero-annotation-key]"),
  ].map((mark) => mark.dataset.zoteroAnnotationKey);
}

beforeEach(() => {
  setMockPlatform({ isMacOS: false });
});

afterEach(async () => {
  resetMockPlatform();
  await noteIndexes.disposeAsync();
  noteIndexes = new AsyncDisposableStack();
});

it("binds an open PDF view, resolves its vault path, and unbinds on unload", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const attachments = attachmentReads(RESOLVED);
  const annotations = annotationReads();
  const { app, offref, registered } = workspace([{ view }]);
  const service = await PdfAnnotationEditor({
    app,
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });

  {
    await using _service = service;

    expect(attachments.resolveFile).toHaveBeenCalledExactlyOnceWith(view.file, {
      attachmentKey: null,
    });
    const binding = service.bindings[0]!;
    expect(binding.absolutePath).toBe("/vault/attachments/rougier-2014.pdf");
    expect(binding.attachment).toEqual(RESOLVED);
    expect(annotations.read).toHaveBeenCalledExactlyOnceWith("ABCD2345");

    reader.renderFirstPage();
    expect(affordanceIn(reader.toolbarEl)).toBeNull();
    expect(reader.toolbarEl.childElementCount).toBe(1);
    expect(reader.page.div.childElementCount).toBe(0);
    expect(registered.length).toBeGreaterThan(0);
    expect(offref).not.toHaveBeenCalled();
  }

  expect(reader.toolbarEl.childElementCount).toBe(0);
  expect(reader.listening).toBe(0);
  const released = offref.mock.calls.map(([ref]) => ref);
  expect(released).toHaveLength(registered.length);
  for (const ref of registered)
    expect(released.filter((releasedRef) => releasedRef === ref)).toHaveLength(
      1,
    );
});

it("refreshes the repository when an open PDF leaf becomes active", async () => {
  const view = pdfView("attachments/rougier-2014.pdf");
  const annotations = annotationReads();
  const harness = workspace([{ view }]);
  await using _service = await PdfAnnotationEditor({
    app: harness.app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });

  harness.activate(view);

  expect(annotations.refresh).toHaveBeenCalledExactlyOnceWith("ABCD2345");
});

it("rebuilds the marks from data after PDF.js recycles the page", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  await service.bindings[0]!.refreshed;

  reader.page.div.replaceChildren();
  reader.renderFirstPage();

  expect(markedKeys(reader.page)).toEqual(["PUPR5FG5"]);
  expect(annotations.read).toHaveBeenCalledOnce();
});

function paintedPage() {
  const page = pageView();
  const box = {
    left: 0,
    top: 0,
    right: 918,
    bottom: 1188,
    width: 918,
    height: 1188,
  };
  page.div.getBoundingClientRect = () => box as never;
  const textLayer = page.div.createDiv({ cls: "textLayer", text: "E" });
  const reader = pdfReader(page);
  reader.paintBeforeReady();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  view.containerEl.getBoundingClientRect = () => box as never;
  view.containerEl.append(page.div);
  document.body.append(view.containerEl);
  return {
    page,
    reader,
    view,
    dragAcrossGlyph: async (
      service: Awaited<ReturnType<typeof PdfAnnotationEditor>>,
    ) => {
      const range = document.createRange();
      range.selectNodeContents(textLayer);
      vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
        { left: 87, top: 81, right: 96, bottom: 98 },
      ] as never);
      vi.spyOn(window, "getSelection").mockReturnValue(
        stubService<Selection>("Selection", {
          rangeCount: 1,
          isCollapsed: false,
          anchorNode: textLayer,
          getRangeAt: () => range,
          removeAllRanges: () => undefined,
          toString: () => "E",
        }),
      );
      page.div.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 260,
        }),
      );
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      await service.bindings[0]!.settled;
      vi.restoreAllMocks();
    },
    cleanup: () => {
      view.containerEl.remove();
      document.body.querySelector(".zt-pdf-mark-popup")?.remove();
    },
  };
}

function createPopup(): Element | null {
  return document.querySelector(".zt-pdf-mark-popup [data-zt-verb]");
}

it("opens the create popup over a page painted before the binding attached", async () => {
  const painted = paintedPage();
  const { app } = workspace([{ view: painted.view }]);
  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  await service.bindings[0]!.refreshed;

  await painted.dragAcrossGlyph(service);

  expect(createPopup()).not.toBeNull();
  painted.cleanup();
});

it("reads the text structure of a document the reader opened after the binding attached", async () => {
  const painted = paintedPage();
  const { app } = workspace([]);
  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  service.attach(painted.view, { opened: false });
  await service.bindings[0]!.refreshed;

  painted.reader.openDocument();
  painted.reader.renderFirstPage();
  await painted.dragAcrossGlyph(service);

  expect(createPopup()).not.toBeNull();
  painted.cleanup();
});

it("reads the text structure again once the view reopened its document", async () => {
  const painted = paintedPage();
  const { app } = workspace([{ view: painted.view }]);
  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  await service.bindings[0]!.refreshed;
  await painted.dragAcrossGlyph(service);
  const readsOfOld = painted.page.pdfPage.getTextContent.mock.calls.length;

  const reopened = pageView();
  painted.reader.reloadDocument(readerDocument(reopened));
  painted.reader.renderFirstPage();
  await painted.dragAcrossGlyph(service);

  expect(reopened.pdfPage.getTextContent).toHaveBeenCalledOnce();
  expect(painted.page.pdfPage.getTextContent).toHaveBeenCalledTimes(readsOfOld);
  painted.cleanup();
});

it("reads an external file's absolute path from the file itself", async () => {
  const attachments = attachmentReads(RESOLVED);
  const file = new TExternalFile();
  file.path = "file:/Users/reader/Zotero/storage/ABCD2345/paper.pdf";
  const view = { ...pdfView(null), file };
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments,
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });

  expect(attachments.resolveFile).toHaveBeenCalledExactlyOnceWith(file, {
    attachmentKey: null,
  });
  expect(service.bindings[0]!.absolutePath).toBe(
    "/Users/reader/Zotero/storage/ABCD2345/paper.pdf",
  );
});

it("leaves a PDF Zotero does not know exactly as Obsidian opened it", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/holiday-snaps.pdf", reader);
  const attachments = attachmentReads({ kind: "unresolved" });
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  reader.renderFirstPage();
  await binding.refreshed;

  attachments.answer(RESOLVED);
  attachments.answer(RESOLVED);
  await binding.refreshed;

  expect(attachments.resolveFile).toHaveBeenCalledOnce();
  expect(binding.attachment).toEqual({ kind: "unresolved" });
  expect(annotations.read).not.toHaveBeenCalled();
  expect(reader.toolbarEl.childElementCount).toBe(0);
  expect(reader.page.div.childElementCount).toBe(0);
});

it("paints a view bound while the resolver could not answer yet", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const attachments = attachmentReads();
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  reader.renderFirstPage();
  await binding.refreshed;

  expect(binding.attachment).toEqual({ kind: "pending" });
  expect(annotations.read).not.toHaveBeenCalled();
  expect(reader.page.div.childElementCount).toBe(0);

  attachments.answer(RESOLVED);
  await binding.refreshed;

  expect(binding.attachment).toEqual(RESOLVED);
  expect(markedKeys(reader.page)).toEqual(["PUPR5FG5"]);
});

it("unbinds a view whose reader closed its document first", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  await service.bindings[0]!.refreshed;

  expect(markedKeys(reader.page)).toEqual(["PUPR5FG5"]);

  reader.closeDocument();

  expect(() => service.detach(view)).not.toThrow();
  expect(service.bindings).toEqual([]);
  expect(reader.listening).toBe(0);
});

it("rebinds a leaf that opened another PDF and unbinds a closed leaf", async () => {
  const first = pdfReader();
  const second = pdfReader();
  const view = pdfView("attachments/first.pdf", first);
  const attachments = attachmentReads(RESOLVED);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments,
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });

  service.detach(view);
  const switched = Object.assign(view, {
    file: { path: "attachments/second.pdf" },
    fake: second,
  });
  service.attach(switched);

  expect(first.listening).toBe(0);
  expect(attachments.resolveFile).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: "attachments/second.pdf" }),
    { attachmentKey: null },
  );
  expect(second.listening).toBeGreaterThan(0);

  service.detach(switched);

  expect(service.bindings).toEqual([]);
  expect(second.listening).toBe(0);
});

it("exposes each open PDF view as a Reader Session of its own", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const other = pdfView("attachments/other.pdf");
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });

  const session = service.sessionFor(view);
  expect(session).toBe(service.bindings[0]!.session);
  expect(session!.source).toBe("obsidian-pdf");
  expect(session!.target).toEqual({
    attachmentKey: "ABCD2345",
    itemKey: "WXYZ6789g4711",
  });
  expect(service.sessionFor(other)).toBeNull();
});

it("announces a late PDF session after its resolved target is available", async () => {
  const view = pdfView("attachments/rougier-2014.pdf");
  const { app } = workspace([]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const announced: unknown[] = [];
  service.subscribe((filePath) => {
    announced.push({
      filePath,
      target: service.sessionFor(view)?.target,
    });
  });

  service.attach(view);

  expect(announced).toEqual([
    {
      filePath: "attachments/rougier-2014.pdf",
      target: { attachmentKey: "ABCD2345", itemKey: "WXYZ6789g4711" },
    },
  ]);
});

it("names a standalone attachment in its session, with no parent Item", async () => {
  const view = pdfView("attachments/loose.pdf");
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads({
      kind: "resolved",
      serverID: null,
      attachmentKey: "LSTAND23",
      itemKey: null,
      openable: true,
    }),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });

  expect(service.sessionFor(view)!.target).toEqual({
    attachmentKey: "LSTAND23",
    itemKey: null,
  });
});

it("paints the mark a consumer selected, and drops one the read retired", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads([HIGHLIGHT, UNDERLINE]);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  await binding.refreshed;
  reader.renderFirstPage();

  binding.session.setSelectedAnnotations(["PUPR5FG5"]);
  expect(selectedKeys(reader.page)).toEqual(["PUPR5FG5"]);

  annotations.replace("ABCD2345", [UNDERLINE]);
  await binding.refreshed;

  expect(selectedKeys(reader.page)).toEqual([]);
  expect(binding.session.selected).toEqual([]);
});

it("paints a group a consumer selected, with no popup, and walks it down to one mark", async () => {
  const lower = annotation("LWR23456", "highlight", {
    pageIndex: 0,
    rects: [[67.011, 500.5, 211.485, 510.2]],
  });
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT, UNDERLINE, lower]),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  await binding.refreshed;
  reader.renderFirstPage();
  const popup = () => document.querySelector(".zt-pdf-mark-popup");
  const handles = () =>
    reader.page.div.querySelectorAll(".zt-pdf-annotation-handle").length;
  const walk = (key: string) =>
    view.containerEl.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );

  binding.session.setSelectedAnnotations(["PUPR5FG5", "LWR23456"]);
  expect(new Set(selectedKeys(reader.page))).toEqual(
    new Set(["PUPR5FG5", "LWR23456"]),
  );
  expect(binding.session.selected).toEqual(["PUPR5FG5", "LWR23456"]);
  expect(popup()).toBeNull();
  expect(handles()).toBe(0);

  walk("ArrowDown");
  expect(new Set(selectedKeys(reader.page))).toEqual(new Set(["LWR23456"]));
  expect(binding.session.selected).toEqual(["LWR23456"]);
  expect(handles()).toBeGreaterThan(0);

  binding.session.setSelectedAnnotations(["PUPR5FG5", "LWR23456"]);
  expect(popup()).toBeNull();
  walk("ArrowUp");
  expect(binding.session.selected).toEqual(["K3JRFLFQ"]);
  popup()?.remove();
});

it("keeps a selected group through a landing on one of its marks", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT, UNDERLINE]),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  await binding.refreshed;
  reader.renderFirstPage();

  binding.session.setSelectedAnnotations(["PUPR5FG5", "K3JRFLFQ"]);
  binding.session.navigateToAnnotation("K3JRFLFQ");
  await binding.refreshed;

  expect(binding.session.selected).toEqual(["PUPR5FG5", "K3JRFLFQ"]);
  expect(new Set(selectedKeys(reader.page))).toEqual(
    new Set(["PUPR5FG5", "K3JRFLFQ"]),
  );

  binding.session.setSelectedAnnotations(["PUPR5FG5"]);
  binding.session.navigateToAnnotation("K3JRFLFQ");
  await binding.refreshed;
  expect(binding.session.selected).toEqual(["K3JRFLFQ"]);
});

it("lands on the mark a card click names, on a page the reader moves to first", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  await binding.refreshed;

  binding.session.setSelectedAnnotations(["PUPR5FG5"]);
  binding.session.navigateToAnnotation("PUPR5FG5");
  await binding.refreshed;
  expect(reader.navigate).toHaveBeenCalledWith({ pageIndex: 0 });

  reader.renderFirstPage();
  expect(selectedKeys(reader.page)).toEqual(["PUPR5FG5"]);
  expect(binding.session.selected).toEqual(["PUPR5FG5"]);

  reader.navigate.mockClear();
  binding.session.navigateToAnnotation("K3JRFLFQ");
  await binding.refreshed;
  expect(reader.navigate).not.toHaveBeenCalled();
});

it("drops a Landing still waiting on its page when a consumer clears the selection", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  await binding.refreshed;

  binding.session.setSelectedAnnotations(["PUPR5FG5"]);
  binding.session.navigateToAnnotation("PUPR5FG5");
  await binding.refreshed;
  binding.session.setSelectedAnnotations([]);

  reader.renderFirstPage();
  expect(selectedKeys(reader.page)).toEqual([]);
  expect(binding.session.selected).toEqual([]);
});

it("stops announcing once the view's binding is gone", async () => {
  const view = pdfView("attachments/rougier-2014.pdf");
  const { app } = workspace([{ view }]);

  const service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const session = service.bindings[0]!.session;
  const announced: unknown[] = [];
  session.on("target-changed", (target) => announced.push(target));

  await service[Symbol.asyncDispose]();
  session.setSelectedAnnotations(["PUPR5FG5"]);

  expect(announced).toEqual([]);
  expect(service.bindings).toEqual([]);
  expect(service.sessionFor(view)).toBeNull();
});

it("keeps the toolbar's nodes across capability announcements, and stands them down in place", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads();
  const { app } = workspace([{ view }]);
  const controls = () => [
    ...reader.toolbarEl.querySelectorAll<HTMLElement>("[data-zt-tool]"),
  ];

  await using _service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
    now: () => NOW,
  });
  const drawn = controls();
  expect(drawn.map((node) => node.dataset.ztTool)).toEqual([
    "highlight",
    "highlight-color",
    "underline",
    "underline-color",
    "note",
    "note-color",
    "text",
    "text-color",
    "image",
    "image-color",
    "ink",
    "ink-color",
    "visibility",
  ]);

  annotations.setCapability({ kind: "writable" });
  controls().forEach((node, index) => expect(node).toBe(drawn[index]));

  const blocked = { kind: "read-only", reason: "zotero-unavailable" } as const;
  annotations.setCapability(blocked);
  const copy = editingCapabilityCopy(blocked, toInstant(NOW));
  const highlight = controls()[0]!;
  expect(highlight).toBe(drawn[0]);
  expect(highlight.getAttribute("aria-disabled")).toBe("true");
  expect(highlight.getAttribute("aria-label")).toBe(copy.detail ?? copy.label);
});

it("counts a cooldown down on the toolbar's window, under the binding's disposer", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads();
  const { app } = workspace([{ view }]);
  const started = vi.spyOn(reader.toolbarEl.win, "setInterval");
  const stopped = vi.spyOn(reader.toolbarEl.win, "clearInterval");
  const cooling = (): void =>
    annotations.setCapability({
      kind: "cooldown",
      retryAfter: RETRY_AFTER,
    });

  const service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
    now: () => NOW,
  });
  {
    await using _service = service;
    expect(started).not.toHaveBeenCalled();

    cooling();
    expect(started).toHaveBeenCalledOnce();
    expect(secondsShown(reader.toolbarEl)).toBe("45");

    const id = started.mock.results[0]!.value as number;
    annotations.setCapability({ kind: "writable" });
    expect(stopped).toHaveBeenCalledWith(id);
    expect(secondsShown(reader.toolbarEl)).toBeNull();

    stopped.mockClear();
    cooling();
  }
  expect(stopped).toHaveBeenCalledOnce();
});

it("keeps pending authorization informational in the PDF reader", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const gestures = capabilityGestures();
  const { app } = workspace([{ view }]);

  await using _service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([], { kind: "authorizing" }),
    capabilityGestures: gestures,
    ...(await standingDeps()),
  });

  const node = affordanceIn(reader.toolbarEl)!;
  node.click();
  node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

  expect(node.getAttribute("role")).toBe("status");
});

it("probes before a blocked keystroke is answered, and stays out of the way otherwise", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads([], {
    kind: "read-only",
    reason: "zotero-unavailable",
  });
  const gestures = capabilityGestures();
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: gestures,
    ...(await standingDeps()),
  });

  const press = async (key: string): Promise<void> => {
    view.containerEl.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
    await service.bindings[0]!.gestured;
  };

  await press("h");
  expect(annotations.probeRuns).toHaveBeenCalledOnce();
  expect(gestures.reportBlockedGesture).toHaveBeenCalledExactlyOnceWith(
    "ABCD2345",
  );

  await press("Escape");
  expect(annotations.probeRuns).toHaveBeenCalledOnce();

  annotations.setCapability({ kind: "writable" });
  await press("u");
  expect(annotations.probeRuns).toHaveBeenCalledOnce();
  expect(gestures.reportBlockedGesture).toHaveBeenCalledOnce();

  annotations.setCapability({ kind: "authorization-required" });
  await press("h");
  expect(annotations.probeRuns).toHaveBeenCalledTimes(2);
  expect(gestures.reportBlockedGesture).toHaveBeenCalledTimes(2);
});

it("interrupts a blocked keystroke's probe when its PDF view closes, and says nothing", async () => {
  const view = pdfView("attachments/rougier-2014.pdf", pdfReader());
  const annotations = annotationReads([], {
    kind: "read-only",
    reason: "zotero-unavailable",
  });
  const interrupted = vi.fn();
  annotations.probeRuns.mockReturnValueOnce(
    Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
  );
  const gestures = capabilityGestures();
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: gestures,
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  view.containerEl.dispatchEvent(
    new KeyboardEvent("keydown", { key: "h", bubbles: true }),
  );
  expect(annotations.probeRuns).toHaveBeenCalledOnce();

  service.detach(view);
  await binding.gestured;

  expect(interrupted).toHaveBeenCalledOnce();
  expect(gestures.reportBlockedGesture).not.toHaveBeenCalled();
});

it("opens one Annotation History per Attachment and ends it with the last view", async () => {
  const first = pdfView("attachments/rougier-2014.pdf");
  const second = pdfView("attachments/rougier-2014.pdf");
  const annotations = annotationReads();
  const { app } = workspace([{ view: first }, { view: second }]);
  const service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });

  {
    await using _service = service;

    expect(annotations.histories).toEqual(new Map([["ABCD2345", 2]]));

    service.detach(second);
    expect(annotations.histories).toEqual(new Map([["ABCD2345", 1]]));
  }

  expect(annotations.histories).toEqual(new Map());
});

it("lands on the Annotation an undo changed, and reports one Zotero moved", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads([HIGHLIGHT]);
  const gestures = capabilityGestures();
  const { app } = workspace([{ view }]);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: gestures,
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  await binding.refreshed;
  reader.renderFirstPage();

  annotations.undo.mockReturnValueOnce(
    Effect.succeed({
      kind: "stepped",
      annotationKey: "PUPR5FG5",
    }),
  );
  dispatchKey(view.scope, { key: "z", ctrlKey: true }, view.containerEl);
  await binding.stepped;

  expect(annotations.undo).toHaveBeenCalledExactlyOnceWith("ABCD2345");
  expect(selectedKeys(reader.page)).toEqual(["PUPR5FG5"]);

  annotations.redo.mockReturnValueOnce(Effect.succeed({ kind: "blocked" }));
  annotations.setCapability({
    kind: "read-only",
    reason: "local-api-disabled",
  });
  dispatchKey(view.scope, { key: "y", ctrlKey: true }, view.containerEl);
  await binding.stepped;
  await binding.gestured;

  expect(annotations.redo).toHaveBeenCalledExactlyOnceWith("ABCD2345");
  expect(gestures.reportBlockedGesture).toHaveBeenCalledExactlyOnceWith(
    "ABCD2345",
  );
});

function heldStep() {
  const { promise, resolve } = Promise.withResolvers<HistoryOutcome>();
  const interrupted = vi.fn();
  return {
    step: Effect.promise(() => promise).pipe(
      Effect.onInterrupt(() => Effect.sync(interrupted)),
    ),
    answer: resolve,
    interrupted,
  };
}

const LOST: HistoryOutcome = {
  kind: "failed",
  failure: { kind: "unknown-outcome" },
};

it("lets an undo finish when its PDF view closes, and says nothing of it", async () => {
  const view = pdfView("attachments/rougier-2014.pdf", pdfReader());
  const annotations = annotationReads([HIGHLIGHT]);
  const notifier = testNotifier();
  const { app } = workspace([{ view }]);
  const held = heldStep();
  annotations.undo.mockReturnValueOnce(held.step);

  const service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    notifier,
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  binding.stepHistory("undo");

  service.detach(view);
  const unloaded = service[Symbol.asyncDispose]();
  held.answer(LOST);
  await unloaded;
  await binding.stepped;

  expect(held.interrupted).not.toHaveBeenCalled();
  expect(notifier.notices).toEqual([]);
});

it("answers two fast Annotation History presses one after the other, in order", async () => {
  const view = pdfView("attachments/rougier-2014.pdf", pdfReader());
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);
  const held = heldStep();
  annotations.undo.mockReturnValueOnce(held.step);

  await using service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    ...(await standingDeps()),
  });
  const binding = service.bindings[0]!;
  binding.stepHistory("undo");
  binding.stepHistory("redo");

  expect(annotations.undo).toHaveBeenCalledOnce();
  expect(annotations.redo).not.toHaveBeenCalled();

  held.answer({ kind: "idle" });
  await binding.stepped;
  expect(annotations.redo).toHaveBeenCalledExactlyOnceWith("ABCD2345");
});

it("records a read of the other Attachment an open names in a restored tab", async () => {
  const SHARED = { ...RESOLVED, attachmentKey: "SHRDKEY2" } as const;
  const view = pdfView("attachments/rougier-2014.pdf");
  const { app } = workspace([{ view }]);
  let layoutReady = () => {};
  Object.assign((app as { workspace: object }).workspace, {
    onLayoutReady: (callback: () => void) => {
      layoutReady = callback;
    },
  });
  const attachments = attachmentReads(RESOLVED);
  attachments.resolveFile.mockImplementation((_file, named) =>
    Effect.succeed(
      named?.attachmentKey === SHARED.attachmentKey ? SHARED : RESOLVED,
    ),
  );
  const recordRead = vi.fn();

  await using service = await PdfAnnotationEditor({
    app,
    attachments,
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    recordUse: recordRead,
    now: () => NOW,
    ...(await standingDeps()),
  });
  layoutReady();
  expect(recordRead).not.toHaveBeenCalled();

  const subpath = `#zt-attachment=${SHARED.attachmentKey}`;
  view.fake.navigateTo(subpath);

  expect(service.bindings[0]!.attachment).toMatchObject({
    attachmentKey: SHARED.attachmentKey,
  });
  expect(recordRead.mock.calls.map(([itemKey]) => itemKey)).toEqual([
    RESOLVED.itemKey,
    SHARED.itemKey,
  ]);
});

async function restoredTab(reader: FakeReader) {
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);
  let layoutReady = () => {};
  Object.assign((app as { workspace: object }).workspace, {
    onLayoutReady: (callback: () => void) => {
      layoutReady = callback;
    },
  });
  const recordRead = vi.fn();
  const service = await PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    recordUse: recordRead,
    now: () => NOW,
    ...(await standingDeps()),
  });
  layoutReady();
  return { service, recordRead };
}

it("records no read for the page a restored reader reopens at", async () => {
  const reader = pdfReader();
  const { service, recordRead } = await restoredTab(reader);
  await using _ = service;

  reader.turnPage("restore");

  expect(recordRead).not.toHaveBeenCalled();
});

it("records a read for a page turn after the restored reader's initial view", async () => {
  const reader = pdfReader();
  const { service, recordRead } = await restoredTab(reader);
  await using _ = service;
  reader.turnPage("restore");

  reader.turnPage("user");

  expect(recordRead).toHaveBeenCalledExactlyOnceWith(RESOLVED.itemKey);
});

it("records no read for the page a reader reopens at after its document reloads in place", async () => {
  const reader = pdfReader();
  const { service, recordRead } = await restoredTab(reader);
  await using _ = service;

  reader.reloadDocument();
  reader.turnPage("restore");

  expect(recordRead).not.toHaveBeenCalled();
});

it("records a read for a link turn away from a restored reader's reopen position", async () => {
  const reader = pdfReader();
  const { service, recordRead } = await restoredTab(reader);
  await using _ = service;
  reader.turnPage("restore");

  reader.turnPage("navigate");

  expect(recordRead).toHaveBeenCalledExactlyOnceWith(RESOLVED.itemKey);
});
