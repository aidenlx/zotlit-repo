import type { EditorView } from "@codemirror/view";
import { MarkdownView, TFile } from "obsidian";
import type {
  Constructor,
  Editor,
  MarkdownFileInfo,
  WorkspaceSidedock,
  EventRef,
  OpenViewState,
  PaneType,
  View,
  WorkspaceLeaf,
  WorkspaceRoot,
  WorkspaceWindow,
} from "obsidian";

import type { WorkspaceSource } from "#obsidian-workspace.ts";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

type Callback = (...args: unknown[]) => unknown;

export class MemoryWorkspace implements WorkspaceSource {
  activeFile: TFile | null = null;
  activeEditor: MarkdownFileInfo | null = null;
  activeLeaf: WorkspaceLeaf | null = null;
  mostRecentLeaf: WorkspaceLeaf | null = null;

  getMostRecentLeaf(): WorkspaceLeaf | null {
    return this.mostRecentLeaf;
  }
  readonly leftSplit = stubService<WorkspaceSidedock>("WorkspaceSidedock", {});
  readonly rightSplit = stubService<WorkspaceSidedock>("WorkspaceSidedock", {});
  lastOpenFiles: string[] = [];
  layoutSaves = 0;
  getLastOpenFiles(): string[] { return this.lastOpenFiles; }
  requestSaveLayout(): void { this.layoutSaves += 1; }
  activeView: unknown = null;
  readonly leaves = new Map<string, WorkspaceLeaf[]>();
  readonly dispatched: string[] = [];
  reconfigures = 0;
  readonly opened: {
    linktext: string;
    sourcePath: string;
    newLeaf: PaneType | boolean | undefined;
    openViewState: OpenViewState | undefined;
  }[] = [];
  savedLayout: unknown = {};
  readonly activated: WorkspaceLeaf[] = [];
  readonly leafRequests: (PaneType | boolean | undefined)[] = [];
  readonly requestActiveLeafEvents = {
    run: (): void => {
      for (const file of this.#deferred.splice(0)) this.open(file);
    },
  };
  readonly #listeners = new Map<string, Set<Callback>>();
  readonly #readyCallbacks: (() => void)[] = [];
  readonly #deferred: TFile[] = [];
  #layoutReady: boolean;

  constructor(options: { layoutReady?: boolean } = {}) {
    this.#layoutReady = options.layoutReady ?? false;
  }

  onLayoutReady(callback: () => void): void {
    if (this.#layoutReady) callback();
    else this.#readyCallbacks.push(callback);
  }

  layoutReady(): void {
    this.#layoutReady = true;
    this.trigger("layout-ready");
    for (const callback of this.#readyCallbacks.splice(0)) callback();
  }

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  getActiveViewOfType<T extends View>(type: Constructor<T>): T | null {
    return this.activeView instanceof type ? this.activeView : null;
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return [...(this.leaves.get(type) ?? [])];
  }

  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void {
    for (const leaves of this.leaves.values()) leaves.forEach(callback);
  }

  openLeaf(type: string, view: View): WorkspaceLeaf {
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", { view });
    const leaves = this.leaves.get(type) ?? [];
    leaves.push(leaf);
    this.leaves.set(type, leaves);
    return leaf;
  }

  openMarkdownEditor(path: string): MarkdownView {
    const file = Object.assign(new TFile(), { path });
    const editor = stubService<Editor>("Editor", {
      cm: stubService<EditorView>("EditorView", {
        dispatch: () => {
          this.dispatched.push(path);
        },
      }),
    });
    const view = Object.assign(
      new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
      { file, editor },
    );
    this.openLeaf("markdown", view);
    return view;
  }

  async readWorkspaceFile(): Promise<unknown> {
    return this.savedLayout;
  }

  updateOptions(): void {
    this.reconfigures += 1;
  }

  async openLinkText(
    ...[linktext, sourcePath, newLeaf, openViewState]: Parameters<
      WorkspaceSource["openLinkText"]
    >
  ): Promise<void> {
    this.opened.push({ linktext, sourcePath, newLeaf, openViewState });
  }

  getLeaf(newLeaf?: PaneType | boolean): WorkspaceLeaf {
    this.leafRequests.push(newLeaf);
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  }

  getRightLeaf(): WorkspaceLeaf {
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  }

  createLeafBySplit(): WorkspaceLeaf {
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  }

  openPopoutLeaf(): WorkspaceLeaf {
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  }

  moveLeafToPopout(): WorkspaceWindow {
    return stubService<WorkspaceWindow>("WorkspaceWindow", {});
  }

  readonly rootSplit = stubService<WorkspaceRoot>("WorkspaceRoot", {});

  async revealLeaf(_leaf: WorkspaceLeaf): Promise<void> {}

  setActiveLeaf(leaf: WorkspaceLeaf): void {
    this.activated.push(leaf);
  }

  open(file: TFile | null): void {
    this.activeFile = file;
    this.trigger("file-open", file);
  }

  deferOpen(file: TFile): void {
    this.#deferred.push(file);
  }

  on(name: string, callback: Callback): EventRef {
    let listeners = this.#listeners.get(name);
    if (!listeners) this.#listeners.set(name, (listeners = new Set()));
    listeners.add(callback);
    const ref = { e: this, name, fn: callback };
    return ref;
  }

  offref(ref: EventRef): void {
    const { name, fn } = ref as unknown as { name: string; fn: Callback };
    this.#listeners.get(name)?.delete(fn);
  }

  listenerCount(name: string): number {
    return this.#listeners.get(name)?.size ?? 0;
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners.get(name) ?? [])
      callback(...args);
  }
}
