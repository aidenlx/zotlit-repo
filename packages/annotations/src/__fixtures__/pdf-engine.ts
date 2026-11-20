import type { Layer } from "effect";

import type { ReaderApi } from "@zotlit/reader-api";

import {
  readerEngineId,
  TESTED_READER_PDFJS_BUILDS,
} from "#obsidian/excerpt-image/engine.ts";
import type { ReaderConnection } from "#obsidian/reader-connection/service.ts";
import { layerReaderConnection } from "#obsidian/reader-connection/service.ts";

export const fakeReaderEngine = readerEngineId(TESTED_READER_PDFJS_BUILDS[0]!);

export interface FakePdfEngine {
  readonly load: ReaderApi["loadDocument"];
}

export function fakePdfEngine(load: ReaderApi["loadDocument"]): FakePdfEngine {
  return { load };
}

export function fakeReaderApi(
  engine: FakePdfEngine,
  pdfjsBuild: string = TESTED_READER_PDFJS_BUILDS[0]!,
): ReaderApi {
  return {
    api: { major: 1, minor: 0 },
    readerVersion: "0.0.0",
    pdfjsBuild,
    viewType: "zotlit-pdf",
    addExtension: () => () => {},
    open: async () => "file-missing",
    readerOf: () => null,
    loadDocument: (source, options) => engine.load(source, options),
    onClose: () => () => {},
  };
}

export function layerReaderLoading(
  engine: FakePdfEngine,
): Layer.Layer<ReaderConnection> {
  const api = fakeReaderApi(engine);
  return layerReaderConnection((handlers) => {
    handlers.onAccept(api);
    return () => {};
  });
}

export const layerReaderRefusingLoads: Layer.Layer<ReaderConnection> =
  layerReaderLoading(
    fakePdfEngine(async () => {
      throw new Error("PDF engine is not available in this test");
    }),
  );
