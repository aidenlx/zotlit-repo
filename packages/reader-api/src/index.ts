import type { PaneType, TFile, View } from "obsidian";

export const READER_API = { major: 1, minor: 2 } as const;
export const READER_CSS_PARTS = ["root", "scroller", "toolbar"] as const;

export type ReaderCssPart = (typeof READER_CSS_PARTS)[number];

export interface ReaderApi {
  readonly api: { readonly major: number; readonly minor: number };
  readonly readerVersion: string;
  readonly pdfjsBuild: string;
  readonly viewType: string;
  addExtension(extension: ReaderExtension<ReaderHostContext>): () => void;
  open(file: TFile, options?: OpenOptions): Promise<"opened" | "file-missing">;
  readerOf(view: View | null | undefined): PdfReader | null;
  loadDocument(
    source: DocumentSource,
    options?: LoadOptions,
  ): Promise<HeadlessDocument>;
  onClose(listener: () => void): () => void;
}

export interface RefuseReason {
  readonly supported: readonly number[];
  readonly readerVersion: string;
}

export interface ConnectRequest {
  readonly client: string;
  readonly major: number;
  readonly minor: number;
  accept(api: ReaderApi): void;
  refuse(reason: RefuseReason): void;
}

export interface OpenOptions {
  readonly subpath?: string;
  readonly pane?: PaneType | boolean;
  readonly active?: boolean;
}

export interface LoadOptions {
  readonly password?: string;
  readonly signal?: AbortSignal;
  readonly ownerDocument?: Document;
}

export interface DocumentSource {
  readonly key: string;
  readonly name: string;
  read(signal: AbortSignal): Promise<Uint8Array>;
  watch?(onChange: () => void): () => void;
}

export interface PageViewport {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly rotation: number;
  readonly userUnit: number;
  readonly viewBox: number[];
  readonly transform: number[];
  convertToViewportPoint(x: number, y: number): number[];
  clone(options?: {
    scale?: number;
    rotation?: number;
    offsetX?: number;
    offsetY?: number;
    dontFlip?: boolean;
  }): PageViewport;
}

export interface RenderTask {
  readonly promise: Promise<void>;
  cancel(): void;
  onContinue?: unknown;
}

export interface PdfPage {
  readonly view: number[];
  getViewport(options: {
    scale: number;
    rotation?: number;
    offsetX?: number;
    offsetY?: number;
    dontFlip?: boolean;
  }): PageViewport;
  render(options: {
    canvas: HTMLCanvasElement | null;
    canvasContext?: CanvasRenderingContext2D;
    viewport: PageViewport;
    intent?: string;
  }): RenderTask;
  cleanup(): boolean;
}

export interface TextChar {
  readonly c: string;
  readonly u: string;
  readonly rect: number[];
  readonly fontSize: number;
  readonly fontName: string;
  readonly rotation: number;
  readonly baseline: number;
}

export interface TextItem {
  readonly str: string;
  readonly chars?: TextChar[] | undefined;
}

export interface TextMarkedContent {
  readonly type: string;
}

export interface TextContent {
  readonly items: (TextItem | TextMarkedContent)[];
}

export interface DocumentProxy {
  readonly numPages: number;
  getPageLabels(): Promise<string[] | null>;
}

export interface ReaderDocument {
  readonly proxy: DocumentProxy;
  readonly fingerprint: string;
  readonly key: string;
  current(): boolean;
  bytes(): Promise<Uint8Array | null>;
  page(pageIndex: number): Promise<PdfPage | null>;
  textContent(pageIndex: number): Promise<TextContent | null>;
}

export type HeadlessDocument = ReaderDocument & AsyncDisposable;

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

export interface ReaderSubpath {
  readonly raw: string;
  readonly page: number | null;
  readonly params: ReadonlyMap<string, string>;
}

export interface ReaderState {
  readonly status: "loading" | "password" | "ready" | "failed";
  readonly pageIndex: number;
  readonly pageCount: number;
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

export type PageChangeCause = "restore" | "navigate" | "user";

export interface ReaderEvents {
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
  subpath: (event: { readonly subpath: ReaderSubpath }) => void;
}

export interface PdfReader {
  readonly kind: SurfaceKind;
  readonly root: HTMLElement;
  readonly container: HTMLElement;
  readonly state: Observable<ReaderState>;
  readonly document: Observable<ReaderDocument | null>;
  pageAt(pageIndex: number): ReaderPage | null;
  renderedPages(): readonly ReaderPage[];
  navigate(target: NavigationTarget): Promise<NavigateOutcome>;
  slot(name: ReaderSlot): HTMLElement;
  focus(): void;
  on(event: "ready", listener: ReaderEvents["ready"]): () => void;
  on(
    event: "page-rendered",
    listener: ReaderEvents["page-rendered"],
  ): () => void;
  on(event: "page-change", listener: ReaderEvents["page-change"]): () => void;
  on(event: "subpath", listener: ReaderEvents["subpath"]): () => void;
}

export interface ReaderHostContext {
  readonly kind: SurfaceKind;
  readonly file: TFile;
  readonly view: View | null;
  readonly restored: boolean;
  unloading(): boolean;
}

export interface ExtensionContext<H> {
  readonly reader: PdfReader;
  readonly host: H;
  readonly subpath: ReaderSubpath | null;
}

export interface ReaderExtension<H = ReaderHostContext> {
  readonly id: string;
  readonly kinds?: readonly SurfaceKind[];
  attach?(context: ExtensionContext<H>): Disposable | void;
}

export {
  answerConnect,
  CONNECT_EVENT,
  connectReader,
  READY_EVENT,
} from "./connect.ts";
export type { ConnectHandlers, ConnectOptions } from "./connect.ts";
