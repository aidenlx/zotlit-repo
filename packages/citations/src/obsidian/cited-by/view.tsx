import { ItemView } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { ViewRegistryProvider } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { activeKeyAtom } from "@zotlit/plugin-services/obsidian/note-index/atoms.ts";

import { revisionsAtom } from "./atoms.ts";
import { CitedBy } from "./CitedBy.tsx";
import {
  CitedByModelContext,
  dropExpansions,
  EMPTY_CITED_BY_NOTE_STATE,
  holdCitedByModel,
  makeCitedByModel,
  readSavedLayout,
} from "./model.ts";
import type { CitedByLayout } from "./model.ts";

export const CITED_BY_VIEW_TYPE = "zotlit-cited-by";

export interface CitedByViewDeps {
  app: App;
  registry: ViewRegistryHandle;
}

export class CitedByView extends ItemView {
  readonly #deps: CitedByViewDeps;
  readonly #model = makeCitedByModel();
  #release: (() => void) | null;
  #root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, deps: CitedByViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root", "zt-cited-by-view");
    this.#deps = deps;
    this.#release = holdCitedByModel(deps.registry, this.#model);
  }

  override getViewType(): string {
    return CITED_BY_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.cited_by_view_name();
  }

  override getIcon(): string {
    return "file-input";
  }

  override getState(): Record<string, unknown> {
    return { ...this.#deps.registry.get(this.#model.layout) };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    const saved = readSavedLayout(state);
    this.#deps.registry.update(this.#model.layout, (layout) => ({
      ...layout,
      ...saved,
    }));
  }

  protected override async onOpen(): Promise<void> {
    const { app, registry } = this.#deps;
    this.#release ??= holdCitedByModel(registry, this.#model);
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <ViewRegistryProvider registry={registry}>
        <CitedByModelContext value={this.#model}>
          <CitedBy />
        </CitedByModelContext>
      </ViewRegistryProvider>,
    );

    let saved = registry.get(this.#model.layout);
    this.register(
      registry.subscribe(this.#model.layout, (layout) => {
        if (sameLayout(layout, saved)) return;
        saved = layout;
        app.workspace.requestSaveLayout();
      }),
    );
    this.register(
      registry.subscribe(activeKeyAtom, () =>
        registry.set(this.#model.note, EMPTY_CITED_BY_NOTE_STATE),
      ),
    );
    let revisions = registry.get(revisionsAtom);
    this.register(
      registry.subscribe(revisionsAtom, (next) => {
        const changed = Object.keys(next).filter(
          (path) => next[path] !== revisions[path],
        );
        revisions = next;
        if (changed.length > 0) {
          registry.update(this.#model.note, dropExpansions(changed));
        }
      }),
    );
  }

  protected override async onClose(): Promise<void> {
    this.#root?.unmount();
    this.#root = null;
    this.#release?.();
    this.#release = null;
  }
}

const LAYOUT_KEYS = ["searchVisible", "search", "moreContext", "sort"] as const;

function sameLayout(a: CitedByLayout, b: CitedByLayout): boolean {
  return LAYOUT_KEYS.every((key) => a[key] === b[key]);
}
