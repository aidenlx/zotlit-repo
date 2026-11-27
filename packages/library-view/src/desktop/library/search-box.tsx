import { Component } from "obsidian";
import type { KeyboardEvent, ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

import { SearchInput } from "@zotlit/obsidian-kit/components/obsidian/search-input.tsx";
import { ViewRegistryProvider } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { QueryView } from "@zotlit/query-views/desktop/query-view/view.tsx";
import { useUniqueId } from "@zotlit/ui";
import type {
  LibraryScope,
  LibrarySelector,
} from "@zotlit/zotero-reads/contract/library-scope.ts";

import type { LibraryNode } from "./document.ts";
import type { HeaderSearch } from "./heading.tsx";
import type { SearchSession } from "./search-model.ts";
import {
  makeSearchModel,
  patchSearch,
  SearchModelProvider,
  useSearchState,
} from "./search-model.ts";
import type { TreeModel } from "./tree-model.ts";
import { TreeModelProvider, useTreeState } from "./tree-model.ts";

import { waitForRead } from "#obsidian/library/model.ts";
import { TextAction } from "#obsidian/library/text-action.tsx";

export interface LibrarySearchDeps {
  registry: ViewRegistryHandle;
}

export interface SearchFound {
  readonly text: string;
  readonly keys?: readonly string[];
  readonly everywhere?: readonly LibrarySelector[];
}

export interface LibrarySearchHost {
  node: () => LibraryNode;
  scope: () => LibraryScope;
  found: (found: SearchFound) => void;
  keep: (text: string) => void;
}

export class LibrarySearch extends Component {
  readonly model = makeSearchModel();
  readonly registry;
  readonly #host;
  #release: (() => void) | null;
  #active = false;
  #lastFound: SearchFound | null = null;
  readonly #waiting = new Set<() => void>();
  #input: HTMLInputElement | null = null;
  #roots: Root[] = [];

  constructor(deps: LibrarySearchDeps, host: LibrarySearchHost) {
    super();
    this.registry = deps.registry;
    this.#host = host;
    this.#release = this.registry.mount(this.model.session);
  }
  get state() {
    return this.registry.get(this.model.session);
  }
  #patch(patch: Partial<SearchSession>): void {
    this.registry.update(this.model.session, patchSearch(patch));
  }

  get settled(): Promise<void> {
    return this.#active
      ? waitForRead(this.registry, this.model.loaded, this.#waiting).then(
          () => {
            if (this.#active)
              this.#publish(this.registry.get(this.model.found));
          },
        )
      : Promise.resolve();
  }

  #publish(found: SearchFound | null): void {
    if (found && found !== this.#lastFound) {
      this.#lastFound = found;
      this.#host.found(found);
    }
  }

  override onload(): void {
    this.#active = true;
    this.#release ??= this.registry.mount(this.model.session);
    this.register(
      this.registry.subscribe(this.model.found, (found) => {
        this.#publish(found);
      }),
    );
    this.register(() => {
      this.#release?.();
      this.#release = null;
    });
  }

  override onunload(): void {
    this.#active = false;
    for (const finish of this.#waiting) finish();
    for (const root of this.#roots) root.unmount();
    this.#roots = [];
  }

  open(text: string): Promise<void> {
    this.#patch({ text });
    return this.run();
  }

  type(text: string): void {
    this.#patch({ text, everywhere: this.#everywhere(text) });
    this.#host.keep(text);
    void this.run();
  }

  clear(): void {
    this.type("");
  }

  widen(): void {
    this.#patch({ everywhere: true });
    void this.run();
  }

  narrow(): void {
    this.#patch({ everywhere: false });
  }

  focus(): void {
    this.#input?.focus();
  }

  get onRecent(): boolean {
    return this.#host.node().kind === "recent";
  }

  #everywhere(text: string): boolean {
    return text.trim() !== "" && this.state.everywhere;
  }

  run(): Promise<void> {
    this.#patch({
      request: { node: this.#host.node(), scope: this.#host.scope() },
    });
    return this.settled;
  }

  render(el: HTMLElement): void {
    const root = createRoot(el);
    root.render(
      <ViewRegistryProvider registry={this.registry}>
        <SearchModelProvider value={this.model}>
          <SearchBox search={this} />
        </SearchModelProvider>
      </ViewRegistryProvider>,
    );
    this.#roots.push(root);
  }

  header(query: QueryView["state"]): HeaderSearch {
    const subscribe = (listener: () => void) => {
      const offText = this.registry.subscribe(this.model.session, listener);
      const offQuery = query.subscribe(listener);
      return () => {
        offText();
        offQuery();
      };
    };
    const header: HeaderSearch = {
      subscribe,
      summary: (selection) => {
        const shown = this.#shown(query);
        if (!shown || shown.matched === null) return null;
        if (shown.everywhere && !this.onRecent)
          return m.library_view_search_matches_everywhere({
            count: shown.matched,
          });
        return m.library_view_search_matches({
          selection,
          count: shown.matched,
        });
      },
      title: () => {
        const shown = this.#shown(query);
        if (!shown || shown.matched === null) return null;
        return m.library_view_heading_search({
          count: shown.matched,
          query: this.state.text.trim(),
        });
      },
      everywhere: () => {
        const shown = this.#shown(query);
        return shown !== null && shown.everywhere && !this.onRecent;
      },
      action: (
        <SearchAllButton
          search={this}
          subscribe={subscribe}
          offered={() => {
            const shown = this.#shown(query);
            return (
              shown !== null &&
              !shown.everywhere &&
              !this.onRecent &&
              shown.matched !== 0
            );
          }}
        />
      ),
    };
    return header;
  }

  #shown(
    query: QueryView["state"],
  ): { everywhere: boolean; matched: number | null } | null {
    const { text, everywhere } = this.state;
    if (text.trim() === "") return null;
    return {
      everywhere,
      matched: query.getState().results?.matched ?? null,
    };
  }

  empty(tree: TreeModel, fallback: string): ReactNode {
    return (
      <ViewRegistryProvider registry={this.registry}>
        <SearchModelProvider value={this.model}>
          <TreeModelProvider value={tree}>
            <EmptyList search={this} fallback={fallback} />
          </TreeModelProvider>
        </SearchModelProvider>
      </ViewRegistryProvider>
    );
  }

  /** @internal The box's input, for {@link focus}. */
  attachInput(input: HTMLInputElement | null): void {
    this.#input = input;
  }
}

function SearchBox({ search }: { search: LibrarySearch }) {
  const text = useSearchState((s) => s.text);
  const label = useUniqueId();
  return (
    <div data-library-search="">
      <span id={label} className="zt:sr-only">
        {m.library_view_search_label()}
      </span>
      <SearchInput
        ref={(input) => search.attachInput(input)}
        type="text"
        aria-labelledby={label}
        className="zt:w-full"
        value={text}
        placeholder={m.library_view_search_placeholder()}
        clearLabel={m.library_view_search_clear()}
        onChange={(next) => search.type(next)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Escape" || text === "") return;
          event.preventDefault();
          event.stopPropagation();
          search.clear();
        }}
      />
    </div>
  );
}

function EmptyList({
  search,
  fallback,
}: {
  search: LibrarySearch;
  fallback: string;
}) {
  const text = useSearchState((s) => s.text.trim());
  const everywhere = useSearchState((s) => s.everywhere);
  const filters = useTreeState((s) => s.facets.length + s.tags.length);
  if (text === "")
    return filters === 0 ? (
      fallback
    ) : (
      <p className="zt:m-0" data-library-empty="">
        {m.library_view_empty_facets()}
      </p>
    );
  const widen = !everywhere && !search.onRecent;
  return (
    <div className="zt:flex zt:flex-col zt:items-center zt:gap-(--size-4-2) zt:text-muted-foreground">
      <p className="zt:m-0 zt:text-balance" data-library-empty="">
        {widen
          ? m.library_view_empty_search_widen()
          : m.library_view_empty_search_clear()}
      </p>
      <TextAction
        data-library-empty-action={widen ? "widen" : "clear"}
        onActivate={() => (widen ? search.widen() : search.clear())}
      >
        {widen
          ? m.library_view_search_everywhere()
          : m.library_view_search_clear()}
      </TextAction>
    </div>
  );
}

function SearchAllButton({
  search,
  subscribe,
  offered,
}: {
  search: LibrarySearch;
  subscribe: HeaderSearch["subscribe"];
  offered: () => boolean;
}) {
  if (!useSyncExternalStore(subscribe, offered)) return null;
  return (
    <TextAction
      data-library-search-all=""
      className="zt:shrink-0 zt:group-data-zotero-missing:hidden"
      onActivate={() => search.widen()}
    >
      {m.library_view_search_everywhere()}
    </TextAction>
  );
}
