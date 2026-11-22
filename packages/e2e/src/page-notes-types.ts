export interface FrameRecord {
  frames: number;
  maxFrameGapMs: number;
  longTasks: number;
  longestTaskMs: number;
  live: boolean;
  observer: PerformanceObserver | null;
}

declare module "./page-helpers.ts" {
  interface PageScratch {
    __zotlitCapabilitySubjects?: string[];
    __zotlitCapabilityFor?: import("@zotlit/obsidian/e2e").E2eServices["annotationRepository"]["capabilityFor"];
    originalOpen?: Window["open"];
    workbenchLaunch?: string | URL;
    pixels?: string[];
    pixelsOff?: () => void;
    __zotlitInsertTrial?: InsertTrial;
    __zotlitDragTrial?: DragTrial;
    pageChanges?: number;
    frames?: FrameRecord;
    notices?: { observers: DisposableStack; values: Map<Element, string> };
  }
}

export type PagePdfReaderView =
  import("@zotlit/pdf-reader/obsidian").PdfReaderView;

export interface BackgroundWindow {
  showInactive(): void;
  isMinimized(): boolean;
  blur(): void;
  getOpacity(): number;
  setOpacity(opacity: number): void;
  once(event: "restore", listener: () => void): void;
}

export interface CodeMirrorElement extends HTMLElement {
  cmTile?: {
    root: {
      view: import("@codemirror/view").EditorView;
    };
  };
}

export type PreparationService =
  import("@zotlit/plugin-kernel/effect.ts").Context.Service.Shape<
    typeof import("@zotlit/annotations/desktop/excerpt-image/prepare.ts").ExcerptPreparation
  >;
export interface PreparationTrial {
  preparation: PreparationService;
  originalPreparation: PreparationService["forCard"];
  started: boolean;
  prepareCalls: number;
  finished: number;
  options: Parameters<PreparationService["forCard"]>[0] | null;
  gate: Promise<void>;
  release: () => void;
}

export type MarkdownLeaf = import("obsidian").WorkspaceLeaf & {
  view: import("obsidian").MarkdownView;
};
export type AnnotationLeaf = import("obsidian").WorkspaceLeaf & {
  view: import("@zotlit/query-views/desktop/annot-view/view.tsx").AnnotationView;
};
export interface InsertTrial extends PreparationTrial {
  layout: ReturnType<import("obsidian").Workspace["getLayout"]>;
  services: import("@zotlit/obsidian/e2e").E2eServices;
  link: import("obsidian").FileManager["generateMarkdownLink"];
  importEnabled: boolean;
  file: import("obsidian").TFile;
  otherFile: import("obsidian").TFile;
  leaf: MarkdownLeaf;
  viewLeaf: AnnotationLeaf;
  view: AnnotationLeaf["view"];
  editor: import("obsidian").Editor;
  assets: number;
  other?: import("obsidian").WorkspaceLeaf;
}
export interface DragTrial extends Omit<
  InsertTrial,
  "otherFile" | "leaf" | "assets"
> {
  mainWin: Window;
  targetLeaf: MarkdownLeaf;
  button: HTMLElement;
  sourceWin: Window & typeof globalThis;
  targetWin: Window & typeof globalThis;
  transfer: DataTransfer;
  nativeTransfer: DataTransfer;
  assetsBeforeStart: number;
  assetsAfterStart: number;
  prepareCallsAfterStart: number;
  activeAtStart: boolean;
  nativeAssetsBefore: number;
  nativeCoords: { x: number; y: number };
  nativePosition: number | null;
  posAtCoords: import("obsidian").Editor["cm"]["posAtCoords"];
  coordinateCalls: {
    coords: { x: number; y: number };
    position: number | null;
  }[];
  expectedCoords: { x: number; y: number };
  directPosition: number | null;
  dropPrevented: boolean;
}

export type FileExplorerView = import("obsidian").View & {
  revealInFolder(file: import("obsidian").TFile): void;
  fileItems: Record<string, { selfEl: HTMLElement }>;
};
