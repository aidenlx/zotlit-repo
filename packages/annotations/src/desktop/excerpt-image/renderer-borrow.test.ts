import type {
  BorrowedExcerptDocument,
  ExcerptCropPage,
  ExcerptReaderDocuments,
} from "#obsidian/excerpt-image/reader-borrow.ts";
import type {
  ExcerptEntry,
  ExcerptRequest,
} from "#obsidian/excerpt-image/service.ts";
import { Effect } from "effect";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mock } from "vitest";
import { afterEach, expect, it, vi } from "vitest";

import type { HeadlessDocument } from "@zotlit/pdf-reader";

import { excerptKey } from "./key.ts";

import { NodeExcerptImageFixture as ExcerptImageService } from "#__fixtures__/excerpt-image/node-service.ts";
import { sizedWebp } from "#__fixtures__/excerpt-image/webp.ts";
import {
  fakePdfEngine,
  fakeReaderApi,
  fakeReaderEngine,
  layerReaderLoading,
} from "#__fixtures__/pdf-engine.ts";
import { OBSIDIAN_PDFJS_ENGINE } from "#obsidian/excerpt-image/obsidian-pdfjs.ts";
import { layerReaderConnection } from "#obsidian/reader-connection/service.ts";

const obsidian = vi.hoisted(() => ({ loadPdfJs: vi.fn() }));

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadPdfJs: obsidian.loadPdfJs,
}));

const folders: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

const PDF_BYTES = new Uint8Array([1, 2, 3, 4]);
const OTHER_BYTES = new Uint8Array([9, 9, 9, 9]);

const request: ExcerptRequest = {
  annotation: {
    key: "ANNOT001",
    parentKey: "ATTACH01",
    type: "image",
    color: null,
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: null,
    lock: null,
    position: { kind: "pdf-rects", pageIndex: 1, rects: [[10, 20, 80, 90]] },
  },
  source: { kind: "zotero-local-api", serverID: "SERVER" },
  sourceScope: "/zotero",
  libraryID: 1,
  attachmentKey: "ATTACH01",
  pdfPath: "",
  zoteroPngPath: null,
};

function cropPage(
  options: {
    task?: () => { promise: Promise<void>; cancel: () => void };
  } = {},
) {
  const tasks: { promise: Promise<void>; cancel: Mock }[] = [];
  const readerTask = { cancel: vi.fn(), promise: Promise.resolve() };
  const renderTasks = new Set<unknown>([
    { task: readerTask, _useRequestAnimationFrame: true },
  ]);
  const cleanup = vi.fn(() => true);
  const page = {
    view: [0, 0, 612, 792],
    cleanup,
    getViewport: ({
      scale,
      offsetX = 0,
      offsetY = 0,
    }: {
      scale: number;
      offsetX?: number;
      offsetY?: number;
    }) => ({
      convertToViewportPoint: (x: number, y: number): [number, number] => [
        x * scale + offsetX,
        y * scale + offsetY,
      ],
    }),
    render: () => {
      const started = options.task?.() ?? {
        promise: Promise.resolve(),
        cancel: () => undefined,
      };
      const task = { ...started, cancel: vi.fn(started.cancel) };
      tasks.push(task);
      renderTasks.add({ task, _useRequestAnimationFrame: true });
      return task;
    },
  };
  return {
    page: Object.assign(page, {
      _intentStates: new Map([[1, { renderTasks }]]),
    }) as unknown as ExcerptCropPage & { cleanup: Mock },
    tasks,
    readerTask,
    cleanup,
  };
}

function canvasFixture() {
  const canvases: {
    width: number;
    height: number;
    getContext: () => object;
    toBlob: (callback: (blob: Blob) => void) => void;
  }[] = [];
  const canvas = () => {
    const created = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toBlob(callback: (blob: Blob) => void) {
        callback(
          new Blob([sizedWebp(this.width, this.height) as unknown as BlobPart]),
        );
      },
    };
    canvases.push(created);
    return created as unknown as HTMLCanvasElement;
  };
  return { canvas, canvases };
}

type LoadedCropPage = ExcerptCropPage & { cleanup: Mock };

function detachedLibrary(options: { page?: () => LoadedCropPage } = {}) {
  const pages = vi.fn(async (_pageIndex: number) =>
    options.page ? options.page() : cropPage().page,
  );
  const destroy = vi.fn(async () => undefined);
  const load = vi.fn(
    async () =>
      ({
        page: pages,
        [Symbol.asyncDispose]: destroy,
      }) as unknown as HeadlessDocument,
  );
  const engine = fakePdfEngine(load);
  return { load, engine, pages, destroy };
}

function readerDocument(options: {
  bytes: Uint8Array | null;
  page?: (pageIndex: number) => Promise<ExcerptCropPage | null>;
}) {
  const bytes = vi.fn(async () => options.bytes);
  const answered = cropPage();
  const page = vi.fn(options.page ?? (async () => answered.page));
  const current = vi.fn(() => true);
  const borrowed: Omit<BorrowedExcerptDocument, "path"> & { path: string } = {
    path: "",
    document: { name: "reader-document" },
    bytes,
    page,
    current,
  };
  const borrow = vi.fn(() => borrowed);
  const readers: ExcerptReaderDocuments = { borrow };
  return { readers, borrow, borrowed, bytes, page, answered, current };
}

async function sharedPdf(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "zotlit-borrow-shared-"));
  folders.push(folder);
  const path = join(folder, "paper.pdf");
  await writeFile(path, PDF_BYTES);
  return path;
}

async function harness(options: {
  reader?: (path: string) => ExcerptReaderDocuments;
  cache?: Map<string, ExcerptEntry>;
  path?: string;
  detachedPage?: () => LoadedCropPage;
  pdfjsBuild?: string;
}) {
  const cleanup = new AsyncDisposableStack();
  const folder = await mkdtemp(join(tmpdir(), "zotlit-borrow-crop-"));
  folders.push(folder);
  const pdfPath = options.path ?? join(folder, "paper.pdf");
  if (!options.path) await writeFile(pdfPath, PDF_BYTES);
  const entries = options.cache ?? new Map<string, ExcerptEntry>();
  const { canvas, canvases } = canvasFixture();
  const detached = detachedLibrary({ page: options.detachedPage });
  vi.stubGlobal("document", { createElement: canvas });
  const service = cleanup.use(
    new ExcerptImageService(
      {
        cache: {
          get: async (key) => entries.get(key),
          put: (key, entry) =>
            Effect.sync(() => {
              entries.set(key, entry);
            }),
        },
        stamp: async (path) => {
          const info = await stat(path);
          return { size: info.size, mtimeMs: info.mtimeMs };
        },
        readers: options.reader?.(pdfPath),
      },
      undefined,
      options.pdfjsBuild === undefined
        ? layerReaderLoading(detached.engine)
        : layerReaderConnection((handlers) => {
            handlers.onAccept(
              fakeReaderApi(detached.engine, options.pdfjsBuild),
            );
            return () => {};
          }),
    ),
  );
  return {
    service,
    entries,
    canvases,
    detached,
    pdfPath,
    request: { ...request, pdfPath } satisfies ExcerptRequest,
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

function holdingReader(
  reader: ReturnType<typeof readerDocument>,
): (path: string) => ExcerptReaderDocuments {
  return (path) => {
    reader.borrowed.path = path;
    return reader.readers;
  };
}

it("owns its crop canvas and task alone", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ reader: holdingReader(reader) });

  await f.service.resolve(f.request);

  expect(reader.answered.tasks).toHaveLength(1);
  expect(reader.answered.tasks[0]!.cancel).toHaveBeenCalledTimes(1);
  expect(reader.answered.readerTask.cancel).not.toHaveBeenCalled();
});

it("selects the reader's document and publishes under the detached identity", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using borrowed = await harness({ reader: holdingReader(reader) });
  await using detached = await harness({});

  const fromReader = await borrowed.service.resolve(borrowed.request);
  const fromFile = await detached.service.resolve(detached.request);

  if (fromReader.kind !== "available" || fromFile.kind !== "available")
    throw new Error("both sources answer an available image");
  expect(borrowed.detached.load).not.toHaveBeenCalled();
  expect(detached.detached.load).toHaveBeenCalledTimes(1);
  expect(fromReader.format).toEqual(fromFile.format);
  expect(fromReader.identity).toMatchObject({
    key: excerptKey(borrowed.request, fakeReaderEngine),
    fingerprint: fromFile.identity.fingerprint,
  });
  expect([...borrowed.entries.keys()]).toEqual([
    excerptKey(borrowed.request, fakeReaderEngine),
  ]);
  expect([...detached.entries.keys()]).toEqual([
    excerptKey(detached.request, fakeReaderEngine),
  ]);
});

it("serves a later resolution from the entry reader-backed work published", async () => {
  const shared = new Map<string, ExcerptEntry>();
  const path = await sharedPdf();
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using borrowed = await harness({
    cache: shared,
    path,
    reader: holdingReader(reader),
  });

  const fromReader = await borrowed.service.resolve(borrowed.request);

  await using later = await harness({ cache: shared, path });
  const fromCache = await later.service.resolve(later.request);

  expect(fromCache).toMatchObject({ kind: "available", provenance: "cache" });
  expect(later.detached.load).not.toHaveBeenCalled();
  expect([...shared.keys()]).toEqual([
    excerptKey(borrowed.request, fakeReaderEngine),
  ]);
  expect(shared.get(excerptKey(later.request, fakeReaderEngine))).toMatchObject(
    {
      bytes: fromReader.kind === "available" ? fromReader.bytes : undefined,
      format: fromReader.kind === "available" ? fromReader.format : undefined,
    },
  );
});

it.each([
  ["the document holds other bytes", "other-bytes"],
  ["no reader holds the file", "no-reader"],
  ["the reader closed before its page was read", "closed"],
  ["the document answers no bytes", "no-bytes"],
] as const)("renders from the file when %s", async (_case, kind) => {
  const reader = readerDocument({
    bytes:
      kind === "no-bytes"
        ? null
        : kind === "other-bytes"
          ? OTHER_BYTES
          : PDF_BYTES,
    page: kind === "closed" ? async () => null : undefined,
  });
  await using f = await harness({
    reader:
      kind === "no-reader"
        ? () => ({ borrow: () => null })
        : holdingReader(reader),
  });

  expect(await f.service.resolve(f.request)).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([
    excerptKey(f.request, fakeReaderEngine),
  ]);
});

it("renders from the file when a reader open before startup holds bytes the file no longer has", async () => {
  const path = await sharedPdf();
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ path, reader: holdingReader(reader) });
  await writeFile(path, OTHER_BYTES);

  expect(await f.service.resolve(f.request)).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(reader.page).not.toHaveBeenCalled();
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([
    excerptKey(f.request, fakeReaderEngine),
  ]);
});

it("watches a full batch of excerpts borrow the one proven document", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ reader: holdingReader(reader) });

  for (const key of ["ANNOT001", "ANNOT002", "ANNOT003"])
    await f.service.resolve({
      ...f.request,
      annotation: { ...f.request.annotation, key },
    });

  expect(reader.bytes).toHaveBeenCalledTimes(1);
  expect(f.detached.load).not.toHaveBeenCalled();
  expect(f.entries.size).toBe(3);
});

it("generates the requested crop alone, and only once", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ reader: holdingReader(reader) });

  await f.service.resolve({
    ...f.request,
    annotation: {
      ...f.request.annotation,
      position: { kind: "pdf-rects", pageIndex: 3, rects: [[1, 2, 3, 4]] },
    },
  });

  expect(reader.page.mock.calls).toEqual([[3]]);
  expect(f.canvases).toHaveLength(1);
});

it("renders from the file when the reader's page fails under the crop", async () => {
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () =>
      cropPage({
        task: () => ({
          promise: Promise.reject(new Error("Worker was destroyed")),
          cancel: () => undefined,
        }),
      }).page,
  });
  await using f = await harness({ reader: holdingReader(reader) });

  expect(await f.service.resolve(f.request)).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([
    excerptKey(f.request, fakeReaderEngine),
  ]);
});

it("stops waiting on a borrowed byte read that never settles", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  const reading = Promise.withResolvers<Uint8Array | null>();
  reader.bytes.mockImplementation(() => reading.promise);
  await using f = await harness({ reader: holdingReader(reader) });
  const caller = new AbortController();

  const pending = f.service.resolve(f.request, caller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(reader.bytes).toHaveBeenCalledTimes(1));
  caller.abort();

  await rejected;
  await vi.waitFor(() =>
    expect(f.service.queueDiagnostics).toMatchObject({
      rendering: 0,
      queued: 0,
    }),
  );
  expect(reader.page).not.toHaveBeenCalled();
  expect(f.detached.load).not.toHaveBeenCalled();
  expect(f.entries.size).toBe(0);
});

it("reads the file when the reader replaces its document while the page is resolving", async () => {
  const reading = Promise.withResolvers<ExcerptCropPage | null>();
  const withdrawn = cropPage();
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: () => reading.promise,
  });
  await using f = await harness({ reader: holdingReader(reader) });

  const pending = f.service.resolve(f.request);
  await vi.waitFor(() => expect(reader.page).toHaveBeenCalledTimes(1));
  reader.current.mockReturnValue(false);
  reading.resolve(withdrawn.page);

  expect(await pending).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(withdrawn.tasks).toHaveLength(0);
  expect(withdrawn.cleanup).not.toHaveBeenCalled();
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([
    excerptKey(f.request, fakeReaderEngine),
  ]);
});

it("reads the file when the reader replaces its document while the crop draws", async () => {
  const gate = Promise.withResolvers<void>();
  const held = cropPage({
    task: () => ({ promise: gate.promise, cancel: () => undefined }),
  });
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () => held.page,
  });
  await using f = await harness({ reader: holdingReader(reader) });

  const pending = f.service.resolve(f.request);
  await vi.waitFor(() => expect(held.tasks).toHaveLength(1));
  reader.current.mockReturnValue(false);
  gate.resolve();

  expect(await pending).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(held.readerTask.cancel).not.toHaveBeenCalled();
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([
    excerptKey(f.request, fakeReaderEngine),
  ]);
});

it("cancels a borrowed crop when its caller aborts, and publishes nothing", async () => {
  const held = cropPage({
    task: () => ({
      promise: Promise.withResolvers<void>().promise,
      cancel: () => undefined,
    }),
  });
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () => held.page,
  });
  await using f = await harness({ reader: holdingReader(reader) });
  const caller = new AbortController();
  const pending = f.service.resolve(f.request, caller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(held.tasks).toHaveLength(1));

  caller.abort();

  await rejected;
  expect(held.tasks[0]!.cancel).toHaveBeenCalledTimes(1);
  expect(held.readerTask.cancel).not.toHaveBeenCalled();
  expect(f.entries.size).toBe(0);
  expect(f.detached.load).not.toHaveBeenCalled();
});

it("unload cancels a borrowed crop and releases the reader page without publishing", async () => {
  const held = cropPage({
    task: () => ({
      promise: new Promise<void>(() => {}),
      cancel: () => undefined,
    }),
  });
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () => held.page,
  });
  await using f = await harness({ reader: holdingReader(reader) });
  const pending = f.service.resolve(f.request);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(held.tasks).toHaveLength(1));
  await f.service[Symbol.asyncDispose]();
  await rejected;
  expect(held.tasks[0]!.cancel).toHaveBeenCalledTimes(1);
  expect(held.readerTask.cancel).not.toHaveBeenCalled();
  expect(held.cleanup).not.toHaveBeenCalled();
  expect(f.service.rendererDiagnostics?.snapshot()).toMatchObject({
    jobActive: false,
    renderTaskActive: false,
    canvas: null,
  });
  expect(f.entries.size).toBe(0);
  expect(f.detached.load).not.toHaveBeenCalled();
});

it("admits borrowed crops through the shared queue, one at a time", async () => {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const renders: string[] = [];
  const first = cropPage({
    task: () => {
      renders.push("first");
      started.resolve();
      return { promise: gate.promise, cancel: () => undefined };
    },
  });
  const second = cropPage({
    task: () => {
      renders.push("second");
      return { promise: Promise.resolve(), cancel: () => undefined };
    },
  });
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async (pageIndex) => (pageIndex === 1 ? first.page : second.page),
  });
  await using f = await harness({ reader: holdingReader(reader) });

  const held = f.service.resolve(f.request);
  await started.promise;
  const queued = f.service.resolve({
    ...f.request,
    annotation: {
      ...f.request.annotation,
      key: "ANNOT002",
      position: { kind: "pdf-rects", pageIndex: 2, rects: [[10, 20, 80, 90]] },
    },
  });

  expect(renders).toEqual(["first"]);
  gate.resolve();
  expect(await held).toMatchObject({ kind: "available" });
  expect(await queued).toMatchObject({ kind: "available" });
  expect(renders).toEqual(["first", "second"]);
  expect(f.detached.load).not.toHaveBeenCalled();
});

it("gives a waiting PDF its turn after four borrowed crops of another", async () => {
  const pathA = await sharedPdf();
  const pathB = await sharedPdf();
  const started: string[] = [];
  const gates: (() => void)[] = [];
  const heldCrop = (label: string) =>
    cropPage({
      task: () => {
        started.push(label);
        const { promise, resolve } = Promise.withResolvers<void>();
        gates.push(resolve);
        return { promise, cancel: () => undefined };
      },
    }).page;
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () => heldCrop("borrowed"),
  });
  await using f = await harness({
    path: pathA,
    reader: (path) => {
      reader.borrowed.path = path;
      return { borrow: (asked) => (asked === path ? reader.borrowed : null) };
    },
    detachedPage: () => heldCrop("detached"),
  });
  const requests = [
    ...Array.from({ length: 5 }, (_, index) => ({
      ...f.request,
      annotation: { ...f.request.annotation, key: `ANNOT00${index}` },
    })),
    {
      ...f.request,
      attachmentKey: "ATTACH02",
      pdfPath: pathB,
      annotation: { ...f.request.annotation, key: "ANNOTB01" },
    },
  ];

  const jobs = requests.map((request) => f.service.resolve(request));
  await vi.waitFor(() =>
    expect(f.service.queueDiagnostics).toMatchObject({
      rendering: 1,
      queued: 5,
    }),
  );
  const order = [
    "borrowed",
    "borrowed",
    "borrowed",
    "borrowed",
    "detached",
    "borrowed",
  ];
  for (const [index, label] of order.entries()) {
    await vi.waitFor(() => expect(started).toHaveLength(index + 1));
    expect(started[index]).toBe(label);
    gates[index]!();
  }

  expect(await Promise.all(jobs)).toHaveLength(requests.length);
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()].sort()).toEqual(
    requests.map((request) => excerptKey(request, fakeReaderEngine)).sort(),
  );
});

it("draws through Obsidian's pdf.js and leaves the Reader's page alone when the Reader's build is untested", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({
    reader: holdingReader(reader),
    pdfjsBuild: "untested-build",
  });
  const obsidianPage = cropPage();
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ getPage: async () => obsidianPage.page }),
    destroy: async () => undefined,
  }));
  obsidian.loadPdfJs.mockResolvedValue({ getDocument });

  const outcome = await f.service.resolve(f.request);

  expect(outcome).toMatchObject({
    kind: "available",
    provenance: "rendered",
    identity: { key: excerptKey(f.request, OBSIDIAN_PDFJS_ENGINE) },
  });
  expect(reader.borrow).not.toHaveBeenCalled();
  expect(reader.answered.tasks).toHaveLength(0);
  expect(f.detached.load).not.toHaveBeenCalled();
  expect(getDocument).toHaveBeenCalledTimes(1);
  expect(obsidianPage.tasks).toHaveLength(1);
  expect(f.service.rendererDiagnostics?.snapshot()).toMatchObject({
    engine: OBSIDIAN_PDFJS_ENGINE,
    loads: { borrowed: 0, detached: 1 },
  });
});
