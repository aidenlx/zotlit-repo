import type { TFile } from "obsidian";

import type {
  PdfReaderRegistration,
  PdfReaderView,
} from "@zotlit/pdf-reader/obsidian";
import type { ReaderApi } from "@zotlit/reader-api";
import type { E2eServices as ReaderServices } from "@zotlit/reader/e2e";

import type { PageApp } from "./page-host.ts";

export const READER_VIEW_TYPE = "zotlit-pdf";

export interface ReaderHandle {
  readonly viewType: string;
  open: ReaderApi["open"];
  openNew(
    cleanup: AsyncDisposableStack,
    file: TFile,
    options?: Parameters<ReaderApi["open"]>[1],
  ): Promise<PdfReaderView>;
  takeover(): boolean;
  setTakeover(on: boolean): Promise<void>;
  withTakeover(cleanup: AsyncDisposableStack, on: boolean): Promise<void>;
  views(): PdfReaderView[];
  readerOf: PdfReaderRegistration["readerOf"];
  loadDocument: ReaderApi["loadDocument"];
}

export function createReaderHandle(
  app: PageApp,
  until: (
    what: string,
    ok: () => boolean,
    timeout?: number,
  ) => Promise<unknown>,
): ReaderHandle {
  const api = (): ReaderApi => {
    const found = app.plugins.plugins["zotlit-reader"]?.api as
      | ReaderApi
      | undefined;
    if (!found) throw new Error("ZotLit Reader gives no api");
    return found;
  };
  const handle: ReaderHandle = {
    get viewType() {
      return api().viewType;
    },
    open: (file, options) => api().open(file, options),
    openNew: async (cleanup, file, options) => {
      const known = new Set(handle.views());
      cleanup.defer(() => {
        for (const view of handle.views())
          if (!known.has(view) && view.file === file) view.leaf.detach();
      });
      await api().open(file, options);
      let opened: PdfReaderView | undefined;
      await until(`${file.path} in a new reader view`, () => {
        opened = handle
          .views()
          .find((view) => !known.has(view) && view.file === file);
        return opened !== undefined;
      });
      return opened!;
    },
    takeover: () => app.viewRegistry.typeByExtension.pdf !== "pdf",
    setTakeover: async (on) => {
      const wanted = on ? "on" : "off";
      const reader = app.plugins.plugins["zotlit-reader"]?.services as
        | ReaderServices
        | undefined;
      if (!reader) throw new Error("ZotLit Reader is not loaded");
      await reader.bridge.runPromise(
        reader.settings.update({ "reader.open-all-pdfs": on }),
      );
      await until(
        `the takeover to turn ${wanted}`,
        () => (app.viewRegistry.typeByExtension.pdf === "pdf") !== on,
      );
    },
    withTakeover: async (cleanup, on) => {
      const before = handle.takeover();
      cleanup.defer(() => handle.setTakeover(before));
      await handle.setTakeover(on);
    },
    views: () => {
      const { viewType } = api();
      return app.workspace
        .getLeavesOfType(viewType)
        .filter((leaf) => !leaf.isDeferred)
        .map((leaf) => leaf.view as PdfReaderView);
    },
    readerOf: (view) =>
      api().readerOf(view) as ReturnType<PdfReaderRegistration["readerOf"]>,
    loadDocument: (source, options) => api().loadDocument(source, options),
  };
  return handle;
}
