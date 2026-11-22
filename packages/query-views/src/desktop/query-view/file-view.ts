import { Scope, TextFileView } from "obsidian";
import type { TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";

import "./file-view.css";
import { readSavedQueryViewName } from "./model.ts";
import { QueryView } from "./view.tsx";
import type { QueryViewDeps } from "./view.tsx";

export const QUERY_FILE_VIEW_TYPE = "zotlit-query-file";

export class QueryFileView extends TextFileView {
  override scope: Scope;
  readonly query: QueryView;
  #writing: Promise<void> = Promise.resolve();

  constructor(leaf: WorkspaceLeaf, deps: QueryViewDeps) {
    super(leaf);
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root");
    this.query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => this.file?.path ?? "",
      context: () => undefined,
      save: (text) => {
        const write = this.#writing.then(() => {
          this.data = text;
          return this.save();
        });
        this.#writing = write.catch(() => {});
        return write;
      },
    });
  }

  override getViewType(): string {
    return QUERY_FILE_VIEW_TYPE;
  }

  override getIcon(): string {
    return "list-filter";
  }

  override onload(): void {
    super.onload();
    this.addChild(this.query);
    this.query.register(
      this.query.registry.subscribe(this.query.model.wanted, () => {
        this.app.workspace.requestSaveLayout();
        this.leaf.updateHeader();
      }),
    );
    this.query.render(this.contentEl);
  }

  override getViewData(): string {
    return this.data;
  }

  override setViewData(data: string): void {
    this.data = data;
    this.query.setText(data);
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    await this.query.flush();
    await super.onUnloadFile(file);
  }

  override clear(): void {}

  override getState(): Record<string, unknown> {
    const state = super.getState();
    const view = this.query.viewName;
    return view === null ? state : { ...state, view };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    const view = readSavedQueryViewName(state);
    this.query.selectView(view);
    await super.setState(state, result);
  }
}
