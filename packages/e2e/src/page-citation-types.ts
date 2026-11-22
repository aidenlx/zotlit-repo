import type { Profiler } from "node:inspector";
import type { Editor, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

import type { ReferencesView } from "@zotlit/citations/desktop/references/view.tsx";
import type { AnnotationView } from "@zotlit/query-views/desktop/annot-view/view.tsx";

export type { FileScan } from "@zotlit/citations/core/citation-index/store.ts";

type WorkerAttached = { targetInfo: { title: string }; sessionId: string };
export type DebugListener = (
  event: unknown,
  method: string,
  params: WorkerAttached,
) => void;

export interface PageDebugger {
  isAttached(): boolean;
  attach(version: string): void;
  detach(): void;
  sendCommand(
    method: "Performance.getMetrics",
  ): Promise<{ metrics: { name: string; value: number }[] }>;
  sendCommand(method: "Profiler.stop"): Promise<{ profile: Profiler.Profile }>;
  sendCommand(
    method: string,
    parameters?: object,
    sessionId?: string,
  ): Promise<unknown>;
  on(event: "message", listener: DebugListener): void;
  removeListener(event: "message", listener: DebugListener): void;
}

export interface CitationScanScratch {
  cleanup: AsyncDisposableStack;
  annotations?: WorkspaceLeaf & { view: AnnotationView };
  file?: TFile;
  leaf?: WorkspaceLeaf & { view: MarkdownView };
  editor?: Editor;
  references?: WorkspaceLeaf & { view: ReferencesView };
  sessions: string[];
}

declare module "./page-helpers.ts" {
  interface PageScratch {
    citationScan?: CitationScanScratch;
  }
}
