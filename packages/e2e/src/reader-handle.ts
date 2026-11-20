import type { View } from "obsidian";

import type { E2eServices } from "@zotlit/obsidian/e2e";
import type { ReaderApi } from "@zotlit/reader-api";
import type { E2eServices as ReaderServices } from "@zotlit/reader/e2e";

import type { PageApp } from "./page-host.ts";

export interface ReaderHandle {
  readonly viewType: string;
  open: ReaderApi["open"];
  setTakeover(on: boolean): Promise<void>;
  views(): View[];
  readerOf: ReaderApi["readerOf"];
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
  const zotlit = () =>
    app.plugins.plugins.zotlit?.services as E2eServices | undefined;
  const registration = (services: E2eServices) => {
    const found = services.pdfReaderPort.registration;
    if (!found) throw new Error("ZotLit has no PDF reader registration");
    return found;
  };
  const api = (): ReaderApi => {
    const services = zotlit();
    if (services) return registration(services).api;
    const found = app.plugins.plugins["zotlit-reader"]?.api as
      | ReaderApi
      | undefined;
    if (!found) throw new Error("ZotLit Reader gives no api");
    return found;
  };
  return {
    get viewType() {
      return api().viewType;
    },
    open: (file, options) => api().open(file, options),
    setTakeover: async (on) => {
      const wanted = on ? "on" : "off";
      const services = zotlit();
      if (services) {
        const { bridge, settings } = services;
        await bridge.runPromise(
          settings.update({ "reader.open-all-pdfs": on }),
        );
        await until(
          `the takeover to turn ${wanted}`,
          () => registration(services).takeover.get() === wanted,
        );
        return;
      }
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
    views: () => {
      const services = zotlit();
      if (services) return [...registration(services).views()];
      const { viewType } = api();
      return app.workspace
        .getLeavesOfType(viewType)
        .filter((leaf) => !leaf.isDeferred)
        .map((leaf) => leaf.view);
    },
    readerOf: (view) => api().readerOf(view),
    loadDocument: (source, options) => api().loadDocument(source, options),
  };
}
