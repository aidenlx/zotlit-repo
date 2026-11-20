import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { open } from "node:fs/promises";

import { createPdfEngine } from "@zotlit/pdf-reader";
import type { PdfEngine } from "@zotlit/pdf-reader";
import type { FixtureExcerptCase } from "@zotlit/scripts/fixture/spec";

import type { ExcerptRequest } from "./contract.ts";
import type {
  ExcerptRendererDiagnosticSnapshot,
  ExcerptRendererLoads,
} from "./renderer.ts";

import { layerExcerptFiles } from "#__fixtures__/excerpt-image/files.ts";
import { ExcerptRendererFixture } from "#__fixtures__/excerpt-image/renderer.ts";

declare const __EXCERPT_CROP_TRIAL__: {
  readonly pdf: string;
  readonly cases: readonly FixtureExcerptCase[];
};

export interface CropCaseReport {
  readonly id: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly samples: number[][];
}

export interface CropReport {
  readonly cases: CropCaseReport[];
  readonly loads: ExcerptRendererLoads;
  readonly resident: Pick<
    ExcerptRendererDiagnosticSnapshot,
    "documentOpen" | "renderTaskActive" | "canvas"
  >;
  readonly released: Pick<
    ExcerptRendererDiagnosticSnapshot,
    "documentOpen" | "jobActive" | "fileOpen"
  >;
  readonly workers: string[];
  readonly fetches: string[];
  readonly cancelled: {
    readonly held: Pick<
      ExcerptRendererDiagnosticSnapshot,
      "phase" | "jobActive" | "fileOpen" | "documentOpen"
    >;
    readonly outcome: string;
    readonly load: { readonly name: string; readonly reason: unknown } | null;
    readonly after: Pick<
      ExcerptRendererDiagnosticSnapshot,
      "phase" | "jobActive" | "fileOpen" | "documentOpen"
    >;
    readonly retry: CropCaseReport;
    readonly loads: ExcerptRendererLoads;
  };
}

const PDF_PATH = "/fixture/excerpt-rendering.pdf";

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const workers: string[] = [];

function countWorkers(): void {
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      workers.push(options?.name ?? "");
    }
  };
}

function memoryOpen(pdf: Uint8Array): typeof open {
  const handle = {
    stat: async () => ({ size: pdf.length, mtimeMs: 1 }),
    read: async (
      ...[target, offset, length, position]: [
        Uint8Array,
        number,
        number,
        number,
      ]
    ) => {
      const part = pdf.subarray(position, position + length);
      target.set(part, offset);
      return { bytesRead: part.length, buffer: target };
    },
    close: async () => {},
  };
  return (async () => handle) as unknown as typeof open;
}

function request(entry: FixtureExcerptCase, index: number): ExcerptRequest {
  return {
    annotation: {
      key: `EXCERPT${String(index).padStart(2, "0")}`,
      parentKey: "EXCERPT1",
      type: entry.type,
      color: "#ff0000",
      comment: null,
      text: null,
      pageLabel: String(entry.pageIndex + 1),
      tags: [],
      version: null,
      sortIndex: "",
      lock: null,
      position:
        entry.type === "image"
          ? {
              kind: "pdf-rects",
              pageIndex: entry.pageIndex,
              rects: [[...entry.rect!]],
            }
          : {
              kind: "pdf-ink",
              pageIndex: entry.pageIndex,
              width: entry.width!,
              paths: entry.paths!.map((path) => [...path]),
            },
    },
    source: { kind: "zotero-local-api", serverID: "excerpt-crop-trial" },
    sourceScope: "excerpt-crop-trial",
    attachmentKey: "EXCERPT1",
    libraryID: 1,
    pdfPath: PDF_PATH,
    zoteroPngPath: null,
  };
}

async function decode(
  entry: FixtureExcerptCase,
  image: ExcerptImage,
): Promise<CropCaseReport> {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(image.bytes)], { type: image.format.mimeType }),
  );
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trial canvas unavailable");
    context.drawImage(bitmap, 0, 0);
    return {
      id: entry.id,
      mimeType: image.format.mimeType,
      width: bitmap.width,
      height: bitmap.height,
      samples: entry.expected.samples.map(([x, y]) =>
        Array.from(context.getImageData(x, y, 1, 1).data),
      ),
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    bitmap.close();
  }
}

function lifecycle({
  phase,
  jobActive,
  fileOpen,
  documentOpen,
}: ExcerptRendererDiagnosticSnapshot) {
  return { phase, jobActive, fileOpen, documentOpen };
}

async function cancelDuringLoad(
  engine: PdfEngine,
  pdf: Uint8Array,
): Promise<CropReport["cancelled"]> {
  const loading: Promise<unknown>[] = [];
  const observed: Pick<PdfEngine, "load"> = {
    load(source, options) {
      const load = engine.load(source, options);
      loading.push(load);
      return load;
    },
  };
  const entry = __EXCERPT_CROP_TRIAL__.cases[0]!;
  await using renderer = new ExcerptRendererFixture(
    { engine: observed },
    layerExcerptFiles(memoryOpen(pdf)),
  );
  renderer.diagnostics.hold("document-loading");
  const controller = new AbortController();
  const outcome = renderer.render(request(entry, 0), controller.signal).then(
    () => "rendered",
    (error: Error) => error.name,
  );
  while (renderer.diagnostics.snapshot().phase !== "document-loading")
    await new Promise((resolve) => setTimeout(resolve, 5));
  const held = lifecycle(renderer.diagnostics.snapshot());
  controller.abort();
  const settled = await outcome;
  const load = await loading[0]!.then(
    () => null,
    (error: Error & { reason?: unknown }) => ({
      name: error.name,
      reason: error.reason,
    }),
  );
  const after = lifecycle(renderer.diagnostics.snapshot());
  renderer.diagnostics.release();
  const retry = await decode(entry, await renderer.render(request(entry, 0)));
  return {
    held,
    outcome: settled,
    load,
    after,
    retry,
    loads: renderer.diagnostics.snapshot().loads,
  };
}

export async function run(): Promise<CropReport> {
  countWorkers();
  const fetches: string[] = [];
  using engine = createPdfEngine({
    idPrefix: "zotlit",
    fetchData: async (kind, filename) => {
      fetches.push(`${kind}:${filename}`);
      throw new Error(`No PDF.js ${kind} file ${filename} in the crop trial`);
    },
  });
  const pdf = bytes(__EXCERPT_CROP_TRIAL__.pdf);
  const renderer = new ExcerptRendererFixture(
    { engine },
    layerExcerptFiles(memoryOpen(pdf)),
  );
  const cases: CropCaseReport[] = [];
  let resident: CropReport["resident"];
  try {
    for (const [index, entry] of __EXCERPT_CROP_TRIAL__.cases.entries())
      cases.push(
        await decode(entry, await renderer.render(request(entry, index))),
      );
    const { documentOpen, renderTaskActive, canvas } =
      renderer.diagnostics.snapshot();
    resident = { documentOpen, renderTaskActive, canvas };
  } finally {
    await renderer[Symbol.asyncDispose]();
  }
  const snapshot = renderer.diagnostics.snapshot();
  return {
    cases,
    loads: snapshot.loads,
    resident,
    released: {
      documentOpen: snapshot.documentOpen,
      jobActive: snapshot.jobActive,
      fileOpen: snapshot.fileOpen,
    },
    workers,
    fetches,
    cancelled: await cancelDuringLoad(engine, pdf),
  };
}
