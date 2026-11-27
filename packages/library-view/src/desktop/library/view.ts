import type { WelcomeBannerDeps } from "#desktop/welcome/banner.tsx";
import type { LibrarySelection } from "#obsidian/library/model.ts";
import { Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { debounce, ItemView, Keymap, Scope } from "obsidian";
import type { Component, Modifier, WorkspaceLeaf } from "obsidian";

import { inTextEntry } from "@zotlit/annotations/obsidian/pdf-annotation-editor/capability-affordance.ts";
import { holdScopeWhileFocused } from "@zotlit/obsidian-kit/focus-scope.ts";
import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import {
  Workspace,
  workspaceTrigger,
} from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import { makeViewRunner } from "@zotlit/obsidian-kit/view-runner.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { yieldToMain } from "@zotlit/plugin-kernel/yield-to-main.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import { libraryScopeStateAtom } from "@zotlit/plugin-services/obsidian/library-scope/atoms.ts";
import { notedItemKeysAtom } from "@zotlit/plugin-services/obsidian/note-index/atoms.ts";
import { useLedgerAtom } from "@zotlit/plugin-services/obsidian/use-ledger/atoms.ts";
import {
  ITEM_ROW_ATTRIBUTE,
  ITEM_ROW_REVEALED_ATTRIBUTE,
  NO_ROWS,
} from "@zotlit/query-views/core/query-view/item-rows.ts";
import type {
  ItemRowGestures,
  ShownRows,
} from "@zotlit/query-views/core/query-view/item-rows.ts";
import { showItemInAnnotView } from "@zotlit/query-views/desktop/annot-view/register.ts";
import { saveAsQueryFile } from "@zotlit/query-views/desktop/annot-view/save-query-file.ts";
import { holdsPdf } from "@zotlit/query-views/desktop/query-view/papers-layout.tsx";
import { QueryView } from "@zotlit/query-views/desktop/query-view/view.tsx";
import type { QueryViewDeps } from "@zotlit/query-views/desktop/query-view/view.tsx";
import type { QueryViewValue } from "@zotlit/query-views/worker/item-query/query-view.ts";
import { composing } from "@zotlit/ui";
import type { LibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { itemNodeAtom } from "./atoms.ts";
import {
  CARD_HEIGHT_DEFAULT,
  CARD_HEIGHT_MIN,
  CARD_WIDTH_DEFAULT,
  CARD_WIDTH_MIN,
  LIBRARY_LAYOUTS,
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_MIN,
  libraryViewDefaults,
  libraryViewQuery,
  libraryViewQueryFileLeftOut,
  libraryViewQueryFileText,
  pruneExpanded,
  vaultPass,
  withCardClosed,
  withCardDisclosure,
  withCardWidth,
  withCardHeight,
  withExpanded,
  withFacets,
  withNode,
  withSearch,
  withTags,
  withTreeCollapsed,
  withTreeWidth,
} from "./document.ts";
import type {
  LibraryNode,
  LibraryViewDocument,
  LibraryViewLabels,
  LibraryViewQuery,
  ReadingStateFacet,
} from "./document.ts";
import { renderHeading } from "./heading.tsx";
import type { ItemActions } from "./item-actions.ts";
import { createItemDrag, refuseItemDrop } from "./item-drag.ts";
import { FACET_LABELS, LibraryTree } from "./library-tree.tsx";
import { ZoteroNotFound } from "./not-found.tsx";
import { PaneWidth } from "./pane-width.ts";
import { ReadingCard } from "./reading-card.tsx";
import { recentReason, RECENT_REASON_FIELDS } from "./reason.ts";
import { rowMenu } from "./row-menu.ts";
import type { MenuItem } from "./row-menu.ts";
import { LibrarySearch } from "./search-box.tsx";
import type { SearchFound } from "./search-box.tsx";
import { LibraryViewStorage } from "./storage.ts";
import { scopeForLibrary } from "./tree-model.ts";

import { ZOTLIT_MARK_ICON } from "#core/library/icon.ts";
import { WelcomeBanner } from "#desktop/welcome/banner.tsx";
import { DetailsToggle } from "#obsidian/library/details-toggle.tsx";
import {
  makeLibraryModel,
  patchSelection,
  waitForRead,
} from "#obsidian/library/model.ts";
import "./style.css";

export const LIBRARY_VIEW_TYPE = "zotlit-library";

export interface LibraryViewDeps extends QueryViewDeps {
  registry: ViewRegistryHandle;
  items: ItemActions;
  welcome: WelcomeBannerDeps;
}

const OWN_KEYS =
  'a, button, [role="button"], [role="listbox"], [role="combobox"], [role="tree"], [data-library-card]';

const ENTER_ACTIONS: readonly (readonly [
  Modifier[],
  (items: ItemActions, key: string) => unknown,
])[] = [
  [[], (items, key) => items.openNote(key, false)],
  [["Mod"], (items, key) => items.openNote(key, "tab")],
  [["Shift"], (items, key) => items.openPdf(key, false)],
  [["Mod", "Shift"], (items, key) => items.openPdf(key, "tab")],
];

export class LibraryView extends ItemView {
  override scope: Scope;
  readonly query: QueryView;
  readonly tree: LibraryTree;
  readonly search: LibrarySearch;
  readonly card: ReadingCard;
  readonly welcome: WelcomeBanner;
  readonly #deps: LibraryViewDeps;
  readonly #storage: LibraryViewStorage;
  readonly #parts: Component[] = [];
  #arrival = 0;
  #arrived: Promise<void> = Promise.resolve();
  #shown: LibraryViewQuery | null = null;
  #found: SearchFound = { text: "" };
  readonly model = makeLibraryModel();
  #release: (() => void) | null;
  readonly #waiting = new Set<() => void>();
  get selected(): LibrarySelection {
    return this.#deps.registry.get(this.model.selection);
  }
  #selectRow(
    patch:
      | Partial<LibrarySelection>
      | ((state: LibrarySelection) => LibrarySelection),
  ): void {
    this.#deps.registry.update(
      this.model.selection,
      typeof patch === "function" ? patch : patchSelection(patch),
    );
  }
  #hold(): () => void {
    const releases = [
      this.#deps.registry.mount(this.model.selection),
      this.#deps.registry.mount(useLedgerAtom),
      this.#deps.registry.mount(notedItemKeysAtom),
      this.#deps.registry.mount(libraryScopeStateAtom),
    ];
    return () => {
      for (const release of releases) release();
    };
  }
  #cardEl: HTMLElement | null = null;
  #columnEl: HTMLElement | null = null;
  #cardWidth: PaneWidth | null = null;
  #cardHeight: PaneWidth | null = null;
  #treeWidth: PaneWidth | null = null;
  #details: DetailsToggle | null = null;
  #listed: ShownRows = NO_ROWS;
  #saving: Promise<void> = Promise.resolve();
  readonly #keep = debounce(
    () => {
      this.#saving = this.#storage.save().catch((error: unknown) => {
        Effect.runSyncWith(logServices)(
          Effect.logWarning("The Library View could not keep the search").pipe(
            Effect.annotateLogs({ error }),
            withLogCategory("library-view"),
          ),
        );
      });
    },
    500,
    true,
  );

  constructor(leaf: WorkspaceLeaf, deps: LibraryViewDeps) {
    super(leaf);
    this.#deps = deps;
    this.#release = this.#hold();
    const runner = makeViewRunner(deps.registry);
    this.register(() => runner[Symbol.dispose]());
    const workspace = runner.runSync(Workspace);
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root", "zt-library-view");
    this.contentEl.dataset.libraryView = "";
    this.welcome = new WelcomeBanner(
      deps.welcome,
      { searchLibrary: () => this.search.focus() },
      this.contentEl.createDiv({ cls: "zt:shrink-0" }),
    );
    this.#storage = new LibraryViewStorage(
      deps.registry,
      () => this.query.document.text,
    );
    const drag = createItemDrag({ app: deps.app, actions: deps.items });
    const menuOf = (item: MenuItem) =>
      rowMenu(
        {
          actions: deps.items,
          literatureNotes: deps.literatureNotes,
          workspace: workspaceTrigger(workspace, runner.runSync),
        },
        item,
      );
    const rows: ItemRowGestures = {
      selection: {
        getState: () => this.selected,
        getInitialState: () => ({ key: null }),
        setState: (update) => {
          const now = this.selected;
          const next = typeof update === "function" ? update(now) : update;
          this.#selectRow(next);
        },
        subscribe: (listener) => {
          let previous = this.selected;
          return deps.registry.subscribe(this.model.selection, (state) => {
            const before = previous;
            previous = state;
            listener(state, before);
          });
        },
      },
      click: (key) => this.#selectRow({ key }),
      select: (key) => this.#selectRow({ key }),
      first: () =>
        this.query.state.getState().results?.records[0]?.row.indexedKey ?? null,
      open: (key, event) => {
        deps.items.openPdf(key, Keymap.isModEvent(event));
      },
      menu: (key, event) => {
        this.#selectRow({ key });
        const values = this.#rowValues(key);
        menuOf({
          indexedKey: key,
          pdf: values !== null && holdsPdf(values),
        }).showAtMouseEvent(event);
      },
      drag,
      shown: (rows) => {
        this.#listed = rows;
      },
    };
    this.register(() => drag.cancel());
    this.#registerRowKeys();
    const onEscape = () => {
      const { leftSplit, rightSplit } = runner.runSync(workspace.sidebarRoots);
      const root = this.leaf.getRoot();
      if (root === leftSplit || root === rightSplit) return;
      return false as const;
    };
    this.query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => "",
      context: () => undefined,
      libraries: () => this.#shown!.libraries,
      rank: () => this.#shown!.rank,
      displayOnly: true,
      layouts: LIBRARY_LAYOUTS,
      defaults: () => libraryViewDefaults(this.tree.state.node),
      rowPass: () =>
        this.#shown &&
        vaultPass(this.#shown.vault, {
          find: (key) =>
            deps.registry.get(notedItemKeysAtom).has(key)
              ? { path: key, basename: key }
              : null,
        }),
      rows,
      fields: (view) =>
        view.type === "papers" && this.tree.state.node.kind === "recent"
          ? RECENT_REASON_FIELDS
          : [],
      reason: (row) => {
        if (this.tree.state.node.kind !== "recent") return null;
        const use = deps.registry.get(useLedgerAtom)[row.indexedKey];
        return recentReason(row.values, use);
      },
      empty: ({ fallback }) => this.search.empty(this.tree.model, fallback),
      save: () => this.#storage.save(),
      saveAs: () => void this.#saveAs(),
      toolbar: "host",
      layout: { onEscape },
    });
    this.card = new ReadingCard(deps, {
      menu: (item, button) => showMenuAtButton(menuOf(item), button),
      openInSidebar: (key) => void showItemInAnnotView(deps.app, key),
      close: () => this.#setDetails(false),
      keepDisclosure: (name, open) => {
        this.#storage
          .change((doc) => withCardDisclosure(doc, name, open))
          .catch((error: unknown) => {
            Effect.runSyncWith(logServices)(
              Effect.logWarning(
                "The Library View could not keep the Reading Card",
              ).pipe(
                Effect.annotateLogs({
                  error,
                }),
                withLogCategory("library-view"),
              ),
            );
          });
      },
      selectTag: (name) => {
        if (!this.tree.state.tags.includes(name)) this.tree.toggleTag(name);
      },
      row: (key) => this.#rowValues(key),
      stats: () => this.tree.model.stats,
      onEscape,
    });
    this.tree = new LibraryTree(deps, {
      select: (node) => this.#select(node),
      filter: (facets) => this.#filter(facets),
      tag: (tags) => this.#tag(tags),
      expand: (expanded) => this.#expand((doc) => withExpanded(doc, expanded)),
      prune: (know) => {
        const doc = this.#storage.document();
        if (pruneExpanded(doc, know) !== doc)
          this.#expand((now) => pruneExpanded(now, know));
      },
      collapse: (collapsed) => this.#collapseTree(collapsed),
    });
    this.search = new LibrarySearch(deps, {
      node: () => this.tree.state.node,
      scope: () => this.#scope(),
      found: (found) => this.#show(found),
      keep: (text) => {
        this.#storage.set((doc) => withSearch(doc, text));
        this.#keep();
      },
    });
  }

  arrive(): void {
    const arrival = ++this.#arrival;
    if (this.welcome.known) {
      this.#arrived = Promise.resolve();
      if (!this.welcome.shown) this.search.focus();
      return;
    }
    const { doc } = this.contentEl;
    const before = doc.activeElement;
    this.#arrived = this.welcome.decided.then((shown) => {
      if (shown || arrival !== this.#arrival) return;
      if (!this.contentEl.isConnected || doc.activeElement !== before) return;
      this.search.focus();
    });
  }

  get arrived(): Promise<void> {
    return this.#arrived;
  }

  get searched(): Promise<void> {
    return this.search.settled;
  }

  override getViewType(): string {
    return LIBRARY_VIEW_TYPE;
  }

  #addWelcomeAction(): void {
    const action = this.addAction(
      "circle-help",
      m.library_view_help_action(),
      () => {
        if (this.welcome.shown) {
          this.welcome.dismiss();
          return;
        }
        this.tree.setOpen(false);
        this.welcome.request();
      },
    );
    this.welcome.register(
      this.welcome.subscribeShown((shown) => {
        action.classList.toggle("is-active", shown);
        action.setAttribute("aria-pressed", String(shown));
      }),
    );
  }

  override getDisplayText(): string {
    return m.library_view_name();
  }

  override getIcon(): string {
    return ZOTLIT_MARK_ICON;
  }

  #subscribeSelection(listener: (state: LibrarySelection) => void): () => void {
    return this.#deps.registry.subscribe(this.model.selection, listener);
  }

  protected override async onOpen(): Promise<void> {
    this.#release ??= this.#hold();
    this.registerDomEvent(this.contentEl, "dragover", refuseItemDrop);
    const column = this.contentEl.createDiv({
      cls: "zt:@container/column zt:flex zt:h-full zt:flex-col zt:overflow-y-auto",
      attr: { "data-library-column": "" },
    });
    this.#columnEl = column;
    column.append(this.welcome.el);
    const shell = column.createDiv({
      cls: "zt:group zt:@container/library zt:relative zt:flex zt:min-h-[min(20rem,100%)] zt:flex-1 zt:overflow-hidden zt:@max-4xl/column:not-data-zotero-missing:has-[[data-library-card]:not([hidden])]:min-h-[min(36rem,100%)]",
      attr: { "data-library-shell": "" },
    });
    const frame = shell.createDiv({
      cls: "zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:@max-4xl:flex-col",
    });
    const top = frame.createDiv({
      cls: "zt:relative zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1",
    });
    const treePane = top.createDiv({
      cls: "zt:relative zt:hidden zt:w-[var(--zt-library-tree-width,14rem)] zt:shrink-0 zt:flex-col zt:@max-xl:border-e-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-primary) zt:@xl:flex zt:@xl:group-data-tree-collapsed:hidden zt:@max-xl:group-data-tree-open:flex zt:@max-xl:absolute zt:@max-xl:inset-y-0 zt:@max-xl:start-0 zt:@max-xl:max-w-[85%] zt:@max-xl:z-(--layer-popover) zt:@max-xl:shadow-(--shadow-s)",
      attr: { "data-library-tree": "" },
    });
    const treeEl = treePane.createDiv({
      cls: "zt:min-h-0 zt:flex-1 zt:overflow-y-auto zt:scroll-gutter",
    });
    const main = top.createDiv({
      cls: "zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:flex-col",
    });
    const hidden = "zt:group-data-zotero-missing:hidden";
    const cardEl = frame.createDiv({ cls: `zt:contents ${hidden}` }).createDiv({
      cls: "zt:@container/card zt:relative zt:hidden zt:w-[var(--zt-library-card-width,24rem)] zt:shrink-0 zt:flex-col zt:min-h-0 zt:bg-(--background-primary) zt:[&:not([hidden])]:flex zt:@max-4xl:w-auto zt:@max-4xl:h-[var(--zt-library-card-height,16rem)]",
      attr: { "data-library-card": "", hidden: "" },
    });
    this.#cardEl = cardEl;
    const collapseCard = (collapsed: boolean) => {
      if (collapsed) cardEl.hidden = true;
      else this.#showCard();
    };
    this.#cardWidth = new PaneWidth(
      cardEl,
      {
        list: main,
        shell,
        side: "start",
        property: "--zt-library-card-width",
        fallback: CARD_WIDTH_DEFAULT,
        min: CARD_WIDTH_MIN,
        cls: "zt:@max-4xl/library:hidden",
        hint: m.library_view_card_resize_hint(),
        attr: "data-library-card-resizer",
      },
      {
        app: this.#deps.app,
        stored: () => this.#storage.document().cardWidth,
        collapse: collapseCard,
        close: () => this.#setDetails(false),
        keep: (width) => {
          this.#storage
            .change((doc) => withCardWidth(doc, width))
            .catch((error: unknown) => {
              Effect.runSyncWith(logServices)(
                Effect.logWarning(
                  "The Library View could not keep the card's width",
                ).pipe(
                  Effect.annotateLogs({
                    error,
                  }),
                  withLogCategory("library-view"),
                ),
              );
            });
        },
      },
    );
    this.#cardHeight = new PaneWidth(
      cardEl,
      {
        list: top,
        shell,
        side: "top",
        property: "--zt-library-card-height",
        fallback: CARD_HEIGHT_DEFAULT,
        min: CARD_HEIGHT_MIN,
        cls: "zt:@4xl/library:hidden",
        hint: m.library_view_card_resize_hint(),
        attr: "data-library-card-height-resizer",
      },
      {
        app: this.#deps.app,
        stored: () => this.#storage.document().cardHeight,
        collapse: collapseCard,
        close: () => this.#setDetails(false),
        keep: (height) => {
          this.#storage
            .change((doc) => withCardHeight(doc, height))
            .catch((error: unknown) => {
              Effect.runSyncWith(logServices)(
                Effect.logWarning(
                  "The Library View could not keep the card's height",
                ).pipe(
                  Effect.annotateLogs({
                    error,
                  }),
                  withLogCategory("library-view"),
                ),
              );
            });
        },
      },
    );
    this.#treeWidth = new PaneWidth(
      treePane,
      {
        list: main,
        shell,
        side: "end",
        property: "--zt-library-tree-width",
        fallback: TREE_WIDTH_DEFAULT,
        min: TREE_WIDTH_MIN,
        cls: "zt:@max-xl:hidden",
        hint: m.library_view_tree_resize_hint(),
        attr: "data-library-tree-resizer",
      },
      {
        app: this.#deps.app,
        stored: () => this.#storage.document().treeWidth,
        collapse: (collapsed) =>
          shell.toggleAttribute(
            "data-tree-collapsed",
            collapsed || this.tree.state.collapsed,
          ),
        close: () => this.#collapseTree(true),
        keep: (width) => {
          this.#storage
            .change((doc) => withTreeWidth(doc, width))
            .catch((error: unknown) => {
              Effect.runSyncWith(logServices)(
                Effect.logWarning(
                  "The Library View could not keep the tree's width",
                ).pipe(
                  Effect.annotateLogs({
                    error,
                  }),
                  withLogCategory("library-view"),
                ),
              );
            });
        },
      },
    );
    const cardBody = cardEl.createDiv({
      cls: "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col",
    });
    const searchRow = main.createDiv({
      cls: "zt:flex zt:items-center zt:gap-(--size-2-2) zt:ps-(--zt-query-toolbar-inset-start) zt:pe-(--zt-query-toolbar-inset-end) zt:pt-(--size-4-2)",
      attr: { "data-library-search-row": "" },
    });
    const toggleEl = searchRow.createDiv({ cls: "zt:contents" });
    const searchEl = searchRow.createDiv({
      cls: `zt:min-w-0 zt:flex-1 ${hidden}`,
    });
    this.#details = new DetailsToggle(
      searchRow.createDiv({ cls: `zt:flex ${hidden}` }),
      () => this.#setDetails(this.#storage.document().cardClosed === true),
    );
    const note = main.createDiv();
    const header = main.createDiv();
    const list = main.createDiv({
      cls: "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col",
    });
    const shown = "zt:hidden zt:group-data-zotero-missing:block";
    this.#parts.push(
      new ZoteroNotFound(
        {
          registry: this.#deps.registry,
          setupActions: this.#deps.welcome.setupActions,
        },
        {
          shell,
          tree: treeEl.createDiv({ cls: shown }),
          list: list.createDiv({
            cls: "zt:hidden zt:min-h-0 zt:flex-1 zt:flex-col zt:group-data-zotero-missing:flex",
          }),
          note,
        },
        () => void this.search.run(),
      ),
      this.welcome,
    );
    for (const part of this.#parts) part.load();
    this.#addWelcomeAction();
    this.tree.load();
    this.tree.render(treeEl.createDiv({ cls: hidden }));
    this.tree.renderToggle(toggleEl);
    const heading = renderHeading(header, {
      tree: this.tree,
      query: this.query,
      search: this.search.header(this.query.state),
      clearFilters: () => this.#clearFilters(),
    });
    this.query.register(() => heading.unmount());
    this.search.load();
    this.search.render(searchEl);
    this.tree.register(
      this.tree.subscribe(({ open, collapsed }) => {
        shell.toggleAttribute("data-tree-open", open);
        shell.toggleAttribute("data-tree-collapsed", collapsed);
        this.#treeWidth?.apply();
        this.#cardWidth?.apply();
        this.#cardHeight?.apply();
      }),
    );
    this.#holdTreeKeys(treePane);
    main.addEventListener("pointerdown", (event) => {
      if (!this.tree.state.open) return;
      const target = event.target as Node;
      if (
        target.instanceOf(HTMLElement) &&
        target.closest("[data-library-tree-toggle]")
      )
        return;
      this.tree.setOpen(false);
    });
    this.query.load();
    this.query.render(
      list.createDiv({
        cls: `zt:flex zt:min-h-0 zt:flex-1 zt:flex-col ${hidden}`,
      }),
    );
    this.card.load();
    this.card.render(cardBody);
    this.card.register(
      this.#subscribeSelection(({ key }) => {
        this.card.show(key);
        if (key !== null) this.#revealCard();
      }),
    );
    this.query.register(
      this.query.state.subscribe(({ phase, results }) => {
        const { key } = this.selected;
        if (phase !== "ready" || key === null) return;
        if (!results?.rows.some((row) => row.indexedKey === key))
          this.#selectRow({ key: null });
      }),
    );
    this.query.register(
      this.#deps.registry.subscribe(useLedgerAtom, () => {
        if (this.#shown && this.tree.state.node.kind === "recent")
          this.query.contextChanged();
      }),
    );
    this.query.register(
      this.#deps.registry.subscribe(notedItemKeysAtom, () => {
        if (this.#shown && this.#shown.vault.length > 0) this.query.refresh();
      }),
    );

    await this.#storage.load();
    const doc = this.#storage.document();
    this.#cardWidth?.load();
    this.#cardHeight?.load();
    this.#treeWidth?.load();
    this.tree.showCollapsed(doc.treeCollapsed === true);
    this.#showCard();
    this.card.showDisclosures(doc.card);
    this.tree.show(doc.node);
    this.tree.showExpanded(doc.expanded);
    this.tree.showFacets(doc.facets);
    this.tree.showTags(doc.tags);
    this.tree.refresh();
    await this.search.open(doc.search);
  }

  #expand(change: (doc: LibraryViewDocument) => LibraryViewDocument): void {
    this.#storage.change(change).catch((error: unknown) => {
      Effect.runSyncWith(logServices)(
        Effect.logWarning(
          "The Library View could not keep the open tree nodes",
        ).pipe(
          Effect.annotateLogs({
            error,
          }),
          withLogCategory("library-view"),
        ),
      );
    });
    this.tree.showExpanded(this.#storage.document().expanded);
  }

  #rowValues(key: string): Readonly<Record<string, QueryViewValue>> | null {
    return (
      this.query.state
        .getState()
        .results?.rows.find((row) => row.indexedKey === key)?.values ?? null
    );
  }

  #showCard(): void {
    const el = this.#cardEl;
    if (!el) return;
    const on = this.#storage.document().cardClosed !== true;
    el.hidden = !on;
    this.#details?.show(on);
    this.#cardWidth?.apply();
    this.#cardHeight?.apply();
    this.#treeWidth?.apply();
  }

  #revealCard(): void {
    const card = this.#cardEl;
    const column = this.#columnEl;
    if (!card || !column || card.hidden) return;
    const below =
      card.getBoundingClientRect().bottom -
      column.getBoundingClientRect().bottom;
    if (below > 0) column.scrollTop += below;
  }

  #setDetails(on: boolean): void {
    this.#storage
      .change((doc) => withCardClosed(doc, !on))
      .catch((error: unknown) => {
        Effect.runSyncWith(logServices)(
          Effect.logWarning(
            "The Library View could not keep the item details",
          ).pipe(
            Effect.annotateLogs({
              error,
            }),
            withLogCategory("library-view"),
          ),
        );
      });
    this.#showCard();
    const row = this.#selectedRow();
    if (on) {
      if (row) this.#scrollTo(row);
    } else row?.focus();
  }

  #collapseTree(collapsed: boolean): void {
    this.#storage
      .change((doc) => withTreeCollapsed(doc, collapsed))
      .catch((error: unknown) => {
        Effect.runSyncWith(logServices)(
          Effect.logWarning(
            "The Library View could not keep the tree collapsed",
          ).pipe(
            Effect.annotateLogs({
              error,
            }),
            withLogCategory("library-view"),
          ),
        );
      });
    this.tree.setOpen(false);
    this.tree.showCollapsed(collapsed);
  }

  #registerRowKeys(): void {
    for (const [key, step] of [
      ["ArrowUp", -1],
      ["ArrowDown", 1],
    ] as const)
      this.scope.register([], key, (event) => {
        if (!this.#onList(event.target)) return;
        if (this.#move(step)) return false;
      });
    for (const [modifiers, act] of ENTER_ACTIONS)
      this.scope.register(modifiers, "Enter", (event) => {
        if (!this.#onList(event.target)) return;
        const key = this.#selectedRow()?.getAttribute(ITEM_ROW_ATTRIBUTE);
        if (!key) return;
        void act(this.#deps.items, key);
        return false;
      });
    this.scope.register([], " ", (event) => {
      if (!this.#onList(event.target) || !this.#selectedRow()) return;
      this.#setDetails(this.#storage.document().cardClosed === true);
      return false;
    });
  }

  #holdTreeKeys(pane: HTMLElement): void {
    const { keymap } = this.#deps.app;
    const scope = new Scope(this.scope);
    scope.register([], "Escape", (event) => {
      if (composing(event)) return;
      if (inTextEntry(event.target) && this.tree.state.tagFilter) return;
      this.tree.setOpen(false);
      return false;
    });
    const keys = holdScopeWhileFocused(pane, scope, {
      keymap,
      when: () => this.tree.state.open,
    });
    this.tree.register(
      this.tree.subscribe(({ open }) => {
        if (!open) keys.release();
      }),
    );
    this.register(() => keys[Symbol.dispose]());
  }

  #onList(target: EventTarget | null): boolean {
    if (inTextEntry(target)) return false;
    const node = target as Node | null;
    return !(node?.instanceOf(Element) && node.closest(OWN_KEYS) !== null);
  }

  #rows(): HTMLElement[] {
    return [
      ...this.contentEl.querySelectorAll<HTMLElement>(
        `[${ITEM_ROW_ATTRIBUTE}]`,
      ),
    ];
  }

  #selectedRow(): HTMLElement | undefined {
    const { key } = this.selected;
    return key === null ? undefined : this.#rowOf(key);
  }

  #rowOf(key: string): HTMLElement | undefined {
    return this.#rows().find(
      (row) => row.getAttribute(ITEM_ROW_ATTRIBUTE) === key,
    );
  }

  #move(step: -1 | 1): boolean {
    const { keys } = this.#listed;
    if (keys.length === 0) return false;
    const { key } = this.selected;
    const at = key === null ? -1 : keys.indexOf(key);
    const next =
      at === -1
        ? keys[0]!
        : keys[Math.min(Math.max(at + step, 0), keys.length - 1)]!;
    this.#selectRow({ key: next });
    const row = this.#rowOf(next);
    if (row) this.#focus(row);
    else
      void this.#shownRow(next).then((shown) => {
        if (shown && this.selected.key === next) this.#focus(shown);
      });
    return true;
  }

  async #shownRow(key: string): Promise<HTMLElement | undefined> {
    const row = this.#rowOf(key);
    if (row) return row;
    await yieldToMain();
    return this.#rowOf(key);
  }

  #focus(row: HTMLElement): void {
    row.focus({ preventScroll: true });
    this.#scrollTo(row);
  }

  #scrollTo(row: HTMLElement): void {
    const key = row.getAttribute(ITEM_ROW_ATTRIBUTE);
    if (key !== null) this.#listed.scrollTo(key);
  }

  #flash(row: HTMLElement): void {
    row.removeAttribute(ITEM_ROW_REVEALED_ATTRIBUTE);
    row.getBoundingClientRect();
    row.setAttribute(ITEM_ROW_REVEALED_ATTRIBUTE, "");
    const ended = (event: AnimationEvent) => {
      if (event.target !== row) return;
      row.removeAttribute(ITEM_ROW_REVEALED_ATTRIBUTE);
      row.removeEventListener("animationend", ended);
    };
    row.addEventListener("animationend", ended);
  }

  async reveal(
    indexedKey: string,
  ): Promise<"listed" | "not-listed" | "not-found" | "closed"> {
    const node = await this.#itemNode(indexedKey);
    if (!this.#release) return "closed";
    if (!node) return "not-found";
    if (this.tree.state.facets.length > 0) this.#filter([]);
    if (this.tree.state.tags.length > 0) this.#tag([]);
    if (this.search.state.text !== "") this.search.clear();
    this.#select(node);
    await this.searched;
    await this.query.settled;
    const listed = this.query.state
      .getState()
      .results?.rows.some((row) => row.indexedKey === indexedKey);
    if (!listed) {
      this.#selectRow({ key: null });
      return "not-listed";
    }
    this.#selectRow({ key: indexedKey });
    const row = await this.#shownRow(indexedKey);
    if (row) {
      this.#focus(row);
      this.#flash(row);
    }
    return "listed";
  }

  async #itemNode(indexedKey: string): Promise<LibraryNode | null> {
    const { registry } = this.#deps;
    const atom = itemNodeAtom(indexedKey);
    const release = registry.mount(atom);
    try {
      await waitForRead(registry, atom, this.#waiting);
      if (!this.#release) return null;
      return Option.getOrNull(AsyncResult.value(registry.get(atom)));
    } finally {
      release();
    }
  }

  #select(node: LibraryNode): void {
    this.tree.show(node);
    this.#storage
      .change((doc) => withNode(doc, node))
      .catch((error: unknown) => {
        Effect.runSyncWith(logServices)(
          Effect.logWarning(
            "The Library View could not keep the tree selection",
          ).pipe(
            Effect.annotateLogs({
              error,
            }),
            withLogCategory("library-view"),
          ),
        );
      });
    this.tree.showExpanded(this.#storage.document().expanded);
    this.#selectRow({ key: null });
    this.search.narrow();
    void this.search.run();
  }

  #filter(facets: readonly ReadingStateFacet[]): void {
    this.tree.showFacets(facets);
    this.#storage
      .change((doc) => withFacets(doc, facets))
      .catch((error: unknown) => {
        Effect.runSyncWith(logServices)(
          Effect.logWarning("The Library View could not keep the facets").pipe(
            Effect.annotateLogs({ error }),
            withLogCategory("library-view"),
          ),
        );
      });
    this.#show(this.#found);
  }

  #tag(tags: readonly string[]): void {
    this.tree.showTags(tags);
    this.#storage
      .change((doc) => withTags(doc, tags))
      .catch((error: unknown) => {
        Effect.runSyncWith(logServices)(
          Effect.logWarning(
            "The Library View could not keep the selected tags",
          ).pipe(
            Effect.annotateLogs({
              error,
            }),
            withLogCategory("library-view"),
          ),
        );
      });
    this.#show(this.#found);
  }

  #clearFilters(): void {
    this.tree.showFacets([]);
    this.tree.showTags([]);
    this.#storage
      .change((doc) => withTags(withFacets(doc, []), []))
      .catch((error: unknown) => {
        Effect.runSyncWith(logServices)(
          Effect.logWarning(
            "The Library View could not clear the filters",
          ).pipe(
            Effect.annotateLogs({ error }),
            withLogCategory("library-view"),
          ),
        );
      });
    this.#show(this.#found);
  }

  #show(found: SearchFound): void {
    this.#found = found;
    const { text, keys, everywhere } = found;
    this.#shown = libraryViewQuery(withSearch(this.#storage.document(), text), {
      labels: labels(),
      scope: this.#scope(),
      ...(keys && { keys }),
      ...(everywhere && { everywhere }),
    });
    this.tree.showListed(this.#shown.node !== null);
    this.query.setText(this.#shown.text);
    this.query.contextChanged();
  }

  #scope(): LibraryScope {
    return scopeForLibrary(this.#deps.registry.get(libraryScopeStateAtom));
  }

  async #saveAs(): Promise<void> {
    await this.query.flush();
    const doc = this.#storage.document();
    const leftOut = libraryViewQueryFileLeftOut(doc);
    await saveAsQueryFile(
      this.app,
      libraryViewQueryFileText(doc, { labels: labels() }),
      {
        name: this.tree.name,
        leftOut: [
          ...(leftOut.facets.length === 0
            ? []
            : [
                m.library_view_save_leaves_out_facets({
                  facets: new Intl.ListFormat(runtime.getLocale(), {
                    type: "conjunction",
                  }).format(
                    leftOut.facets.map((facet) => FACET_LABELS[facet]()),
                  ),
                }),
              ]),
          ...(leftOut.search ? [m.library_view_save_leaves_out_search()] : []),
        ],
      },
    );
  }

  protected override async onClose(): Promise<void> {
    if (!this.#release) return;
    this.#cardWidth?.unload();
    this.#cardHeight?.unload();
    this.#treeWidth?.unload();
    this.#details?.unmount();
    this.#keep.run();
    const saving = this.#saving;
    this.search.unload();
    const flushing = this.query.flush();
    this.query.unload();
    this.card.unload();
    this.tree.unload();
    for (const part of this.#parts.splice(0)) part.unload();
    await saving;
    await flushing;
    this.#storage.close();
    this.#release?.();
    this.#release = null;
    for (const finish of this.#waiting) finish();
  }
}

function labels(): LibraryViewLabels {
  return {
    papers: m.library_view_papers_view_name(),
  };
}
