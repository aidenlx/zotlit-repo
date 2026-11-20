import type { PdfPage } from "@zotlit/reader-api";

import type { ExcerptEngine } from "./renderer.ts";

export const OBSIDIAN_PDFJS_ENGINE = "obsidian-pdfjs";

interface PdfJsLib {
  getDocument(options: Record<string, unknown>): {
    promise: Promise<{ getPage(pageNumber: number): Promise<PdfPage> }>;
    destroy(): Promise<void>;
  };
}

export function obsidianPdfJsEngine(
  loadPdfJs: () => Promise<PdfJsLib>,
): ExcerptEngine {
  return {
    id: OBSIDIAN_PDFJS_ENGINE,
    async load(source, options) {
      const signal = options?.signal ?? new AbortController().signal;
      const data = await source.read(signal);
      signal.throwIfAborted();
      const lib = await loadPdfJs();
      signal.throwIfAborted();
      const task = lib.getDocument({
        data,
        password: options?.password,
        cMapUrl: "/lib/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
        wasmUrl: "/lib/pdfjs/wasm/",
        iccUrl: "/lib/pdfjs/iccs/",
        isEvalSupported: false,
      });
      const abort = () => void task.destroy();
      signal.addEventListener("abort", abort, { once: true });
      try {
        const pdf = await task.promise;
        signal.throwIfAborted();
        return {
          page: (pageIndex) => pdf.getPage(pageIndex + 1),
          [Symbol.asyncDispose]: () => task.destroy(),
        };
      } catch (error) {
        await task.destroy();
        throw signal.aborted ? signal.reason : error;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
