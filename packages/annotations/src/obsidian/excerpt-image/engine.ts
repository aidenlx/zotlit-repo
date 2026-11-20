import type { ReaderApi } from "@zotlit/reader-api";

import type { ExcerptEngine } from "./renderer.ts";

export const TESTED_READER_PDFJS_BUILDS: readonly string[] = [
  "4ef2758b9684618e14f847615235c29fe1ca16aa",
];

export function readerEngineId(pdfjsBuild: string): string {
  return `zotlit-reader:${pdfjsBuild}`;
}

export function readerEngine(api: ReaderApi): ExcerptEngine | null {
  if (!TESTED_READER_PDFJS_BUILDS.includes(api.pdfjsBuild)) return null;
  return {
    id: readerEngineId(api.pdfjsBuild),
    load: (source, options) => api.loadDocument(source, options),
  };
}
