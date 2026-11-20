import type { FixtureExcerptCase } from "@zotlit/scripts/fixture/spec";

import type { CropCaseReport } from "./crop.browser-test.ts";
import { bytes, decode, memoryOpen, request } from "./crop.browser-test.ts";
import { obsidianPdfJsEngine } from "./obsidian-pdfjs.ts";
import type { ExcerptRendererLoads } from "./renderer.ts";

import { layerExcerptFiles } from "#__fixtures__/excerpt-image/files.ts";
import { ExcerptRendererFixture } from "#__fixtures__/excerpt-image/renderer.ts";

declare const __OBSIDIAN_PDFJS_TRIAL__: {
  readonly pdf: string;
  readonly cases: readonly FixtureExcerptCase[];
  readonly lib: string;
  readonly worker: string;
};

export interface ObsidianPdfJsReport {
  readonly version: string;
  readonly engine: string;
  readonly cases: CropCaseReport[];
  readonly loads: ExcerptRendererLoads;
  readonly released: boolean;
  readonly cancelled: { readonly outcome: string; readonly retry: string };
}

interface ObsidianPdfJs {
  readonly version: string;
  readonly GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: Record<string, unknown>): {
    promise: Promise<never>;
    destroy(): Promise<void>;
  };
}

let library: Promise<ObsidianPdfJs> | null = null;

function loadPdfJs(): Promise<ObsidianPdfJs> {
  library ??= (async () => {
    const loaded = (await import(
      /* @vite-ignore */ __OBSIDIAN_PDFJS_TRIAL__.lib
    )) as ObsidianPdfJs;
    loaded.GlobalWorkerOptions.workerSrc = __OBSIDIAN_PDFJS_TRIAL__.worker;
    return loaded;
  })();
  return library;
}

export async function run(): Promise<ObsidianPdfJsReport> {
  const engine = obsidianPdfJsEngine(loadPdfJs);
  const pdf = bytes(__OBSIDIAN_PDFJS_TRIAL__.pdf);
  const renderer = new ExcerptRendererFixture(
    { engine },
    layerExcerptFiles(memoryOpen(pdf)),
  );
  const cases: CropCaseReport[] = [];
  try {
    for (const [index, entry] of __OBSIDIAN_PDFJS_TRIAL__.cases.entries())
      cases.push(
        await decode(entry, await renderer.render(request(entry, index))),
      );
  } finally {
    await renderer[Symbol.asyncDispose]();
  }
  const snapshot = renderer.diagnostics.snapshot();

  const entry = __OBSIDIAN_PDFJS_TRIAL__.cases[0]!;
  await using held = new ExcerptRendererFixture(
    { engine },
    layerExcerptFiles(memoryOpen(pdf)),
  );
  held.diagnostics.hold("document-loading");
  const controller = new AbortController();
  const outcome = held.render(request(entry, 0), controller.signal).then(
    () => "rendered",
    (error: Error) => error.name,
  );
  while (held.diagnostics.snapshot().phase !== "document-loading")
    await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  const settled = await outcome;
  held.diagnostics.release();
  const retry = await held.render(request(entry, 0)).then(
    (image) => image.format.mimeType,
    (error: Error) => error.name,
  );

  return {
    version: (await loadPdfJs()).version,
    engine: held.engine.id,
    cases,
    loads: snapshot.loads,
    released: !snapshot.documentOpen && !snapshot.jobActive,
    cancelled: { outcome: settled, retry },
  };
}
