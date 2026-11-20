import type { PdfReaderRegistration } from "#/obsidian/register.ts";

import type { ReaderApi } from "@zotlit/reader-api";
import { READER_API } from "@zotlit/reader-api";

export interface ReaderBuild {
  readonly readerVersion: string;
  readonly pdfjsBuild: string;
}

export function makeReaderApi(
  registration: Omit<PdfReaderRegistration, "api">,
  build: ReaderBuild,
): ReaderApi {
  return {
    api: { major: READER_API.major, minor: READER_API.minor },
    readerVersion: build.readerVersion,
    pdfjsBuild: build.pdfjsBuild,
    viewType: registration.viewType,
    addExtension: (extension) => registration.addExtension(extension),
    open: async (file, options) =>
      (await registration.open(file, options)) === null
        ? "file-missing"
        : "opened",
    readerOf: (view) => registration.readerOf(view),
    loadDocument: (source, options) =>
      registration.engine.load(source, options),
    onClose: (listener) => registration.onClose(listener),
  };
}
