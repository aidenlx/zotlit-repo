import type { WorkspaceLeaf, WorkspaceTabs, MarkdownView } from "obsidian";

import type { QueryJob } from "@zotlit/query-views/worker/item-query/worker-protocol.ts";
export type LibraryTabs = WorkspaceTabs & {
  setDimension(percent: number): void;
};
export type LibraryLeaf = WorkspaceLeaf & { tabHeaderInnerIconEl: HTMLElement };
export type LinkMarkdownView = MarkdownView & {
  hoverPopover?: { hide?: () => void; unload: () => void };
};
export type LibraryWorkerMessage = [
  unknown,
  { tag: string; payload: { job: QueryJob } },
];
declare module "./page-helpers.ts" {
  interface PageScratch {
    zotlitE2EBeside?: WorkspaceLeaf;
    libraryBeforeReload?: boolean;
    libraryCardDrag?: { x: number; y: number };
  }
}
