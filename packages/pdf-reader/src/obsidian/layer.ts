import type {
  PdfEngine,
  PdfReader,
  ReaderExtension,
  ReaderHost,
  SurfaceKind,
} from "#/core/index.ts";
import type { PdfReaderView } from "#/obsidian/view.ts";
import type { App, Component, TFile, WorkspaceLeaf } from "obsidian";

import { mountReader } from "#/core/index.ts";
import { obsidianHost } from "#/obsidian/host.ts";
import { vaultSource } from "#/obsidian/source.ts";

export interface ObsidianHostContext {
  readonly kind: SurfaceKind;
  readonly app: App;
  readonly file: TFile;
  readonly view: PdfReaderView | null;
  readonly component: Component;
  readonly sourcePath: string | null;
  readonly restored: boolean;
  unloading(): boolean;
}

export interface MountRequest {
  readonly element: HTMLElement;
  readonly kind: SurfaceKind;
  readonly file: TFile;
  readonly view: PdfReaderView | null;
  readonly component: Component;
  readonly sourcePath: string | null;
  readonly restored: boolean;
  readonly subpath: string | null;
}

export interface Mounted extends Disposable {
  readonly reader: PdfReader;
}

export interface ReaderLayer {
  readonly app: App;
  readonly viewType: string;
  readonly displayName: string;
  readonly icon: string;
  readonly engine: PdfEngine;
  readonly t: ReaderHost["t"];
  readonly report: ReaderHost["report"];
  unloading(): boolean;
  claimRestored(leaf: WorkspaceLeaf): boolean;
  mount(request: MountRequest): Mounted | null;
}

export interface LayerOptions {
  readonly app: App;
  readonly viewType: string;
  readonly displayName: string;
  readonly icon: string;
  readonly engine: PdfEngine;
  readonly extensions: readonly ReaderExtension<ObsidianHostContext>[];
  readonly t: ReaderHost["t"];
  readonly report: ReaderHost["report"];
  readonly foundOpen: ReadonlySet<WorkspaceLeaf>;
}

export interface OwnedLayer extends ReaderLayer, Disposable {}

export function makeLayer(options: LayerOptions): OwnedLayer {
  const readers = new Set<PdfReader>();
  const foundOpen = new WeakSet(options.foundOpen);
  let unloading = false;
  const layer: OwnedLayer = {
    app: options.app,
    viewType: options.viewType,
    displayName: options.displayName,
    icon: options.icon,
    engine: options.engine,
    t: options.t,
    report: options.report,
    unloading: () => unloading,
    claimRestored: (leaf) => foundOpen.delete(leaf),
    mount: (request) => {
      if (unloading) return null;
      const { app } = options;
      const reader = mountReader<ObsidianHostContext>(request.element, {
        engine: options.engine,
        source: vaultSource(app, request.file),
        host: obsidianHost(layer, {
          file: request.file,
          sourcePath: request.sourcePath,
          element: request.element,
        }),
        hostContext: {
          kind: request.kind,
          app,
          file: request.file,
          view: request.view,
          component: request.component,
          sourcePath: request.sourcePath,
          restored: request.restored,
          unloading: () => unloading,
        },
        kind: request.kind,
        subpath: request.subpath,
        extensions: options.extensions,
        deferUntilVisible: true,
      });
      readers.add(reader);
      return {
        reader,
        [Symbol.dispose]: () => {
          readers.delete(reader);
          reader[Symbol.dispose]();
        },
      };
    },
    [Symbol.dispose]: () => {
      unloading = true;
      using stack = new DisposableStack();
      for (const reader of readers) stack.use(reader);
      readers.clear();
    },
  };
  return layer;
}
