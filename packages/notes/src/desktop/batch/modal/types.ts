import type { CreationProfileSource } from "#desktop/note-feature/index.ts";
import type {
  BatchClassifyControls,
  BatchRunControls,
  BatchRunResult,
} from "#obsidian/batch/batch-run.ts";

import type { NoticeMessage } from "@zotlit/obsidian-kit/notice.ts";

export type {
  BatchClassifyControls,
  BatchFailure,
  BatchRunControls,
  BatchRunResult,
} from "#obsidian/batch/batch-run.ts";

export interface BatchCounts {
  actionable: number;
  notFound: number;
}

export type BatchProfileChoiceScope = "all-new" | "unresolved" | "affected";

export interface BatchProfileChoice {
  readonly label?: string;
  readonly source: CreationProfileSource;
  readonly scope?: BatchProfileChoiceScope;
  readonly count?: number;
  choose(): Promise<void>;
}

export interface BatchListControls {
  chooseProfile(choice: BatchProfileChoice): Promise<void>;
}

export interface BatchManifest {
  readonly counts: BatchCounts;
  renderList(parent: HTMLElement, controls?: BatchListControls): void;
  setRowStatus(id: number, status: "done" | "skipped" | "failed"): void;
  renderSummary(
    parent: HTMLElement,
    finalStatus: ReadonlyMap<number, "done" | "skipped" | "failed">,
  ): void;
}

export interface BatchModalText {
  title: string;
  loadingLabel: string;
  loadFailed: string;
  runFailed: string | ((error: unknown) => NoticeMessage);
  progressLabel: string;
  confirmIntro: (counts: BatchCounts) => string;
  confirmButton: string;
  runSummary: (
    result: BatchRunResult,
    state: { cancelled: boolean; aborted: boolean },
  ) => string;

  progressWarning?: string;
  progressCount?: (args: {
    done: number;
    total: number;
    pct: number;
  }) => string;
  progressFailed?: (args: { count: number }) => string;
  detailsShow?: string;
  detailsHide?: string;
  cancelling?: string;
  failedHeader?: (args: { count: number }) => string;
  closeButton?: string;
}

export interface BatchModalOptions {
  text: BatchModalText;
  total: number;
  onClassify: (controls: BatchClassifyControls) => Promise<BatchManifest>;
  onRun: (controls: BatchRunControls) => Promise<BatchRunResult>;
}
