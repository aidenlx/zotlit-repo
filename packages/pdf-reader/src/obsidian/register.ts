import type {
  Observable,
  PdfEngine,
  PdfReader,
  ReaderExtension,
  ReaderHost,
} from "#/core/index.ts";
import type { ObsidianHostContext } from "#/obsidian/layer.ts";
import type { TakeoverState } from "#/obsidian/takeover.ts";
import type { PaneType, Plugin, TFile, View } from "obsidian";

import type { ReaderApi } from "@zotlit/reader-api";

import { createPdfEngine, englishStrings } from "#/core/index.ts";
import { pdfjsBuild } from "#/generated/pdfjs-build.ts";
import { makeReaderApi } from "#/obsidian/api.ts";
import { PdfEmbed } from "#/obsidian/embed.ts";
import { obsidianFetchData } from "#/obsidian/fetch-data.ts";
import { makeLayer } from "#/obsidian/layer.ts";
import { makeTakeover } from "#/obsidian/takeover.ts";
import { PdfReaderView, viewCreator } from "#/obsidian/view.ts";

export interface PdfReaderOptions {
  readonly viewType: string;
  readonly displayName?: string;
  readonly icon?: string;
  readonly engine?: PdfEngine;
  readonly extensions?: readonly ReaderExtension<ObsidianHostContext>[];
  readonly t?: ReaderHost["t"];
  readonly report?: ReaderHost["report"];
}

export interface OpenOptions {
  readonly subpath?: string;
  readonly pane?: PaneType | boolean;
  readonly active?: boolean;
}

export interface PdfReaderRegistration {
  readonly viewType: string;
  readonly engine: PdfEngine;
  readonly takeover: Observable<TakeoverState>;
  setTakeover(on: boolean): TakeoverState;
  open(file: TFile, options?: OpenOptions): Promise<PdfReaderView | null>;
  views(): readonly PdfReaderView[];
  readerOf(view: View | null | undefined): PdfReader | null;
  addExtension(extension: ReaderExtension<ObsidianHostContext>): () => void;
  onClose(listener: () => void): () => void;
  readonly api: ReaderApi;
}

const englishT: ReaderHost["t"] = (key, vars = {}) =>
  Object.entries(vars).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    englishStrings[key],
  );

export function registerPdfReader(
  plugin: Plugin,
  options: PdfReaderOptions,
): PdfReaderRegistration {
  const { app } = plugin;
  const { viewType } = options;
  const owned = new DisposableStack();
  const engine =
    options.engine ??
    owned.use(
      createPdfEngine({
        idPrefix: plugin.manifest.id,
        fetchData: obsidianFetchData,
      }),
    );
  const report: ReaderHost["report"] =
    options.report ??
    ((error, where) => {
      console.error("PDF reader", where, error);
    });
  const layer = makeLayer({
    app,
    viewType,
    displayName: options.displayName ?? "PDF",
    icon: options.icon ?? "lucide-file-text",
    engine,
    extensions: options.extensions ?? [],
    t: options.t ?? englishT,
    report,
    foundOpen: new Set(
      app.workspace
        .getLeavesOfType(viewType)
        .filter((leaf) => !leaf.isDeferred),
    ),
  });
  const takeover = owned.use(
    makeTakeover(app, {
      viewType,
      creator: (context, file, subpath) =>
        new PdfEmbed({ layer, context, file, subpath }),
      report,
    }),
  );
  owned.use(layer);
  const ours = (view: View | null | undefined): view is PdfReaderView =>
    view instanceof PdfReaderView && view.getViewType() === viewType;

  plugin.registerView(viewType, viewCreator(layer));
  plugin.register(() => owned.dispose());

  const registration: Omit<PdfReaderRegistration, "api"> = {
    viewType,
    engine,
    takeover: takeover.state,
    setTakeover: (on) => takeover.set(on),
    open: async (file, open = {}) => {
      const leaf = app.workspace.getLeaf(open.pane ?? false);
      await leaf.setViewState(
        {
          type: viewType,
          state: { file: file.path },
          active: open.active ?? leaf === app.workspace.activeLeaf,
        },
        open.subpath ? { subpath: open.subpath } : undefined,
      );
      return ours(leaf.view) ? leaf.view : null;
    },
    views: () =>
      app.workspace
        .getLeavesOfType(viewType)
        .map((leaf) => leaf.view)
        .filter(ours),
    readerOf: (view) => (ours(view) ? view.reader : null),
    addExtension: (extension) => layer.addExtension(extension),
    onClose: (listener) => layer.onClose(listener),
  };
  return {
    ...registration,
    api: makeReaderApi(registration, {
      readerVersion: plugin.manifest.version,
      pdfjsBuild,
    }),
  };
}
