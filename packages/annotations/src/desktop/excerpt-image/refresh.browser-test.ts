import type { GatedRender } from "#__fixtures__/excerpt-image/render-gate.ts";
import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { ExcerptRequest } from "#obsidian/excerpt-image/contract.ts";
import type { ExcerptEntry } from "#obsidian/excerpt-image/service.ts";
import type { ExcerptStore } from "#obsidian/excerpt-image/store.ts";
import { Effect } from "effect";

import { queryClientsFixture } from "@zotlit/plugin-services/core/query-client/__fixtures__.ts";

import { EXCERPT_DISPLAY } from "./display.ts";
import type { ExcerptDisplayDemand, ExcerptImageDisplay } from "./display.ts";
import { excerptKey } from "./key.ts";

import { check } from "#__fixtures__/excerpt-image/check.ts";
import { settledDisplay } from "#__fixtures__/excerpt-image/display-state.ts";
import { ExcerptDisplayFixture } from "#__fixtures__/excerpt-image/display.ts";
import { encodeExcerptImage } from "#__fixtures__/excerpt-image/encode.ts";
import { renderGate } from "#__fixtures__/excerpt-image/render-gate.ts";
import { ExcerptImageFixture as ExcerptImageService } from "#__fixtures__/excerpt-image/service.ts";
import { fakeReaderEngine } from "#__fixtures__/pdf-engine.ts";
import { EXCERPT_JOB_LIMIT } from "#core/excerpt-image/pdf-queue.ts";
import { excerptAnnotationRecord } from "#obsidian/excerpt-image/contract.ts";
import { openExcerptStore } from "#obsidian/excerpt-image/store.ts";

export interface RefreshReport {
  passed: string[];
  bytes: {
    budget: number;
    crop: number;
    retained: number;
  };
  queue: { admitted: number; awaiting: number; limit: number };
  references: number;
  crops: number;
}

async function bounded<T>(
  label: string,
  work: Promise<T>,
  onStall?: () => unknown,
): Promise<T> {
  const stalled = Promise.withResolvers<never>();
  const timer = setTimeout(
    () =>
      stalled.reject(
        new Error(
          `Stalled waiting for ${label}: ${JSON.stringify(onStall?.() ?? null)}`,
        ),
      ),
    15_000,
  );
  try {
    return await Promise.race([work, stalled.promise]);
  } finally {
    clearTimeout(timer);
  }
}

const SOURCE = {
  kind: "zotero-db",
  database: { userID: 1, localUserKey: "LOCAL", serverID: "SERVER" },
  libraryID: 1,
  libraryRevision: 1,
} as const;

const PDF = { size: 100, mtimeMs: 10 };

function request(color: string, key = "INK1"): ExcerptRequest {
  return {
    annotation: {
      key,
      parentKey: "ATTACH01",
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
    },
    source: SOURCE,
    sourceScope: "/zotero",
    attachmentKey: "ATTACH01",
    libraryID: 1,
    pdfPath: "/paper.pdf",
    zoteroPngPath: null,
  };
}

let crops = 0;

async function crop(seed: number): Promise<ExcerptImage> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 120;
  const paint = canvas.getContext("2d", { alpha: false });
  if (!paint) throw new Error("Canvas context unavailable");
  paint.fillStyle = "#ffffff";
  paint.fillRect(0, 0, canvas.width, canvas.height);
  paint.fillStyle = "#20242a";
  for (let row = 0; row < 12; row++)
    paint.fillRect(6, 6 + row * 9, canvas.width - 12 - ((row * seed) % 33), 3);
  paint.strokeStyle = "#b03030";
  paint.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  const image = await encodeExcerptImage(canvas, new AbortController().signal);
  crops++;
  return image;
}

interface Live {
  readonly store: ExcerptStore;
  readonly service: ExcerptImageService;
  readonly display: ExcerptDisplayFixture;
  readonly queries: ReturnType<typeof queryClientsFixture>;
  readonly renders: GatedRender[];
  started(index: number): Promise<GatedRender>;
  storedRead(index: number): Promise<void>;
  answer(index: number, seed: number): Promise<void>;
  fail(index: number): Promise<void>;
  close(): Promise<void>;
}

async function live(options: {
  appId: string;
  label: string;
  budget?: number;
}): Promise<Live> {
  const stage = options.label;
  const store = await openExcerptStore(options.appId, options.budget);
  const gate = renderGate();
  const storedReads: Promise<void>[] = [];
  const storedWaiting: (() => void)[] = [];
  const service = new ExcerptImageService({
    cache: store,
    stamp: async () => PDF,
    render: gate.render,
  });
  const queries = queryClientsFixture();
  const display = new ExcerptDisplayFixture({
    queries: queries,
    resolve: (request, signal) => service.resolve(request, signal),
    stored: (request) => {
      const read = service.stored(request);
      storedReads.push(
        read.then(
          () => undefined,
          () => undefined,
        ),
      );
      for (const arrived of storedWaiting.splice(0)) arrived();
      return read;
    },
  });
  await Promise.all([service.ready, display.ready]);
  const app: Live = {
    store,
    service,
    display,
    queries,
    renders: gate.renders,
    async started(index) {
      return await bounded(
        `${stage}: crop ${index}`,
        gate.started(index),
        () => ({
          renders: gate.renders.length,
          queue: service.queueDiagnostics,
        }),
      );
    },
    async storedRead(index) {
      while (storedReads.length <= index) {
        const arrived = Promise.withResolvers<void>();
        storedWaiting.push(() => arrived.resolve());
        await bounded(`${stage}: stored read ${index}`, arrived.promise);
      }
      await bounded(`${stage}: stored read ${index}`, storedReads[index]!);
    },
    async answer(index, seed) {
      (await app.started(index)).answer.resolve(await crop(seed));
    },
    async fail(index) {
      (await app.started(index)).answer.reject(new Error("crop failed"));
    },
    async close() {
      await display[Symbol.asyncDispose]();
      await queries[Symbol.asyncDispose]();
      await service[Symbol.asyncDispose]();
      store[Symbol.dispose]();
    },
  };
  return app;
}

function settled(
  label: string,
  card: ExcerptDisplayDemand,
  matches: (display: ExcerptImageDisplay) => boolean,
): Promise<ExcerptImageDisplay> {
  return bounded(`the display of ${label}`, settledDisplay(card, matches), () =>
    JSON.stringify(card.snapshot()),
  );
}

const shows = (display: ExcerptImageDisplay): boolean =>
  display.image !== null && display.current;

async function held(
  app: Live,
  reference: ExcerptRequest,
): Promise<ExcerptEntry | undefined> {
  const latest = await app.store.latest(excerptAnnotationRecord(reference));
  return latest && (await app.store.get(latest.key, latest.pdf ?? undefined));
}

export async function run(): Promise<RefreshReport> {
  const passed: string[] = [];
  const bytes = { budget: 0, crop: 0, retained: 0 };
  let queue = { admitted: 0, awaiting: 0, limit: EXCERPT_JOB_LIMIT };
  let references = 0;

  {
    const app = await live({ appId: "refresh-baseline", label: "baseline" });
    try {
      const pixels = request("#ff0000");
      const pending = app.service.resolve(pixels);
      await app.answer(0, 0);
      const outcome = await bounded("baseline: one resolution", pending);
      check(
        outcome.kind === "available" && outcome.provenance === "rendered",
        `A resolution answered ${JSON.stringify(outcome.kind)}`,
      );
      const stored = await bounded(
        "baseline: the stored crop",
        app.service.resolve(pixels),
      );
      check(
        stored.kind === "available" && stored.provenance === "cache",
        `The stored crop answered ${JSON.stringify(stored)}`,
      );
      check(
        (await app.store.latest(excerptAnnotationRecord(pixels)))?.key ===
          excerptKey(pixels, fakeReaderEngine),
        "A resolution left no reference to the image it stored",
      );
      passed.push("one resolution over the real store");
    } finally {
      await app.close();
    }
  }

  {
    const app = await live({ appId: "refresh", label: "inactive" });
    try {
      const card = app.display.open();
      card.demand(request("#ff0000"));
      await app.answer(0, 1);
      const first = await settled("the first card", card, shows);
      check(first.image !== null, "The first crop never reached the card");
      check(
        (await app.store.latest(excerptAnnotationRecord(request("#ff0000"))))
          ?.key === excerptKey(request("#ff0000"), fakeReaderEngine),
        "A displayed image left no reference",
      );

      card.release();
      check(
        app.queries.bridge.runSync(app.queries.keysUnder([EXCERPT_DISPLAY]))
          .length === 0,
        "A released card left its Held Read behind",
      );

      const saved = request("#00ff00");
      app.display.revalidate(saved);
      await app.storedRead(1);
      await app.answer(1, 2);
      check(
        (await held(app, saved)) !== undefined,
        "The inactive replacement stored no image",
      );
      check(
        (await app.store.latest(excerptAnnotationRecord(saved)))?.key ===
          excerptKey(saved, fakeReaderEngine),
        "The inactive replacement left the reference behind",
      );
      queue = { ...app.service.queueDiagnostics, limit: EXCERPT_JOB_LIMIT };
      check(
        queue.admitted <= queue.limit,
        `The replacements exceeded the admission bound: ${queue.admitted}`,
      );
      check(queue.awaiting === 0, "A settled queue is still waiting on slots");

      const untouched = request("#ff0000", "INK2");
      app.display.revalidate(untouched);
      await app.storedRead(2);
      check(
        app.renders.length === 2,
        `An Annotation that was never displayed was replaced: ${app.renders.length} crops`,
      );
      check(
        (await app.store.latest(excerptAnnotationRecord(untouched))) ===
          undefined,
        "An Annotation that was never displayed has a reference",
      );
      passed.push("inactive replacement through the shared queue");
    } finally {
      await app.close();
    }
  }

  {
    const app = await live({ appId: "refresh", label: "restart" });
    try {
      const card = app.display.open();
      const saved = request("#0000ff");
      card.demand(saved);
      await app.answer(0, 3);
      const seeded = await settled(
        "the restarted card",
        card,
        (display) => display.image !== null,
      );
      const previous = await held(app, request("#00ff00"));
      check(
        previous !== undefined,
        "The restarted store lost the image it had stored",
      );
      check(
        seeded.current === false,
        "A restarted display claimed the stored pixels were the saved ones",
      );
      const painted = seeded.image?.bytes;
      check(
        painted !== undefined &&
          painted.byteLength === previous.bytes.byteLength &&
          painted.every((byte, index) => byte === previous.bytes[index]) &&
          seeded.status === "reading",
        "A restarted display painted other bytes than the store holds",
      );

      const replaced = await settled("the replaced card", card, shows);
      check(replaced.image !== null, "The current crop never reached the card");
      check(
        (await app.store.latest(excerptAnnotationRecord(saved)))?.key ===
          excerptKey(saved, fakeReaderEngine),
        "The current crop left the reference behind",
      );
      card.release();
      passed.push("restart paints the stored image, then replaces it");
    } finally {
      await app.close();
    }
  }

  {
    const measured = await crop(4);
    bytes.crop = measured.bytes.byteLength;
    bytes.budget = bytes.crop * 2;
    const app = await live({
      appId: "refresh-budget",
      label: "budget",
      budget: bytes.budget,
    });
    try {
      const oldest = request("#ff0000");
      await Effect.runPromise(
        app.store.put(excerptKey(oldest, fakeReaderEngine), {
          bytes: measured.bytes,
          format: measured.format,
          pdf: PDF,
        }),
      );
      await app.store.putLatest(excerptAnnotationRecord(oldest), {
        key: excerptKey(oldest, fakeReaderEngine),
        fingerprint: "F1",
        pdf: PDF,
      });
      check(
        (await app.store.latest(excerptAnnotationRecord(oldest)))?.key ===
          excerptKey(oldest, fakeReaderEngine),
        "A reference did not survive its own write",
      );

      for (const [index, key] of Array.from(
        { length: 40 },
        (_, index) => `INK${index}`,
      ).entries())
        await app.store.putLatest(`identity-${key}`, {
          key: `key-${key}`,
          fingerprint: `F${index}`,
          pdf: null,
        });
      await Effect.runPromise(
        app.store.put("replacement", {
          bytes: measured.bytes,
          format: measured.format,
          pdf: PDF,
        }),
      );
      check(
        (await app.store.get("replacement")) !== undefined,
        "References charged the image budget",
      );

      await Effect.runPromise(
        app.store.put("newest", {
          bytes: measured.bytes,
          format: measured.format,
          pdf: PDF,
        }),
      );
      check(
        (await app.store.get(excerptKey(oldest, fakeReaderEngine))) ===
          undefined &&
          (await app.store.latest(excerptAnnotationRecord(oldest))) ===
            undefined,
        "Eviction kept the oldest image or its reference",
      );
      check(
        (await app.store.get("newest")) !== undefined,
        "Eviction took the newest image",
      );
      const kept = await Promise.all(
        [excerptKey(oldest, fakeReaderEngine), "replacement", "newest"].map(
          (key) => app.store.get(key),
        ),
      );
      bytes.retained = kept.reduce(
        (total, entry) => total + (entry?.bytes.byteLength ?? 0),
        0,
      );
      const standing = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          app.store.latest(`identity-INK${index}`),
        ),
      );
      references = standing.filter(
        (reference) => reference !== undefined,
      ).length;
      check(
        references === 40,
        `Eviction pruned references it did not evict: ${references}`,
      );
      passed.push("eviction, references, and image byte accounting");
    } finally {
      await app.close();
    }
  }

  {
    const app = await live({ appId: "refresh-clear", label: "clear" });
    try {
      const card = app.display.open();
      card.demand(request("#ff0000"));
      await app.answer(0, 5);
      await settled("the cleared card", card, shows);

      const running = app.service.resolve(request("#00ff00"));
      await app.started(1);
      const queued = app.service.resolve(request("#0000ff"));
      check(
        app.service.queueDiagnostics.admitted === 1,
        `The queued crop was admitted while one ran: ${app.service.queueDiagnostics.admitted}`,
      );

      app.display.clear();
      await app.service.clear();
      check(
        app.queries.bridge.runSync(app.queries.keysUnder([EXCERPT_DISPLAY]))
          .length === 0,
        "A cleared display kept its Held Read",
      );
      check(
        card.snapshot().image === null,
        "A card mounted at clear time went on painting the cleared image",
      );

      await app.answer(1, 6);
      await app.answer(2, 7);
      await Promise.all([running, queued]);
      for (const color of ["#ff0000", "#00ff00", "#0000ff"]) {
        const pixels = request(color);
        check(
          (await app.store.get(excerptKey(pixels, fakeReaderEngine))) ===
            undefined &&
            (await app.store.latest(excerptAnnotationRecord(pixels))) ===
              undefined,
          `A clear left ${color} behind`,
        );
      }

      const after = app.display.open();
      after.demand(request("#ff0000"));
      await app.storedRead(1);
      check(
        after.snapshot().image === null,
        "A cleared image came back to a new card",
      );
      after.release();
      card.release();
      passed.push("clear races with running and queued crop work");
    } finally {
      await app.close();
    }
  }

  return { passed, bytes, queue, references, crops };
}
