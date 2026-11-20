import type { ReaderDocument } from "#/core/document/document.ts";
import type { DocumentSource, PdfEngine } from "#/core/engine/engine.ts";
import type { MenuItem, ReaderHost } from "#/core/host.ts";
import type { Subpath } from "#/core/subpath/parse.ts";
import type { PageViewport } from "#/pdfjs.ts";

export interface Observable<T> {
  get(): T;
  subscribe(listener: (value: T, previous: T) => void): () => void;
}

export type SurfaceKind = "view" | "embed" | "hover" | "canvas" | "static";

export type PdfRect = readonly [number, number, number, number];

export interface PageBox {
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly height: string;
}

export interface ReaderPage {
  readonly pageIndex: number;
  readonly div: HTMLDivElement;
  readonly viewport: PageViewport;
  readonly textLayer: HTMLElement | null;
  readonly rendered: boolean;
  layer(
    id: string,
    options?: { readonly order?: "above-text" | "below-text" },
  ): HTMLElement;
  toBox(rect: PdfRect): PageBox;
}

export interface MountOptions<H = unknown> {
  readonly engine: PdfEngine;
  readonly source: DocumentSource;
  readonly host: ReaderHost;
  readonly hostContext: H;
  readonly kind: SurfaceKind;
  readonly subpath?: string | null;
  readonly extensions?: readonly ReaderExtension<H>[];
  readonly deferUntilVisible?: boolean;
}

export type ReaderSlot = "toolbar-start" | "toolbar-end";

export type NavigationTarget =
  | string
  | { readonly pageIndex: number; readonly top?: number }
  | { readonly dest: string };

export type NavigateOutcome =
  | "shown"
  | "no-document"
  | "out-of-range"
  | "unknown-destination"
  | "superseded";

export interface ReaderPosition {
  readonly pageIndex: number;
  readonly subpath: string;
}

export type ReaderZoom =
  | number
  | "page-width"
  | "page-height"
  | "page-fit"
  | "auto";

export interface FindState {
  readonly open: boolean;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly highlightAll: boolean;
  readonly matchDiacritics: boolean;
  readonly entireWord: boolean;
  readonly phase: "idle" | "pending" | "found" | "not-found";
  readonly result: {
    readonly current: number;
    readonly total: number;
    readonly capped: boolean;
  } | null;
}

export type FailureReason =
  | "unreadable"
  | "invalid"
  | "password-cancelled"
  | "engine-disposed";

export interface ReaderState {
  readonly status: "loading" | "password" | "ready" | "failed";
  readonly failure: {
    readonly reason: FailureReason;
    readonly message: string;
  } | null;
  readonly passwordRetry: boolean;
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly pageLabel: string | null;
  readonly hasPageLabels: boolean;
  readonly showPageLabels: boolean;
  readonly zoom: ReaderZoom;
  readonly scale: number;
  readonly spread: "none" | "odd" | "even";
  readonly sidebar: {
    readonly open: boolean;
    readonly panel: "thumbnails" | "outline";
    readonly width: number;
  };
  readonly find: FindState;
  readonly themed: boolean;
}

export interface ReaderIntent {
  readonly zoom?: ReaderZoom;
  readonly spread?: ReaderState["spread"];
  readonly themed?: boolean;
  readonly showPageLabels?: boolean;
  readonly sidebar?: Partial<ReaderState["sidebar"]>;
  readonly find?: Partial<Omit<FindState, "phase" | "result">>;
}

export type ReaderCommand =
  | "zoom-in"
  | "zoom-out"
  | "next-page"
  | "previous-page"
  | "find-next"
  | "find-previous"
  | "escape";

export type PageChangeCause = "restore" | "navigate" | "user";

export interface ReaderEvents {
  document: (event: { readonly document: ReaderDocument | null }) => void;
  ready: (event: {
    readonly document: ReaderDocument;
    readonly first: boolean;
  }) => void;
  "page-rendered": (event: { readonly page: ReaderPage }) => void;
  "page-change": (event: {
    readonly pageIndex: number;
    readonly previous: number;
    readonly cause: PageChangeCause;
  }) => void;
  subpath: (event: { readonly subpath: Subpath }) => void;
  "window-migrated": (event: { readonly window: Window }) => void;
}

export interface PdfReader extends Disposable {
  readonly kind: SurfaceKind;
  readonly root: HTMLElement;
  readonly container: HTMLElement;
  readonly state: Observable<ReaderState>;
  readonly document: Observable<ReaderDocument | null>;
  whenReady(): Promise<ReaderDocument | null>;
  settled(): Promise<void>;
  pageAt(pageIndex: number): ReaderPage | null;
  renderedPages(): readonly ReaderPage[];
  whenRendered(pageIndex: number): Promise<ReaderPage | null>;
  navigate(target: NavigationTarget): Promise<NavigateOutcome>;
  set(intent: ReaderIntent): void;
  command(command: ReaderCommand): boolean;
  redraw(pageIndex?: number): Promise<void>;
  slot(name: ReaderSlot): HTMLElement;
  position(): ReaderPosition | null;
  focus(): void;
  windowMigrated(): void;
  on<K extends keyof ReaderEvents>(
    event: K,
    listener: ReaderEvents[K],
  ): () => void;
}

export interface ExtensionContext<H> {
  readonly reader: PdfReader;
  readonly host: H;
  readonly subpath: Subpath | null;
}

export type ContextTarget =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly pageIndex: number;
      readonly subpath: string;
    }
  | {
      readonly kind: "page";
      readonly pageIndex: number;
      readonly point: readonly [number, number];
    }
  | {
      readonly kind: "pdf-annotation";
      readonly pageIndex: number;
      readonly id: string;
    }
  | { readonly kind: "thumbnail"; readonly pageIndex: number }
  | {
      readonly kind: "outline";
      readonly title: string;
      readonly subpath: string;
    };

export interface ReaderExtension<H = unknown> {
  readonly id: string;
  readonly kinds?: readonly SurfaceKind[];
  drawPage?(page: ReaderPage, layer: HTMLElement, reader: PdfReader): void;
  attach?(context: ExtensionContext<H>): Disposable | void;
  contextMenu?(target: ContextTarget, reader: PdfReader): readonly MenuItem[];
}
