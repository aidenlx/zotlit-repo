// Page state retained between excerpt acceptance callbacks.

import type { ExcerptRequest } from "@zotlit/annotations/obsidian/excerpt-image/contract.ts";
import type {
  ExcerptRendererDiagnostics,
  ExcerptRendererDiagnosticSnapshot,
} from "@zotlit/annotations/obsidian/excerpt-image/renderer.ts";
import type { ExcerptOutcome } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import type { E2eServices } from "@zotlit/obsidian/e2e";
import type { FixtureExcerptCase } from "@zotlit/scripts/fixture";

import type { RenderingResult } from "./excerpt-rendering.ts";

type MemorySample =
  | { rss: number; heapUsed: number; heapTotal: number }
  | string;
export interface ExcerptImportState {
  settled: boolean;
  startedAt: number;
  settledAt: number | null;
  before: Pick<
    ExcerptRendererDiagnosticSnapshot,
    | "loads"
    | "phase"
    | "jobActive"
    | "fileOpen"
    | "documentOpen"
    | "renderTaskActive"
  >;
  after: ExcerptImportState["before"] | null;
  memoryBefore: MemorySample;
  memoryAfter: MemorySample | null;
  result: Awaited<
    ReturnType<E2eServices["batchImport"]["runBatchImport"]>
  > | null;
  error: string | null;
}
export interface ExcerptProbeState {
  settled: boolean;
  outcome: { kind?: ExcerptOutcome["kind"]; name?: string } | null;
  originalToBlob: HTMLCanvasElement["toBlob"];
  controller: AbortController;
  diagnostics: ExcerptRendererDiagnostics;
  service: E2eServices["excerptImage"];
  bridge: E2eServices["bridge"];
  request: ExcerptRequest;
  before: Electron.ProcessMemoryInfo;
  after: Electron.ProcessMemoryInfo | null;
  completion: Promise<void> | null;
}
interface ExcerptAcceptanceState {
  owner: string;
  started: boolean;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
  result: RenderingResult | null;
  error: string | null;
  cases: readonly FixtureExcerptCase[];
}
declare module "./page-helpers.ts" {
  interface PageScratch {
    __zotlitExcerptImport?: ExcerptImportState;
    __zotlitExcerptProbe?: ExcerptProbeState;
    __zotlitExcerptAcceptance?: ExcerptAcceptanceState;
    __zotlitExcerptStale?: ExcerptRequest;
    __zotlitExcerptUrlProbe?: {
      create: typeof URL.createObjectURL;
      revoke: typeof URL.revokeObjectURL;
      created: string[];
      revoked: string[];
    };
  }
}
