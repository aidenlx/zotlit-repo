import type { FilterValues } from "#desktop/query-view/filter-popover.tsx";
import type { QueryView } from "#desktop/query-view/view.tsx";
// "Filter..." in the sidebar's More options menu: the Query View's Match
// editor in a dialog, with the conditions of the sidebar's one view. The
// filter that names the followed Attachment stays out of it.
import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { Modal } from "obsidian";
import type { App } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { resultValue } from "@zotlit/annotations/desktop/annot-view/atoms.ts";
import { AppContext } from "@zotlit/obsidian-kit/app-context.ts";
import {
  viewRuntime,
  ViewRegistryProvider,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { allViewsDataset } from "#core/query-view/query-file.ts";
import { readFilterValues } from "#desktop/query-view/atoms.ts";
import { useFilterExpressions } from "#desktop/query-view/expression-vocabulary.ts";
import { FilterEditor } from "#desktop/query-view/filter-popover.tsx";
import { useViewProperties } from "#desktop/query-view/view-properties.ts";

const NO_VALUES: FilterValues = { tags: [], collections: [], libraries: [] };

const makeFilterModel = (query: QueryView) => ({
  state: Atom.make(query.state.getState()),
  values: viewRuntime.atom(
    readFilterValues.pipe(
      Effect.catch((error) =>
        Effect.logWarning("The filter values could not be read", error).pipe(
          Effect.as(NO_VALUES),
        ),
      ),
    ),
  ),
});

function SidebarFilter({
  query,
  model,
}: {
  query: QueryView;
  model: ReturnType<typeof makeFilterModel>;
}) {
  const { file, view: shown, failure } = useAtomValue(model.state);
  const filterIssue = failure?.filterIssue ?? null;
  const values = resultValue(useAtomValue(model.values)) ?? NO_VALUES;
  const properties = useViewProperties(query);
  // The dialog stands while it is mounted, so it reads the custom fields once.
  const expressions = useFilterExpressions(query, properties, {
    reading: true,
  });
  // The followed Attachment can go while the dialog is open.
  if (!file || !shown) return null;
  return (
    <FilterEditor
      run={query.run}
      dataset={shown.from ?? "annotations"}
      allViewsDataset={allViewsDataset(file)}
      allViews={file.filters}
      thisView={shown.filters}
      values={values}
      issue={filterIssue}
      properties={properties}
      expressions={expressions}
      sections={["view"]}
      onChange={(section, next) => query.document.setFilters(section, next)}
    />
  );
}

export class SidebarFilterModal extends Modal {
  #root: Root | null = null;
  readonly #query: QueryView;
  readonly #model;
  #release: (() => void) | null = null;

  constructor(app: App, query: QueryView) {
    super(app);
    this.#query = query;
    this.#model = makeFilterModel(query);
    this.setTitle(m.annot_view_filter_title());
  }

  override onOpen(): void {
    this.modalEl.addClass("zt-annot-filter-modal");
    this.contentEl.addClass("zt-root");
    const registry = this.#query.layout.store.registry;
    const releases = [
      registry.mount(this.#model.state),
      registry.mount(this.#model.values),
      this.#query.state.subscribe((state) =>
        registry.set(this.#model.state, state),
      ),
    ];
    this.#release = () => {
      for (const release of releases) release();
    };
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <ViewRegistryProvider registry={registry}>
        <AppContext value={this.app}>
          <SidebarFilter query={this.#query} model={this.#model} />
        </AppContext>
      </ViewRegistryProvider>,
    );
  }

  override onClose(): void {
    this.#root?.unmount();
    this.#root = null;
    this.#release?.();
    this.#release = null;
  }
}
