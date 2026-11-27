import type { IconName } from "obsidian";
import type { KeyboardEvent, ReactNode } from "react";
import { Fragment, useSyncExternalStore } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import { ViewRegistryProvider } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  SaveAsButton,
  SortButton,
} from "@zotlit/query-views/desktop/query-view/view.tsx";
import type { QueryView } from "@zotlit/query-views/desktop/query-view/view.tsx";
import { useUniqueId } from "@zotlit/ui";

import type { LibraryNode, ReadingStateFacet } from "./document.ts";
import type { LibraryTree } from "./library-tree.tsx";
import { FACET_LABELS, nodeIcon, nodeLabel } from "./library-tree.tsx";
import { TreeModelProvider, useTreeState } from "./tree-model.ts";

import { TextAction } from "#obsidian/library/text-action.tsx";

export interface HeaderSearch {
  subscribe: (listener: () => void) => () => void;
  summary: (selection: string) => string | null;
  title: () => string | null;
  everywhere: () => boolean;
  readonly action: ReactNode;
}

export interface LibraryHeadingHost {
  tree: LibraryTree;
  query: QueryView;
  search: HeaderSearch;
  clearFilters: () => void;
}

export function renderHeading(el: HTMLElement, host: LibraryHeadingHost): Root {
  const root = createRoot(el);
  root.render(
    <ViewRegistryProvider registry={host.tree.registry}>
      <TreeModelProvider value={host.tree.model}>
        {host.query.layout.provide(<LibraryHeading host={host} />)}
      </TreeModelProvider>
    </ViewRegistryProvider>,
  );
  return root;
}

function crumbsOf(
  libraries: Parameters<typeof nodeLabel>[0],
  node: LibraryNode,
): string[] {
  if (node.kind !== "collection") return [];
  return [
    nodeLabel(libraries, { kind: "library", library: node.library }),
    ...node.path.slice(0, -1),
  ];
}

function nameOf(
  libraries: Parameters<typeof nodeLabel>[0],
  node: LibraryNode,
): string {
  return node.kind === "collection"
    ? node.path.at(-1)!
    : nodeLabel(libraries, node);
}

const SEPARATOR = (
  <span aria-hidden="true" className="zt:px-0.5">
    ›
  </span>
);

function LibraryHeading({ host }: { host: LibraryHeadingHost }) {
  const { tree, query, search } = host;
  const libraries = useTreeState((s) => s.libraries);
  const node = useTreeState((s) => s.node);
  const unread = useTreeState((s) => s.unread);
  const facets = useTreeState((s) => s.facets);
  const tags = useTreeState((s) => s.tags);
  const total = useTreeState(() => tree.count);
  const results = useSyncExternalStore(
    query.state.subscribe,
    () => query.state.getState().results,
  );
  const searchTitle = useSyncExternalStore(search.subscribe, search.title);
  const everywhere = useSyncExternalStore(search.subscribe, search.everywhere);
  const name = nameOf(libraries, node);
  const status = useSyncExternalStore(search.subscribe, () =>
    search.summary(node.kind === "collection" ? node.path.join(" / ") : name),
  );
  const toolsId = useUniqueId();
  const searching = searchTitle !== null;
  const crumbs = searching
    ? everywhere
      ? [m.library_view_heading_everywhere()]
      : [...crumbsOf(libraries, node), name]
    : crumbsOf(libraries, node);
  const narrowed = facets.length + tags.length > 0;
  const counts: string[] = [];
  if (results && !searching)
    counts.push(
      narrowed && total !== null
        ? m.library_view_heading_papers_of({ count: results.matched, total })
        : m.library_view_heading_papers({ count: results.matched }),
    );
  if (results?.truncated)
    counts.push(m.library_view_heading_first_shown({ count: results.count }));
  if (unread && !searching)
    counts.push(m.library_view_heading_unread({ count: unread }));
  return (
    <div
      data-library-heading=""
      className="zt:@container zt:flex zt:flex-col zt:gap-(--size-4-2) zt:border-b-(length:--border-width) zt:border-(--table-border-color) zt:ps-(--zt-query-toolbar-inset-start) zt:pe-(--zt-query-toolbar-inset-end) zt:pt-(--size-4-3) zt:pb-(--size-4-3) zt:group-data-zotero-missing:hidden"
    >
      <div className="zt:flex zt:items-center zt:gap-(--size-4-3)">
        <span
          aria-hidden="true"
          data-library-heading-icon={searching ? "search" : nodeIcon(node)}
          className="zt:flex zt:size-7 zt:shrink-0 zt:items-center zt:justify-center zt:rounded-(--radius-m) zt:bg-(--interactive-accent)/12 zt:text-(--text-accent)"
        >
          <Icon name={searching ? "search" : nodeIcon(node)} size="m" />
        </span>
        <div className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-col">
          {crumbs.length > 0 && (
            <div
              data-library-heading-path=""
              className="zt:truncate zt:text-xs zt:text-muted-foreground"
            >
              {crumbs.map((crumb, index) => (
                <Fragment key={index}>
                  {crumb}
                  {SEPARATOR}
                </Fragment>
              ))}
            </div>
          )}
          <div
            role="heading"
            aria-level={2}
            data-library-header=""
            className="zt:m-0 zt:truncate zt:text-(length:--font-ui-medium) zt:leading-(--line-height-tight) zt:font-(--font-semibold) zt:text-(--text-normal)"
          >
            {searchTitle ?? name}
          </div>
          <div
            className="zt:flex zt:min-h-[1lh] zt:flex-wrap zt:items-center zt:gap-x-(--size-4-2) zt:text-(length:--font-ui-small) zt:text-muted-foreground"
            data-library-header-count=""
            data-query-count={results?.count}
            data-query-matched={results?.matched}
          >
            {counts.length > 0 && (
              <span className="zt:tabular-nums">{counts.join(" · ")}</span>
            )}
            {search.action}
          </div>
        </div>
        <div
          role="toolbar"
          aria-labelledby={toolsId}
          className="zt:flex zt:shrink-0 zt:items-center zt:gap-(--size-2-1) zt:self-start"
        >
          <span id={toolsId} className="zt:sr-only">
            {m.library_view_heading_tools()}
          </span>
          <SortButton view={query} />
          <SaveAsButton view={query} />
        </div>
      </div>
      {narrowed && (
        <FilterChips
          facets={facets}
          tags={tags}
          removeFacet={(facet) => tree.toggleFacet(facet)}
          removeTag={(tag) => tree.toggleTag(tag)}
          clear={host.clearFilters}
        />
      )}
      <div role="status" className="zt:sr-only" data-library-search-status="">
        {status ?? ""}
      </div>
    </div>
  );
}

function onActivate(act: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    act();
  };
}

const CHIP =
  "zt:inline-flex zt:max-w-full zt:cursor-(--cursor) zt:items-center zt:gap-1 zt:rounded-(--radius-l) zt:border-(length:--border-width) zt:border-(--interactive-accent)/40 zt:bg-(--interactive-accent)/12 zt:py-(--size-2-1) zt:ps-(--size-4-2) zt:pe-(--size-2-2) zt:text-(length:--font-ui-smaller) zt:text-(--text-normal) zt:outline-hidden zt:hover:bg-(--interactive-accent)/22 zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]";

function FilterChip({
  hook,
  label,
  icon,
  remove,
}: {
  hook: string;
  label: string;
  icon?: IconName;
  remove: () => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      data-library-filter={hook}
      className={CHIP}
      {...tooltipAttrs(m.library_view_heading_remove_filter({ name: label }))}
      onClick={remove}
      onKeyDown={onActivate(remove)}
    >
      {icon && (
        <Icon
          name={icon}
          size="xs"
          className="zt:shrink-0 zt:text-muted-foreground"
        />
      )}
      <span className="zt:truncate">{label}</span>
      <Icon
        name="x"
        size="xs"
        className="zt:shrink-0 zt:text-muted-foreground"
      />
    </span>
  );
}

function FilterChips({
  facets,
  tags,
  removeFacet,
  removeTag,
  clear,
}: {
  facets: readonly ReadingStateFacet[];
  tags: readonly string[];
  removeFacet: (facet: ReadingStateFacet) => void;
  removeTag: (tag: string) => void;
  clear: () => void;
}) {
  const id = useUniqueId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      data-library-filters=""
      className="zt:flex zt:flex-wrap zt:items-center zt:gap-(--size-2-3)"
    >
      <span id={id} className="zt:sr-only">
        {m.library_view_heading_filters()}
      </span>
      {facets.map((facet) => (
        <FilterChip
          key={facet}
          hook={`facet:${facet}`}
          label={FACET_LABELS[facet]()}
          remove={() => removeFacet(facet)}
        />
      ))}
      {tags.map((tag) => (
        <FilterChip
          key={tag}
          hook={`tag:${tag}`}
          label={tag}
          icon="tag"
          remove={() => removeTag(tag)}
        />
      ))}
      <TextAction
        data-library-filter-clear=""
        className="zt:px-(--size-2-2) zt:text-(length:--font-ui-smaller)"
        onActivate={clear}
      >
        {m.library_view_heading_clear_filters()}
      </TextAction>
    </div>
  );
}
