import { Effect, Layer } from "effect";

import { createPdfEngine } from "@zotlit/pdf-reader";
import { obsidianFetchData } from "@zotlit/pdf-reader/obsidian";

import { PdfEngine } from "./service.ts";

export const layerPdfEngine: Layer.Layer<PdfEngine> = Layer.effect(
  PdfEngine,
  Effect.acquireDisposable(
    Effect.sync(() =>
      createPdfEngine({ idPrefix: "zotlit", fetchData: obsidianFetchData }),
    ),
  ),
);
