import type { GatedRender } from "#__fixtures__/excerpt-image/render-gate.ts";
import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "#obsidian/annotation-repository/service.ts";
import type { ExcerptRendererDiagnosticSnapshot } from "#obsidian/excerpt-image/renderer.ts";
import type {
  ExcerptEntry,
  ExcerptIdentity,
  ExcerptRequest,
} from "#obsidian/excerpt-image/service.ts";
import { Effect } from "effect";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import type { HeadlessDocument } from "@zotlit/pdf-reader";
import { queryClientsFixture } from "@zotlit/plugin-services/core/query-client/__fixtures__.ts";

import { EXCERPT_DISPLAY } from "./display.ts";
import type { ExcerptDisplayDemand, ExcerptImageDisplay } from "./display.ts";
import { excerptKey } from "./key.ts";

import { settledDisplay } from "#__fixtures__/excerpt-image/display-state.ts";
import { ExcerptDisplayFixture } from "#__fixtures__/excerpt-image/display.ts";
import { layerExcerptFiles } from "#__fixtures__/excerpt-image/files.ts";
import { NodeExcerptImageFixture as ExcerptImageService } from "#__fixtures__/excerpt-image/node-service.ts";
import { redPng } from "#__fixtures__/excerpt-image/png.ts";
import { renderGate } from "#__fixtures__/excerpt-image/render-gate.ts";
import { sizedWebp } from "#__fixtures__/excerpt-image/webp.ts";
import {
  fakePdfEngine,
  fakeReaderEngine,
  layerReaderLoading,
} from "#__fixtures__/pdf-engine.ts";
import { PNG_FORMAT, WEBP_FORMAT } from "#core/excerpt-image/format.ts";
import {
  excerptAnnotationRecord,
  excerptFingerprint,
} from "#obsidian/excerpt-image/service.ts";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  open: vi.fn(),
}));

const SOURCE: AnnotationSource = {
  kind: "zotero-db",
  database: { userID: 1, localUserKey: "local", serverID: "server" },
  libraryID: 1,
  libraryRevision: 1,
};

function annotation(color: string, key = "INK1"): AnnotationRecord {
  return {
    key,
    parentKey: "PDF1",
    type: "ink",
    color,
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
    position: { kind: "pdf-ink", pageIndex: 0, width: 2, paths: [[20, 30]] },
  };
}

function request(color: string, key = "INK1"): ExcerptRequest {
  return {
    annotation: annotation(color, key),
    source: SOURCE,
    sourceScope: "/fixture",
    attachmentKey: "PDF1",
    libraryID: 1,
    pdfPath: "/paper.pdf",
    zoteroPngPath: null,
  };
}

function stored(identity: ExcerptRequest): string {
  return excerptAnnotationRecord(identity);
}

function image(byte: number): ExcerptImage {
  return { bytes: new Uint8Array([byte]), format: PNG_FORMAT };
}

interface Live extends AsyncDisposable {
  readonly queries: ReturnType<typeof queryClientsFixture>;
  readonly service: ExcerptImageService;
  readonly display: ExcerptDisplayFixture;
  readonly renders: GatedRender[];
  readonly entries: Map<string, ExcerptEntry>;
  readonly references: Map<string, ExcerptIdentity>;
  card(): ExcerptDisplayDemand;
  started(index: number): Promise<GatedRender>;
  storedRead(index: number): Promise<void>;
  cancelled(index: number): Promise<void>;
  finish(index: number, bytes: number): void;
  fail(index: number): void;
  replacePdf(): void;
}

function harness(): Live {
  const gate = renderGate();
  const entries = new Map<string, ExcerptEntry>();
  const references = new Map<string, ExcerptIdentity>();
  const demands: ExcerptDisplayDemand[] = [];
  const stack = new AsyncDisposableStack();
  let mtimeMs = 1;
  const service = stack.use(
    new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs }),
      render: gate.render,
      read: async () => redPng,
      cache: {
        get: async (key) => entries.get(key),
        put: (key, entry) =>
          Effect.sync(() => {
            entries.set(key, entry);
          }),
        latest: async (identity) => references.get(identity),
        putLatest: async (identity, reference) => {
          references.set(identity, reference);
        },
      },
    }),
  );
  const queries = stack.use(queryClientsFixture());
  const storedReads: Promise<void>[] = [];
  const display = stack.use(
    new ExcerptDisplayFixture({
      queries: queries,
      resolve: (resolveRequest, signal) =>
        service.resolve(resolveRequest, signal),
      stored: (storedRequest) => {
        const read = service.stored(storedRequest);
        storedReads.push(
          read.then(
            () => undefined,
            () => undefined,
          ),
        );
        return read;
      },
    }),
  );
  return {
    queries,
    service,
    display,
    renders: gate.renders,
    entries,
    references,
    card() {
      const demand = display.open();
      demands.push(demand);
      return demand;
    },
    started: gate.started,
    async storedRead(index) {
      await storedReads[index];
    },
    async cancelled(index) {
      const render = await gate.started(index);
      await render.cancelled;
    },
    finish(index, bytes) {
      const render = gate.renders[index]!;
      render.answered = true;
      render.answer.resolve(image(bytes));
    },
    fail(index) {
      const render = gate.renders[index]!;
      render.answered = true;
      render.answer.reject(new Error("PDF render failed"));
    },
    replacePdf() {
      mtimeMs++;
    },
    async [Symbol.asyncDispose]() {
      for (const demand of demands) demand.release();
      await stack.disposeAsync();
    },
  };
}

interface Resident extends AsyncDisposable {
  readonly service: ExcerptImageService;
  readonly card: ExcerptDisplayDemand;
  diagnostics(): ExcerptRendererDiagnosticSnapshot;
  painting(): Promise<void>;
  finish(): void;
}

function resident(): Resident {
  const painting = Promise.withResolvers<void>();
  const painted = Promise.withResolvers<void>();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  vi.mocked(open).mockImplementation(
    async () =>
      ({
        stat: async () => ({ size: bytes.length, mtimeMs: 1 }),
        read: async (
          ...[target, offset, length, position]: [
            Uint8Array,
            number,
            number,
            number,
          ]
        ) => {
          const part = bytes.subarray(position, position + length);
          target.set(part, offset);
          return { bytesRead: part.length, buffer: target };
        },
        close: async () => {},
      }) as unknown as FileHandle,
  );
  const task = { promise: painted.promise, cancel: () => {} };
  const page = {
    view: [0, 0, 100, 50],
    cleanup: () => true,
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
    _intentStates: new Map([
      [
        1,
        { renderTasks: new Set([{ task, _useRequestAnimationFrame: true }]) },
      ],
    ]),
    render: () => {
      painting.resolve();
      return task;
    },
  };
  const engine = fakePdfEngine(
    async () =>
      ({
        page: async () => page,
        [Symbol.asyncDispose]: async () => {},
      }) as unknown as HeadlessDocument,
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      arc: () => {},
      fill: () => {},
    }),
    toBlob: (callback: (blob: Blob) => void) =>
      callback(
        new Blob([
          sizedWebp(canvas.width, canvas.height) as unknown as BlobPart,
        ]),
      ),
  };
  vi.stubGlobal("document", {
    createElement: () => canvas as unknown as HTMLCanvasElement,
  });

  const stack = new AsyncDisposableStack();
  stack.defer(() => {
    vi.unstubAllGlobals();
  });
  const service = stack.use(
    new ExcerptImageService(
      {
        stamp: async () => ({ size: bytes.length, mtimeMs: 1 }),
      },
      layerExcerptFiles(open),
      layerReaderLoading(engine),
    ),
  );
  const queries = stack.use(queryClientsFixture());
  const display = stack.use(
    new ExcerptDisplayFixture({
      queries: queries,
      resolve: (request, signal) => service.resolve(request, signal),
      stored: (storedRequest) => service.stored(storedRequest),
    }),
  );
  const card = display.open();
  stack.defer(() => {
    card.release();
  });
  return {
    service,
    card,
    diagnostics: () => {
      const diagnostics = service.rendererDiagnostics;
      if (!diagnostics) throw new Error("Excerpt renderer unavailable");
      return diagnostics.snapshot();
    },
    painting: () => painting.promise,
    finish: () => painted.resolve(),
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

const painted = (display: ExcerptImageDisplay): boolean =>
  display.status === "settled" && display.current && display.image !== null;

describe("Excerpt Image live display", () => {
  it("paints the image one resolution commits for the demanded pixels", async () => {
    await using live = harness();
    const card = live.card();

    card.demand(request("#ff0000"));
    await live.started(0);
    expect(live.renders).toHaveLength(1);
    expect(card.snapshot()).toEqual({
      image: null,
      current: false,
      status: "reading",
    });

    live.finish(0, 7);
    const display = await settledDisplay(card, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([7]));
    expect(display.current).toBe(true);
  });

  it("keeps painting the previous image while a saved edit replaces it", async () => {
    await using live = harness();
    const card = live.card();
    card.demand(request("#ff0000"));
    await live.started(0);
    live.finish(0, 1);
    const first = await settledDisplay(card, painted);

    const saved = request("#00ff00");
    live.display.revalidate(saved);
    card.demand(saved);
    await live.started(1);
    expect(live.renders).toHaveLength(2);
    expect(card.snapshot()).toEqual({
      image: first.image,
      current: false,
      status: "reading",
    });

    live.finish(1, 2);
    const replaced = await settledDisplay(card, (display) => painted(display));
    expect(replaced.image?.bytes).toEqual(new Uint8Array([2]));
    expect(replaced.current).toBe(true);
  });

  it("publishes the latest saved request through an A→B→A race", async () => {
    await using live = harness();
    const card = live.card();
    const pixels = request("#ff0000");
    card.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    await settledDisplay(card, painted);

    const other = request("#00ff00");
    live.display.revalidate(other);
    card.demand(other);
    await live.started(1);
    live.display.revalidate(pixels);
    card.demand(pixels);
    await live.cancelled(1);
    expect(live.renders).toHaveLength(2);
    expect(live.renders[1]!.aborted).toBe(true);

    live.finish(1, 2);
    const display = await settledDisplay(card, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([1]));
  });

  it("keeps the newer saved demand when an older snapshot arrives late", async () => {
    await using live = harness();
    const newer = live.card();
    const delayed = live.card();
    const saved: ExcerptRequest = {
      ...request("#ff0000"),
      annotation: { ...request("#ff0000").annotation, version: 2 },
    };
    const stale: ExcerptRequest = {
      ...request("#00ff00"),
      annotation: { ...request("#00ff00").annotation, version: 1 },
    };

    newer.demand(saved);
    await live.started(0);
    live.finish(0, 1);
    const first = await settledDisplay(newer, painted);
    expect(first.image?.bytes).toEqual(new Uint8Array([1]));

    delayed.demand(stale);
    expect(live.renders).toHaveLength(1);
    expect(delayed.snapshot()).toEqual({
      image: first.image,
      current: false,
      status: "settled",
    });
    expect(newer.snapshot()).toEqual({
      image: first.image,
      current: true,
      status: "settled",
    });

    const newest: ExcerptRequest = {
      ...request("#0000ff"),
      annotation: { ...request("#0000ff").annotation, version: 3 },
    };
    delayed.demand(newest);
    await live.started(1);
    expect(live.renders).toHaveLength(2);
    live.finish(1, 3);
    const replaced = await settledDisplay(delayed, painted);
    expect(replaced.image?.bytes).toEqual(new Uint8Array([3]));
    expect(replaced.current).toBe(true);
  });

  it("keeps the newer saved pixels when a revalidation carries an older record", async () => {
    await using live = harness();
    const card = live.card();
    const saved: ExcerptRequest = {
      ...request("#ff0000"),
      annotation: { ...request("#ff0000").annotation, version: 2 },
    };
    card.demand(saved);
    await live.started(0);
    live.finish(0, 1);
    const first = await settledDisplay(card, painted);

    const stale: ExcerptRequest = {
      ...request("#00ff00"),
      annotation: { ...request("#00ff00").annotation, version: 1 },
    };
    live.display.revalidate(stale);
    expect(live.renders).toHaveLength(1);
    expect(card.snapshot()).toEqual({
      image: first.image,
      current: true,
      status: "settled",
    });
  });

  it("answers every demand for the same saved pixels with one resolution", async () => {
    await using live = harness();
    const one = live.card();
    const two = live.card();
    const pixels = request("#ff0000");

    one.demand(pixels);
    two.demand(pixels);
    await live.started(0);
    live.display.revalidate(pixels);
    expect(live.renders).toHaveLength(1);

    live.finish(0, 1);
    const [first, second] = await Promise.all([
      settledDisplay(one, painted),
      settledDisplay(two, painted),
    ]);
    expect(first.image?.bytes).toEqual(new Uint8Array([1]));
    expect(second.image?.bytes).toEqual(new Uint8Array([1]));
    expect(live.renders).toHaveLength(1);
  });

  it("keeps the previous image after a failed replacement and reads again on the next saved edit", async () => {
    await using live = harness();
    const card = live.card();
    card.demand(request("#ff0000"));
    await live.started(0);
    live.finish(0, 1);
    const first = await settledDisplay(card, painted);

    const saved = request("#00ff00");
    live.display.revalidate(saved);
    card.demand(saved);
    await live.started(1);
    live.fail(1);
    const failed = await settledDisplay(
      card,
      (display) => display.status === "failed",
    );
    expect(failed.image?.bytes).toEqual(first.image?.bytes);
    expect(failed.current).toBe(false);

    const next = request("#0000ff");
    live.display.revalidate(next);
    card.demand(next);
    await live.started(2);
    expect(live.renders).toHaveLength(3);
    live.finish(2, 3);
    const replaced = await settledDisplay(card, painted);
    expect(replaced.image?.bytes).toEqual(new Uint8Array([3]));
  });

  it("re-resolves the same pixels for the Refresh gesture", async () => {
    await using live = harness();
    const card = live.card();
    const saved = request("#ff0000");
    card.demand(saved);
    await live.started(0);
    live.finish(0, 1);
    expect((await settledDisplay(card, painted)).image?.bytes).toEqual(
      new Uint8Array([1]),
    );

    live.replacePdf();
    live.display.refresh();
    const again = await live.started(1);
    expect(again.request).toEqual(saved);

    live.finish(1, 2);
    const replaced = await settledDisplay(
      card,
      (display) => painted(display) && display.image?.bytes[0] === 2,
    );
    expect(replaced.image?.bytes).toEqual(new Uint8Array([2]));
    expect(replaced.current).toBe(true);
  });

  it("ends a failed read's cooldown when Refresh is asked", async () => {
    await using live = harness();
    const card = live.card();
    card.demand(request("#ff0000"));
    await live.started(0);
    live.fail(0);
    await settledDisplay(card, (display) => display.status === "failed");

    live.display.refresh();
    await live.started(1);
    live.finish(1, 2);
    const recovered = await settledDisplay(card, painted);
    expect(recovered.image?.bytes).toEqual(new Uint8Array([2]));
    expect(recovered.current).toBe(true);
  });

  it("releases one demand alone, and the read with the last demand", async () => {
    await using live = harness();
    const one = live.card();
    const two = live.card();
    one.demand(request("#ff0000"));
    two.demand(request("#ff0000"));
    await live.started(0);
    expect(live.renders).toHaveLength(1);

    one.release();
    expect(live.renders[0]!.aborted).toBe(false);
    live.finish(0, 1);
    const display = await settledDisplay(two, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([1]));

    two.demand(request("#00ff00"));
    await live.started(1);
    expect(live.renders).toHaveLength(2);
    two.release();
    await live.cancelled(1);
    expect(live.renders[1]!.aborted).toBe(true);
    expect(
      live.queries.bridge.runSync(live.queries.keysUnder([EXCERPT_DISPLAY])),
    ).toEqual([]);
  });

  it("stops painting the cleared image on the cards mounted at clear time", async () => {
    await using live = harness();
    const one = live.card();
    const two = live.card();
    const pixels = request("#ff0000");
    one.demand(pixels);
    two.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    const [first, second] = await Promise.all([
      settledDisplay(one, painted),
      settledDisplay(two, painted),
    ]);
    expect(first.image?.bytes).toEqual(new Uint8Array([1]));
    expect(second.image?.bytes).toEqual(new Uint8Array([1]));
    expect(one.snapshot().image?.bytes).toEqual(new Uint8Array([1]));
    expect(two.snapshot().image?.bytes).toEqual(new Uint8Array([1]));

    live.display.clear();
    expect(
      live.queries.bridge.runSync(live.queries.keysUnder([EXCERPT_DISPLAY])),
    ).toEqual([]);
    expect(one.snapshot()).toEqual({
      image: null,
      current: false,
      status: "cleared",
    });
    expect(two.snapshot()).toEqual({
      image: null,
      current: false,
      status: "cleared",
    });

    one.demand(request("#00ff00"));
    await live.started(1);
    live.finish(1, 2);
    const repainted = await settledDisplay(one, painted);
    expect(repainted.image?.bytes).toEqual(new Uint8Array([2]));
  });

  it("resolves a captured note request from its own pixels, never from the display", async () => {
    await using live = harness();
    const card = live.card();
    const pixels = request("#ff0000");
    card.demand(pixels);

    const note = live.service.resolve(request("#ff0000"));
    await live.started(0);
    expect(live.renders).toHaveLength(1);
    card.demand(request("#00ff00"));

    live.finish(0, 1);
    await expect(note).resolves.toMatchObject({
      kind: "available",
      provenance: "rendered",
      bytes: new Uint8Array([1]),
    });
    expect(live.renders[0]!.aborted).toBe(false);

    await live.started(1);
    live.finish(1, 2);
    const display = await settledDisplay(card, painted);
    expect(display.image?.bytes).toEqual(new Uint8Array([2]));

    const later = live.service.resolve(request("#0000ff"));
    await live.started(2);
    expect(live.renders).toHaveLength(3);
    live.finish(2, 9);
    await expect(later).resolves.toMatchObject({
      kind: "available",
      bytes: new Uint8Array([9]),
    });
    expect(card.snapshot().image?.bytes).toEqual(new Uint8Array([2]));
  });

  it("paints the image this device stored while the saved pixels resolve", async () => {
    await using live = harness();
    const shown = live.card();
    const pixels = request("#ff0000");
    shown.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    await settledDisplay(shown, painted);
    expect(live.references.get(stored(pixels))?.fingerprint).toBe(
      excerptFingerprint(pixels.annotation),
    );

    shown.release();
    expect(
      live.queries.bridge.runSync(live.queries.keysUnder([EXCERPT_DISPLAY])),
    ).toEqual([]);

    const returned = live.card();
    const saved = request("#00ff00");
    returned.demand(saved);
    await live.started(1);
    const seeded = await settledDisplay(
      returned,
      (display) => display.image !== null,
    );
    expect(seeded.image?.bytes).toEqual(new Uint8Array([1]));
    expect(seeded.current).toBe(false);
    expect(seeded.status).toBe("reading");

    live.finish(1, 2);
    const replaced = await settledDisplay(returned, painted);
    expect(replaced.image?.bytes).toEqual(new Uint8Array([2]));
    expect(replaced.current).toBe(true);
  });

  it("leaves the stored fallback unread when the Held Read holds an image", async () => {
    await using service = new ExcerptImageService({ read: async () => redPng });
    await using queries = queryClientsFixture();
    const stored = vi.fn(async () => null);
    await using display = new ExcerptDisplayFixture({
      queries: queries,
      resolve: (resolveRequest, signal) =>
        service.resolve(resolveRequest, signal),
      stored,
    });
    const card = display.open();
    const pixels = {
      ...request("#ff0000"),
      pdfPath: null,
      zoteroPngPath: "/zotero/INK1.png",
    };
    card.demand(pixels);
    expect((await settledDisplay(card, painted)).image?.bytes).toEqual(redPng);

    stored.mockClear();
    const saved = {
      ...pixels,
      annotation: { ...pixels.annotation, color: "#00ff00" },
    };
    display.revalidate(saved);
    expect(stored).not.toHaveBeenCalled();
  });

  it("starts a replacement from the stored image when the client dropped the Held Read", async () => {
    await using live = harness();
    live.queries.client.setQueryDefaults([EXCERPT_DISPLAY], { gcTime: 25 });
    const card = live.card();
    const pixels = request("#ff0000");
    vi.useFakeTimers();
    try {
      card.demand(pixels);
      await live.started(0);
      live.finish(0, 1);
      const first = await settledDisplay(card, painted);

      await vi.advanceTimersByTimeAsync(30);
      expect(
        live.queries.bridge.runSync(live.queries.keysUnder([EXCERPT_DISPLAY])),
      ).toEqual([]);
      expect(card.snapshot().image).toBeNull();
      vi.useRealTimers();
      live.queries.client.setQueryDefaults([EXCERPT_DISPLAY], {
        gcTime: 5 * 60 * 1_000,
      });

      live.display.revalidate(request("#00ff00"));
      await live.started(1);
      await vi.waitFor(() => expect(card.snapshot().image).not.toBeNull());
      const held = card.snapshot();
      expect(held.image?.bytes).toEqual(first.image?.bytes);
      expect(held.current).toBe(true);
      expect(held.status).toBe("reading");

      live.fail(1);
      const failed = await settledDisplay(
        card,
        (display) => display.status === "failed",
      );
      expect(failed.image?.bytes).toEqual(first.image?.bytes);
      expect(failed.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces what the store holds for an Annotation nothing displays", async () => {
    await using live = harness();
    const shown = live.card();
    const pixels = request("#ff0000");
    shown.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    await settledDisplay(shown, painted);
    shown.release();

    const saved = request("#00ff00");
    live.display.revalidate(saved);
    await live.storedRead(1);
    await live.started(1);
    live.finish(1, 2);
    await vi.waitFor(() =>
      expect(
        live.entries.get(excerptKey(saved, fakeReaderEngine))?.bytes,
      ).toEqual(new Uint8Array([2])),
    );
    expect(live.references.get(stored(saved))?.fingerprint).toBe(
      excerptFingerprint(saved.annotation),
    );

    const untouched = request("#ff0000", "INK2");
    live.display.revalidate(untouched);
    await live.storedRead(2);
    expect(live.renders).toHaveLength(2);
    expect(live.references.has(stored(untouched))).toBe(false);
  });

  it("replaces a stored-image refresh with the newest saved pixels alone", async () => {
    await using live = harness();
    const shown = live.card();
    const pixels = request("#ff0000");
    shown.demand(pixels);
    await live.started(0);
    live.finish(0, 1);
    await settledDisplay(shown, painted);
    shown.release();

    live.display.revalidate(request("#00ff00"));
    await live.storedRead(1);
    await live.started(1);
    const newest = request("#0000ff");
    live.display.revalidate(newest);
    await live.cancelled(1);
    expect(live.renders[1]!.aborted).toBe(true);
    await live.started(2);

    live.finish(2, 3);
    await vi.waitFor(() =>
      expect(
        live.entries.get(excerptKey(newest, fakeReaderEngine))?.bytes,
      ).toEqual(new Uint8Array([3])),
    );
    expect(live.references.get(stored(newest))?.fingerprint).toBe(
      excerptFingerprint(newest.annotation),
    );
    expect(
      live.entries.has(excerptKey(request("#00ff00"), fakeReaderEngine)),
    ).toBe(false);
  });

  it("holds the renderer for the live read alone, and releases it when the read settles", async () => {
    await using live = resident();
    await live.service.ready;
    expect(live.diagnostics()).toMatchObject({
      jobActive: false,
      fileOpen: false,
      documentOpen: false,
      renderTaskActive: false,
    });

    live.card.demand(request("#ff0000"));
    await live.painting();
    expect(live.diagnostics()).toMatchObject({
      jobActive: true,
      documentOpen: true,
      renderTaskActive: true,
    });
    expect(live.diagnostics().canvas).not.toBeNull();

    live.finish();
    const shown = await settledDisplay(live.card, painted);
    expect(shown.image?.format).toBe(WEBP_FORMAT);
    expect(live.diagnostics()).toMatchObject({
      phase: "idle",
      jobActive: false,
      fileOpen: false,
      documentOpen: false,
      renderTaskActive: false,
      canvas: null,
    });
  });
});
