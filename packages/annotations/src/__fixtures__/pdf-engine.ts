import { Layer } from "effect";

import type { PdfEngine as ReaderPdfEngine } from "@zotlit/pdf-reader";

import { PdfEngine } from "#obsidian/pdf-engine/service.ts";

export function fakePdfEngine(load: ReaderPdfEngine["load"]): ReaderPdfEngine {
  return PdfEngine.of({ load, [Symbol.dispose]() {} });
}

export const layerNoPdfEngine: Layer.Layer<PdfEngine> = Layer.succeed(
  PdfEngine,
  fakePdfEngine(async () => {
    throw new Error("PDF engine is not available in this test");
  }),
);
