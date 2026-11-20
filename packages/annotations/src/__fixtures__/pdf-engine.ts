import type { Layer } from "effect";

import type { ReaderApi } from "@zotlit/reader-api";

import type { ReaderConnection } from "#obsidian/reader-connection/service.ts";
import { layerReaderConnection } from "#obsidian/reader-connection/service.ts";

export interface FakePdfEngine {
  readonly load: ReaderApi["loadDocument"];
}

export function fakePdfEngine(load: ReaderApi["loadDocument"]): FakePdfEngine {
  return { load };
}

export function layerReaderLoading(
  engine: FakePdfEngine,
): Layer.Layer<ReaderConnection> {
  const api: ReaderApi = {
    api: { major: 1, minor: 0 },
    readerVersion: "0.0.0",
    pdfjsBuild: "test",
    viewType: "zotlit-pdf",
    addExtension: () => () => {},
    open: async () => "file-missing",
    readerOf: () => null,
    loadDocument: (source, options) => engine.load(source, options),
    onClose: () => () => {},
  };
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
