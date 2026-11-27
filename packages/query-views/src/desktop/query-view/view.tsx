import type { ItemRowGestures } from "#core/query-view/item-rows.ts";
import type {
  QueryFile,
  QueryFileDataset,
  QueryFileProblem,
  QueryFileSort,
  QueryFileView,
} from "#core/query-view/query-file.ts";
import type { QueryHandle } from "#desktop/item-query/handle.ts";
import type { ViewPlan } from "#desktop/query-view/view-plan/view-plan.ts";
import type { QueryCardFocus } from "#obsidian/query-view/card-focus.ts";
import type { ContextSource } from "#obsidian/query-view/context-hint.ts";
import type { LibraryRead } from "#obsidian/query-view/reader-failure.ts";
import type { Diagnostic } from "#worker/item-query/contract.ts";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewRow,
} from "#worker/item-query/query-view.ts";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type { Scope } from "obsidian";
import { Component } from "obsidian";
import type { ComponentType } from "react";
import { useLayoutEffect, useMemo } from "react";

import { CardDisplayContext } from "@zotlit/annotations/core/annot-view/card-display.ts";
import type { CardDisplay } from "@zotlit/annotations/core/annot-view/card-display.ts";
import { AnnotList } from "@zotlit/annotations/desktop/annot-view/AnnotView.tsx";
import { AnnotationsLayout } from "@zotlit/annotations/desktop/annot-view/layout.tsx";
import type {
  AnnotationsLayoutDeps,
  AnnotationsLayoutHost,
} from "@zotlit/annotations/desktop/annot-view/layout.tsx";
import type { TargetOpenGesture } from "@zotlit/annotations/desktop/attachment-open/actions.ts";
import { viewTargetOpener } from "@zotlit/annotations/desktop/attachment-open/view-opener.ts";
import { useAnnotStore } from "@zotlit/annotations/obsidian/annot-view/store.ts";
import type { AnnotState } from "@zotlit/annotations/obsidian/annot-view/store.ts";
import type { HistorySurface } from "@zotlit/annotations/obsidian/annotation-repository/actions.ts";
import type { HistoryDirection } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { nameDictionary } from "@zotlit/item-query";
import type { NameDictionary, QueryContext } from "@zotlit/item-query";
import { PaneState } from "@zotlit/obsidian-kit/components/pane-state.tsx";
import { reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeMessage } from "@zotlit/obsidian-kit/notifier.ts";
import {
  correctionsText,
  readerDiagnostic,
  readerText,
} from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import { ViewRegistryProvider } from "@zotlit/obsidian-kit/view-atoms.ts";
import { makeViewRunner } from "@zotlit/obsidian-kit/view-runner.ts";
import type { ViewRunner } from "@zotlit/obsidian-kit/view-runner.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { SubscriptionRuntime } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { libraryAvailabilityRevisionAtom } from "@zotlit/plugin-services/obsidian/library-scope/atoms.ts";
import { useUniqueId } from "@zotlit/ui";
import {
  zoteroRevisionAtom,
  zoteroQueryUnavailableRevisionAtom,
  zoteroStateAtom,
} from "@zotlit/zotero-reads/client/atoms.ts";
import type { LibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { makeRunQueryCommand } from "./atoms.ts";
import { CardsLayout } from "./cards-layout.tsx";
import { datasetSpec, grouping } from "./datasets.ts";
import { FilterButton } from "./filter-popover.tsx";
import { GroupEditor } from "./group-control.tsx";
import { annotationsLayoutOptions, layoutOf } from "./layouts.ts";
import { ListLayout } from "./list-layout.tsx";
import { QueryTaskProvider, useQueryViewState } from "./model.ts";
import {
  holdQueryViewModel,
  makeQueryViewModel,
  queryStateHandle,
} from "./model.ts";
import { PapersLayout } from "./papers-layout.tsx";
import { PropertiesMenu } from "./properties-menu.tsx";
import { groupOptions } from "./properties.ts";
import { QueryFileDocument } from "./query-file-document.ts";
import { ResultsMenu } from "./results-menu.tsx";
import type {
  FormulaIssue,
  QueryViewFailure,
  ResultSnapshot,
} from "./results.ts";
import { NO_RESULTS } from "./results.ts";
import type { LayoutRows } from "./rows.ts";
import { layoutRows } from "./rows.ts";
import { SearchButton, SearchRow, useSearchBar } from "./search-control.tsx";
import { SortEditor } from "./sort-control.tsx";
import type { ChildQuery } from "./table-layout.tsx";
import { TableLayout } from "./table-layout.tsx";
import type { LiteratureNotes, VaultHost } from "./table-notes.ts";
import type { ResultTable } from "./table.ts";
import { resultTable } from "./table.ts";
import { useVaultPropertyNames, vaultText } from "./vault-cell.tsx";
import { viewSortOptions } from "./vault-sort.ts";
import { ViewMenu } from "./view-menu.tsx";
import {
  usedGroupBy,
  useViewProperties,
  viewProperties,
} from "./view-properties.ts";

import { DrawLatch } from "#core/query-view/draw-latch.ts";
import {
  LITERATURE_NOTE,
  sameSort,
  vaultName,
} from "#core/query-view/query-file.ts";
import { queryRevisionAtom } from "#desktop/item-query/atoms.ts";
import { QueryService } from "#desktop/item-query/service.ts";
import { ViewPlanner } from "#desktop/query-view/view-plan/view-plan.ts";
import { contextHint } from "#obsidian/query-view/context-hint.ts";
import {
  readerSource,
  readerWarningText,
  sourceText,
} from "#obsidian/query-view/reader-failure.ts";
import { ToolbarButton } from "#obsidian/query-view/toolbar-button.tsx";
import { ToolbarPopover } from "#obsidian/query-view/toolbar-popover.tsx";

export interface QueryViewDeps extends AnnotationsLayoutDeps {
  registry: ViewRegistryHandle;
  runtime: SubscriptionRuntime;
  cardFocus: Pick<QueryCardFocus, "hold">;
  nearScreen: (el: HTMLElement, near: () => void) => () => void;
  literatureNotes: LiteratureNotes;
}

export interface QueryViewHost {
  scope: Scope;
  sourcePath: () => string;
  context: () => QueryContext | undefined;
  contextSource?: ContextSource;
  keepsRowsOnRebind?: boolean;
  onSelectView?: (name: string) => void;
  save: (text: string) => void | Promise<void>;
  canSave?: () => boolean;
  openFile?: (event: MouseEvent) => void;
  start?: Promise<void>;
  layout?: Pick<
    AnnotationsLayoutHost,
    "gestures" | "onList" | "onEscape" | "showNewRecords" | "publishing"
  >;
  attachments?: () => readonly string[];
  libraries?: () => LibraryScope;
  displayOnly?: boolean;
  layouts?: readonly string[];
  defaults?: () => QueryViewDefaults;
  rows?: ItemRowGestures;
  reason?: (row: QueryViewRow) => string | null;
  fields?: (view: QueryFileView) => readonly string[];
  empty?: ComponentType<{ fallback: string }>;
  saveAs?: () => void;
  toolbar?: "host";
  rank?: () => readonly string[] | null;
  rowPass?: () => QueryRowPass | null;
}

export interface QueryViewDefaults {
  readonly sort?: readonly QueryFileSort[];
  readonly limit?: number;
}

export interface QueryRowPass {
  readonly key: string;
  keeps(indexedKey: string): boolean;
}

export interface QueryViewCapabilities {
  readonly views: boolean;
  readonly group: boolean;
  readonly filter: boolean;
  readonly limit: boolean;
  readonly properties: boolean;
  readonly columnWidth: boolean;
  readonly propertyPages: boolean;
  readonly search: boolean;
}

const EVERY_CHANGE: QueryViewCapabilities = Object.freeze({
  views: true,
  group: true,
  filter: true,
  limit: true,
  properties: true,
  columnWidth: true,
  propertyPages: true,
  search: true,
});

const DISPLAY_CHANGES: QueryViewCapabilities = Object.freeze({
  views: false,
  group: false,
  filter: false,
  limit: false,
  properties: false,
  columnWidth: false,
  propertyPages: false,
  search: false,
});

export interface QueryViewState {
  file: QueryFile | null;
  view: QueryFileView | null;
  problems: readonly string[];
  phase: "waiting" | "idle" | "loading" | "ready" | "failed";
  results: ResultSnapshot | null;
  failure: QueryViewFailure | null;
  saveFailed: boolean;
  defaults: QueryViewDefaults;
}

export function problemText(problem: QueryFileProblem): string {
  switch (problem.code) {
    case "invalid-yaml":
      return m.query_view_problem_invalid_yaml({ message: problem.message });
    case "not-a-map":
      return m.query_view_problem_not_a_map();
    case "no-views":
      return m.query_view_problem_no_views();
    case "missing-key":
      return m.query_view_problem_missing_key({ key: problem.key });
    case "invalid-value":
      return m.query_view_problem_invalid_value({
        key: problem.key,
        value: JSON.stringify(problem.value) ?? String(problem.value),
      });
    case "duplicate-view-name":
      return m.query_view_problem_duplicate_view({ name: problem.name });
    default:
      problem satisfies never;
      return "";
  }
}

function layoutProblems(view: QueryFileView): string[] {
  const problems: string[] = [];
  const group = usedGroupBy(view)?.property;
  if (group !== undefined && grouping(view.from, group) === undefined)
    problems.push(m.query_view_problem_group({ property: group }));
  const layout = layoutOf(view);
  if (!layout) problems.push(m.query_view_problem_layout({ type: view.type }));
  else if (!layout.datasets.includes(view.from ?? "annotations"))
    problems.push(
      layout.type === "annotations"
        ? m.query_view_problem_dataset()
        : m.query_view_problem_layout_dataset({
            layout: layout.name(),
            datasets: layout.datasets.join(", "),
          }),
    );
  return problems;
}

export const RERUN_DELAY_MS = 300;

interface ViewRun {
  view: QueryFileView;
  plan: ViewPlan;
  key: string;
  binding: string;
}

const FORMULA_READ_FAULTS: ReadonlySet<string> = new Set([
  "reads-faulted-formula",
  "unknown-formula",
]);

function formulaIssues(
  outcome: QueryViewOutcome,
  formulas: QueryViewRequest["formulas"],
  library: LibraryRead,
): NameDictionary<FormulaIssue> {
  const faults = Object.entries(
    (outcome.kind === "result"
      ? outcome.result.formulaDiagnostics
      : outcome.kind === "failed"
        ? outcome.formulaDiagnostics
        : undefined) ?? {},
  );
  return nameDictionary(
    faults.map(([name, diagnostic]): [string, FormulaIssue] => {
      const message = sourceText(readerSource(diagnostic, library));
      const { location } = diagnostic;
      const text = formulas?.[name];
      return [
        name,
        location?.argument === "formulas" &&
        location.path === name &&
        location.span &&
        text !== undefined
          ? { message, place: { text, span: location.span } }
          : { message },
      ];
    }),
  );
}

export class QueryView extends Component implements HistorySurface {
  readonly model = makeQueryViewModel();
  readonly registry: ViewRegistryHandle;
  readonly state: ReturnType<typeof queryStateHandle>;
  #release: (() => void) | null;
  #releaseCommand: (() => void) | null;
  #finishRun: (() => void) | null = null;
  readonly #deps: QueryViewDeps;
  readonly #host: QueryViewHost;
  readonly #layout: AnnotationsLayout;
  readonly #planner: ViewPlanner;
  readonly #document: QueryFileDocument;
  readonly #runCommand = makeRunQueryCommand();
  readonly #tasks: ViewRunner;
  #cardsShown = false;
  #shownRequest: string | null = null;
  #runRequest: string | null = null;
  #shownViewName: string | null = null;
  #shownDataset: QueryFileDataset | null = null;
  #shownBinding: string | null = null;
  #settled: Promise<void> = Promise.resolve();
  #waiting: {
    open: boolean;
    asked: boolean;
    first: PromiseWithResolvers<void>;
  } | null = null;
  #subscriptions: DisposableStack | null = null;
  #rendered = false;
  readonly #cards = new DrawLatch(
    () => this.#layout.store.getState().annotations,
  );
  readonly #records = new DrawLatch(
    () => (this.state.getState().results ?? NO_RESULTS).records,
  );
  #rerunTimer: { id: number; win: Window } | null = null;
  #el: HTMLElement | null = null;
  constructor(deps: QueryViewDeps, host: QueryViewHost) {
    super();
    this.#deps = deps;
    this.registry = deps.registry;
    this.#release = holdQueryViewModel(this.registry, this.model);
    this.#releaseCommand = this.registry.mount(this.#runCommand);
    this.#tasks = makeViewRunner(this.registry);
    this.state = queryStateHandle(this.registry, this.model);
    this.#host = host;
    this.#document = new QueryFileDocument(host, {
      show: () => this.#choose(),
      saveFailed: (saveFailed) => {
        if (this.#release) this.state.setState({ saveFailed });
      },
      win: () => this.#win(),
    });
    this.#layout = new AnnotationsLayout(deps, {
      ...host.layout,
      scope: host.scope,
      sourcePath: host.sourcePath,
      onListChanged: () => this.#listChanged(),
    });
    this.#planner = new ViewPlanner({
      context: () => host.context(),
      libraries: () => host.libraries?.(),
      fields: (view) => host.fields?.(view) ?? [],
      host: () => this.vaultHost(),
      notes: deps.literatureNotes,
    });
    if (host.start) this.#wait(host.start);
  }

  get document(): QueryFileDocument {
    return this.#document;
  }

  get layout(): AnnotationsLayout {
    return this.#layout;
  }

  get historyAttachment(): string | null {
    return this.#layout.historyAttachment;
  }

  stepHistory(direction: HistoryDirection): void {
    const attachmentKey = this.historyAttachment;
    if (attachmentKey !== null)
      this.#layout.stepHistory(direction, attachmentKey);
  }

  get tableDeps(): {
    query: ChildQuery & Pick<QueryHandle, "on">;
    literatureNotes: LiteratureNotes;
    readers: TargetOpenGesture;
  } {
    const { literatureNotes, opener } = this.#deps;
    return {
      query: {
        on: (_event, listener) =>
          this.registry.subscribe(queryRevisionAtom, listener),
        run: (request) => {
          const libraries = this.#host.libraries?.();
          return Effect.flatMap(QueryService, (query) =>
            query.run(libraries ? { ...request, libraries } : request),
          );
        },
      },
      literatureNotes,
      readers: viewTargetOpener(this.registry, opener),
    };
  }

  vaultHost(): VaultHost | null {
    if (this.#host.contextSource !== "note") return null;
    const itemKey = this.#host.context()?.item;
    return itemKey ? { path: this.#host.sourcePath(), itemKey } : null;
  }

  get settled(): Promise<void> {
    return this.#settled
      .then(() => this.#layout.read)
      .then(() => this.#tasks.settled());
  }

  async shownIn(el: HTMLElement): Promise<void> {
    if (el.closest(".print") === null || !this.#rendered) return this.settled;
    return this.drawn();
  }

  async drawn(): Promise<void> {
    await this.settled;
    if (!this.#rendered) return;
    if (this.#cardsShown) return this.#cards.drawn();
    const { phase, results } = this.state.getState();
    if (phase === "ready" && results !== null) await this.#records.drawn();
  }

  drewRecords(records: ResultSnapshot["records"]): void {
    this.#records.drew(records);
  }

  drewCards(cards: AnnotState["annotations"]): void {
    this.#cards.drew(cards);
  }

  override onload(): void {
    this.#release ??= holdQueryViewModel(this.registry, this.model);
    this.addChild(this.#layout);
    const rerun = () => this.refresh();
    const subscriptions = new DisposableStack();
    this.#subscriptions = subscriptions;
    this.#releaseCommand ??= this.registry.mount(this.#runCommand);
    subscriptions.defer(this.registry.mount(queryRevisionAtom));
    subscriptions.defer(
      this.registry.subscribe(queryRevisionAtom, () => {
        if (this.state.getState().view?.from === "items") rerun();
      }),
    );
    subscriptions.defer(this.registry.mount(zoteroStateAtom));
    for (const atom of [
      zoteroRevisionAtom,
      zoteroQueryUnavailableRevisionAtom,
      libraryAvailabilityRevisionAtom,
    ]) {
      subscriptions.defer(this.registry.mount(atom));
      subscriptions.defer(this.registry.subscribe(atom, rerun));
    }
    const replan = () => {
      this.#planner.notesChanged();
      this.contextChanged();
    };
    const notes = this.#deps.literatureNotes;
    subscriptions.defer(notes.on("changed", replan));
    subscriptions.defer(notes.on("frontmatter-changed", replan));
    subscriptions.defer(() => this.#cancelRerun());
  }

  #listChanged(): void {
    this.#cancelRerun();
    const win = this.#win();
    const id = win.setTimeout(() => {
      this.#rerunTimer = null;
      this.#refresh(true);
    }, RERUN_DELAY_MS);
    this.#rerunTimer = { id, win };
  }

  #cancelRerun(): void {
    this.#rerunTimer?.win.clearTimeout(this.#rerunTimer.id);
    this.#rerunTimer = null;
  }

  #win(): Window {
    return this.#el?.win ?? window;
  }

  override onunload(): void {
    void this.flush();
    this.registry.set(this.#runCommand, Atom.Reset);
    this.#finishRun?.();
    this.#finishRun = null;
    this.#releaseCommand?.();
    this.#releaseCommand = null;
    void this.#tasks[Symbol.asyncDispose]();
    this.#subscriptions?.dispose();
    this.#subscriptions = null;
    this.#release?.();
    this.#release = null;
    this.#shownRequest = null;
    this.#runRequest = null;
    this.#rendered = false;
    this.#el = null;
    this.#cards.release();
    this.#records.release();
  }

  get printing(): boolean {
    return this.#el?.closest(".print") != null;
  }

  render(el: HTMLElement): void {
    el.addClass("zt-query-view");
    this.#el = el;
    this.#rendered = true;
    this.#layout.render(
      el,
      <ViewRegistryProvider registry={this.registry}>
        <QueryTaskProvider value={(task, failed) => this.runTask(task, failed)}>
          <QueryViewBody view={this} />
        </QueryTaskProvider>
      </ViewRegistryProvider>,
    );
  }

  setText(text: string): void {
    this.#document.setText(text);
  }

  contextChanged(): void {
    this.state.setState({ defaults: this.#host.defaults?.() ?? {} });
    const { file, view, problems } = this.state.getState();
    if (!file || !view || problems.length > 0) return;
    if (this.#runKey(this.#planner.plan(file, view)) !== this.#runRequest)
      this.refresh();
    else
      this.state.setState(({ results }) => ({
        results: results && { ...results, records: [...results.records] },
      }));
  }

  clear(): void {
    this.#document.clear();
    this.state.setState({ file: null });
    this.#runRequest = null;
    this.refresh();
  }

  get canSave(): boolean {
    return this.#document.canSave;
  }

  flush(): Promise<void> {
    return this.#document.flush();
  }

  runTask(
    task: Effect.Effect<void, unknown, ViewServices>,
    failed: () => NoticeMessage | undefined = () => undefined,
  ): () => void {
    const fiber = this.#tasks.run(
      reportOutcome(task, { success: () => undefined, error: failed }).pipe(
        withLogCategory("query-view"),
      ),
    );
    return () => fiber.interruptUnsafe();
  }

  get run(): ViewRunner["run"] {
    return this.#tasks.run;
  }

  get contextSource(): ContextSource | undefined {
    return this.#host.contextSource;
  }

  get can(): QueryViewCapabilities {
    return this.#host.displayOnly === true ? DISPLAY_CHANGES : EVERY_CHANGE;
  }

  setByResearcher(view: QueryFileView): {
    sort: readonly QueryFileSort[];
    limit: number | undefined;
  } {
    const { defaults } = this.state.getState();
    const sort = view.sort ?? [];
    return {
      sort: sameSort(sort, defaults.sort ?? []) ? [] : sort,
      limit: view.limit === defaults.limit ? undefined : view.limit,
    };
  }

  get layouts(): readonly string[] | undefined {
    return this.#host.layouts;
  }

  get rows(): ItemRowGestures | undefined {
    return this.#host.rows;
  }

  reason(row: QueryViewRow): string | null {
    return this.#host.reason?.(row) ?? null;
  }

  get empty(): ComponentType<{ fallback: string }> | undefined {
    return this.#host.empty;
  }

  get saveAs(): QueryViewHost["saveAs"] {
    return this.#host.saveAs;
  }

  get hostsToolbar(): boolean {
    return this.#host.toolbar === "host";
  }

  get openFile(): QueryViewHost["openFile"] {
    return this.#host.openFile;
  }

  selectView(name: string | null): void {
    this.registry.set(this.model.wanted, name);
    this.#document.selectView(name);
  }

  get viewName(): string | null {
    return this.registry.get(this.model.wanted);
  }

  pickView(name: string): void {
    this.#document.pickView(name);
  }

  #choose(): void {
    const { file, view, wanted } = this.#document;
    this.registry.set(this.model.wanted, this.#document.viewName);
    if (!file) return;
    const problems = file.problems.map(problemText);
    if (view) {
      problems.push(...view.problems.map(problemText), ...layoutProblems(view));
    } else if (wanted !== null && file.views.length > 0) {
      problems.push(m.query_view_problem_no_view({ name: wanted }));
    }
    this.state.setState({ file, view, problems });
    if (
      view &&
      problems.length === 0 &&
      this.#runKey(this.#planner.plan(file, view)) === this.#runRequest
    ) {
      if (this.#shownRequest === this.#runRequest) this.#redraw(view);
      return;
    }
    this.refresh();
  }

  #redraw(view: QueryFileView): void {
    const cards = drawsCards(view);
    if (cards === this.#cardsShown) return;
    const records = this.state.getState().results?.records ?? [];
    const rows = records.map(({ row, group }) => ({
      annotationKey: row.indexedKey,
      attachmentKey: row.attachmentIndexedKey ?? row.indexedKey,
      ...(group && { group }),
    }));
    this.#settled = this.#show(this.#shownRequest, cards ? rows : null);
  }

  table(): ResultTable {
    const { file, view } = this.state.getState();
    const notes = this.#deps.literatureNotes;
    const host = this.vaultHost();
    return resultTable(
      this.state.getState().results?.rows ?? [],
      view
        ? viewProperties(file, view).visible.filter(
            ({ path }) => path !== LITERATURE_NOTE,
          )
        : [],
      (row, path) => {
        const name = vaultName(path);
        return name === null
          ? undefined
          : vaultText(notes.read(row.indexedKey, name, host));
      },
    );
  }

  #binding(): string {
    return JSON.stringify([
      this.#host.context() ?? null,
      this.#host.libraries?.() ?? null,
    ]);
  }

  #runKey(plan: ViewPlan): string {
    return JSON.stringify([plan.key, this.#host.rowPass?.()?.key ?? null]);
  }

  refresh(): void {
    this.#refresh(false);
  }

  #wait(start: Promise<void>): void {
    const waiting = {
      open: false,
      asked: false,
      first: Promise.withResolvers<void>(),
    };
    this.#waiting = waiting;
    this.#settled = waiting.first.promise;
    this.state.setState({ phase: "waiting" });
    void start.then(() => {
      waiting.open = true;
      if (waiting.asked) this.refresh();
      else this.state.setState({ phase: "idle" });
    });
  }

  #refresh(fromList: boolean): void {
    const waiting = this.#waiting;
    if (waiting && !waiting.open) {
      waiting.asked = true;
      return;
    }
    this.#waiting = null;
    try {
      this.#run(fromList);
    } finally {
      if (waiting) {
        const { first } = waiting;
        if (this.#settled === first.promise) this.#settled = Promise.resolve();
        first.resolve(this.#settled);
      }
    }
  }

  #run(fromList: boolean): void {
    this.#finishRun?.();
    this.#finishRun = null;
    this.registry.set(this.#runCommand, Atom.Reset);
    const { file, view, problems } = this.state.getState();
    if (!file || !view || problems.length > 0) {
      this.#runRequest = null;
      void this.#show(null);
      this.state.setState({
        phase: "idle",
        results: null,
        failure: null,
      });
      return;
    }
    const plan = this.#planner.plan(file, view);
    const key = this.#runKey(plan);
    const binding = this.#binding();
    this.#runRequest = key;
    const run: ViewRun = { view, plan, key, binding };
    if (plan.fault) {
      this.#fail(run, plan.fault.diagnostic, NO_RESULTS.formulaIssues);
      return;
    }
    if (
      this.#shownRequest !== null &&
      this.#shownBinding !== binding &&
      !this.#host.keepsRowsOnRebind
    ) {
      void this.#show(null);
      this.state.setState({ results: null });
    }
    if (this.#shownRequest !== key) this.state.setState({ phase: "loading" });
    const completion = Promise.withResolvers<void>();
    this.#settled = completion.promise;
    this.#finishRun = () => completion.resolve();
    this.registry.set(this.#runCommand, {
      request: plan.request,
      pass: this.#host.rowPass?.() ?? null,
      land: (outcome) => this.#land(run, outcome, fromList),
      fail: () =>
        this.#fail(
          run,
          { code: "query-failed", message: "", hint: "" },
          NO_RESULTS.formulaIssues,
        ),
      done: () => completion.resolve(),
    });
  }

  async #land(
    run: ViewRun,
    outcome: QueryViewOutcome,
    fromList = false,
  ): Promise<void> {
    const { view, plan, key } = run;
    switch (outcome.kind) {
      case "cancelled":
        return;
      case "failed":
        this.#fail(
          run,
          outcome.diagnostic,
          formulaIssues(outcome, plan.request.formulas, this.#library()),
        );
        return;
      case "result": {
        const result = outcome.result;
        const named = (result.rows ?? []).map((row) => row.indexedKey);
        const cause = fromList
          ? "list-change"
          : key === this.#shownRequest
            ? "rerun"
            : "new-request";
        if (this.#layout.keepsBack(named, cause)) return;
        const rank = this.#host.rank?.() ?? null;
        const rows = ranked(result.rows ?? [], rank);
        const shown =
          rank === null ? plan.layout(rows) : rankedLayout(rows, view);
        const byKey = new Map(rows.map((row) => [row.indexedKey, row]));
        this.state.setState({
          phase: "ready",
          results: {
            rows: [...new Set(shown.rows.map((row) => row.annotationKey))].map(
              (key) => byKey.get(key)!,
            ),
            count: shown.count,
            records: shown.rows.map(({ annotationKey, group }) => ({
              row: byKey.get(annotationKey)!,
              ...(group && { group }),
            })),
            matched: result.matchedCount,
            groups: shown.groups,
            truncated: result.truncated || shown.dropped,
            ranked: rank !== null,
            warnings: [
              ...new Map(
                result.warnings.map(({ code, message, found }) => [
                  code === "key-outside-target-libraries" ? code : message,
                  { code, message, found },
                ]),
              ).values(),
            ],
            formulaIssues: formulaIssues(
              outcome,
              plan.request.formulas,
              this.#library(),
            ),
          },
          failure: null,
        });
        const current = this.state.getState().view ?? view;
        await this.#show(key, drawsCards(current) ? shown.rows : null);
        this.#shownViewName = view.name;
        this.#shownDataset = view.from ?? "annotations";
        this.#shownBinding = run.binding;
        return;
      }
      default:
        outcome satisfies never;
    }
  }

  #fail(
    { view, plan, key, binding }: ViewRun,
    diagnostic: Diagnostic | QueryViewFailure["diagnostic"],
    issues: NameDictionary<FormulaIssue>,
  ): void {
    const reader = readerSource(diagnostic, this.#library());
    const kept =
      !FORMULA_READ_FAULTS.has(diagnostic.code) &&
      (this.#shownRequest === key ||
        (this.#shownRequest !== null &&
          this.#shownViewName === view.name &&
          this.#shownDataset === (view.from ?? "annotations") &&
          this.#shownBinding === binding));
    if (!kept) void this.#show(null);
    const span =
      "location" in diagnostic && diagnostic.location?.argument === "filter"
        ? diagnostic.location.span
        : undefined;
    const at = plan.fault?.at ?? (span ? plan.locate(span) : null);
    this.state.setState((state) => ({
      phase: "failed",
      results: kept ? state.results : null,
      failure: {
        diagnostic,
        reader,
        filterIssue: at && {
          ...at,
          message: sourceText(reader),
        },
        formulaIssues: issues,
      },
    }));
  }

  #library(): LibraryRead {
    return this.registry.get(zoteroStateAtom);
  }

  async #show(
    key: string | null,
    rows: Parameters<AnnotationsLayout["showRows"]>[0] | null = [],
  ): Promise<void> {
    this.#shownRequest = key;
    if (key === null) {
      this.#shownViewName = null;
      this.#shownBinding = null;
    }
    this.#cardsShown = key !== null && rows !== null;
    if (key === null || rows === null) {
      this.#layout.clear();
      return;
    }
    await this.#layout.showRows(rows, this.#host.attachments?.() ?? []);
  }
}

function Problems({ view }: { view: QueryView }) {
  const problems = useQueryViewState(view, (s) => s.problems);
  const phase = useQueryViewState(view, (s) => s.phase);
  const diagnostic = useQueryViewState(view, (s) => s.failure?.diagnostic);
  const reader = useQueryViewState(view, (s) => s.failure?.reader);
  const marked = useQueryViewState(
    view,
    (s) => (s.failure?.filterIssue ?? null) !== null && s.results !== null,
  );
  const unresolved = useAnnotStore((s) => s.unresolved);
  const hint =
    phase === "failed" && diagnostic
      ? contextHint(diagnostic, view.contextSource)
      : null;
  return (
    <>
      {hint !== null && (
        <p
          className="zt:mx-3 zt:mt-2 zt:mb-0 zt:text-sm zt:text-(--text-muted)"
          data-query-context-hint=""
        >
          {hint}
        </p>
      )}
      {problems.length > 0 && (
        <div
          className="zt:mx-3 zt:mt-2 zt:rounded-sm zt:border-(length:--border-width) zt:border-(--background-modifier-error) zt:p-2 zt:text-sm"
          role="alert"
          data-query-problems=""
        >
          {problems.map((problem) => (
            <p key={problem} className="zt:m-0">
              {problem}
            </p>
          ))}
        </div>
      )}
      {phase === "failed" && marked && (
        <p
          className="zt:mx-3 zt:mt-2 zt:mb-0 zt:text-sm zt:text-(--text-error)"
          role="alert"
          data-query-filter-error=""
        >
          {m.query_view_filter_error()}
        </p>
      )}
      {phase === "failed" && !marked && diagnostic && reader !== undefined && (
        <div
          className="zt:mx-3 zt:mt-2 zt:rounded-sm zt:border-(length:--border-width) zt:border-(--background-modifier-error) zt:p-2 zt:text-sm"
          role="alert"
          data-query-diagnostic={diagnostic.code}
        >
          <p className="zt:m-0 zt:font-semibold">{m.query_view_failed()}</p>
          <DiagnosticText reader={reader} />
        </div>
      )}
      {unresolved.length > 0 && (
        <p
          className="zt:mx-3 zt:mt-2 zt:mb-0 zt:text-sm zt:text-(--text-warning)"
          data-query-unresolved={unresolved.length}
        >
          {m.query_view_unresolved({
            count: unresolved.length,
            keys: unresolved.join(", "),
          })}
        </p>
      )}
    </>
  );
}

function DiagnosticText({ reader }: { reader: QueryViewFailure["reader"] }) {
  if (typeof reader === "string")
    return <p className="zt:m-0 zt:mt-1">{reader}</p>;
  const { sentence, corrections, excerpt } = readerDiagnostic(reader);
  if (!excerpt) return <p className="zt:m-0 zt:mt-1">{readerText(reader)}</p>;
  return (
    <>
      <pre className="zt:m-0 zt:mt-1 zt:overflow-auto zt:text-xs zt:whitespace-pre-wrap">
        {sentence}
        {"\n"}
        {excerpt.line}
        {"\n"}
        {" ".repeat(excerpt.from)}
        <span className="zt:text-(--text-error)">
          {"^".repeat(excerpt.length)}
        </span>
      </pre>
      {corrections.length > 0 && (
        <p className="zt:m-0 zt:mt-1">{correctionsText(corrections)}</p>
      )}
    </>
  );
}

const PARENTS: Partial<Record<string, () => string>> = {
  "item.indexedKey": m.query_view_property_parent_item,
  "attachment.indexedKey": m.query_view_property_source_attachment,
};

function UnusedNote({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const entries = useViewProperties(view);
  if (!current || !entries) return null;
  const { unused } = entries;
  const { engine, name } = datasetSpec(current.from);
  const known = (property: string) => engine.definition(property) !== undefined;
  const unshown = unused.order.filter(known);
  const unsorted = unused.sort.filter(known);
  const properties = [
    ...new Set([
      ...unused.sort.filter((property) => !known(property)),
      ...(unused.groupBy === null ? [] : [unused.groupBy]),
      ...unused.order.filter((property) => !known(property)),
    ]),
  ];
  const labels = (list: readonly string[]) =>
    list
      .map((property) => PARENTS[property]?.() ?? entries.entry(property).label)
      .join(", ");
  const text = [
    properties.length > 0
      ? m.query_view_unused({ dataset: name(), properties: labels(properties) })
      : "",
    unshown.length > 0
      ? m.query_view_unshown({ dataset: name(), properties: labels(unshown) })
      : "",
    unsorted.length > 0
      ? m.query_view_unsorted({ dataset: name(), properties: labels(unsorted) })
      : "",
  ]
    .filter((sentence) => sentence !== "")
    .join(" ");
  if (text === "") return null;
  return (
    <p
      className="zt:mx-3 zt:mt-1 zt:mb-0 zt:text-xs zt:text-(--text-muted) zt:in-[.print]:hidden"
      data-query-unused=""
    >
      {text}
    </p>
  );
}

function Warnings({ view }: { view: QueryView }) {
  const warnings = useQueryViewState(
    view,
    (s) => (s.results ?? NO_RESULTS).warnings,
  );
  if (warnings.length === 0) return null;
  return (
    <>
      {warnings.map((warning) => (
        <p
          key={warning.message}
          className="zt:mx-3 zt:mt-2 zt:mb-0 zt:text-sm zt:text-(--text-warning)"
          data-query-warning={warning.code}
        >
          {readerWarningText(warning)}
        </p>
      ))}
    </>
  );
}

function bodyShows(s: QueryViewState): "rows" | "empty" | "problem" {
  const count = s.results?.count ?? 0;
  if (s.phase === "ready") return count > 0 ? "rows" : "empty";
  if (s.problems.length > 0 || (s.phase === "failed" && count === 0))
    return "problem";
  return "rows";
}

function NoResults({ view }: { view: QueryView }) {
  const dataset = useQueryViewState(view, (s) => s.view?.from);
  const filtered = useQueryViewState(
    view,
    (s) => s.file?.filters !== undefined || s.view?.filters !== undefined,
  );
  const Empty = view.empty;
  const sentence = datasetSpec(dataset).empty();
  return (
    <div className="pane-empty zt:p-2" data-query-empty="">
      {Empty ? (
        <Empty fallback={sentence} />
      ) : (
        <>
          {sentence}
          {filtered && (
            <p className="zt:m-0 zt:mt-1" data-query-empty-hint="">
              {m.query_view_no_results_filter_hint()}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ReadOnlyNote({ view }: { view: QueryView }) {
  useQueryViewState(view, (s) => s.phase);
  const saveFailed = useQueryViewState(view, (s) => s.saveFailed);
  if (view.canSave && !saveFailed) return null;
  return (
    <p
      className="zt:mx-3 zt:mt-1 zt:mb-0 zt:text-xs zt:text-(--text-faint) zt:in-[.print]:hidden"
      data-query-read-only=""
    >
      {m.query_view_read_only()}
    </p>
  );
}

function drawsCards(view: QueryFileView): boolean {
  return layoutOf(view)?.type === "annotations";
}

function ranked<Row extends { indexedKey: string }>(
  rows: readonly Row[],
  rank: readonly string[] | null,
): readonly Row[] {
  if (rank === null) return rows;
  const place = new Map(rank.map((key, index) => [key, index]));
  return rows.toSorted(
    (a, b) =>
      (place.get(a.indexedKey) ?? rank.length) -
      (place.get(b.indexedKey) ?? rank.length),
  );
}

function rankedLayout(
  rows: readonly QueryViewRow[],
  view: QueryFileView,
): LayoutRows & { dropped: boolean } {
  const kept =
    view.limit === undefined || view.limit === null
      ? rows
      : rows.slice(0, view.limit);
  return { ...layoutRows(kept, view), dropped: kept.length < rows.length };
}

function LayoutBody({ view }: { view: QueryView }) {
  const type = useQueryViewState(view, (s) =>
    s.view ? layoutOf(s.view)?.type : null,
  );
  switch (type) {
    case null:
      return null;
    case "list":
      return <ListLayout view={view} />;
    case "cards":
      return <CardsLayout view={view} />;
    case "table":
      return <TableLayout view={view} />;
    case "papers":
      return <PapersLayout view={view} />;
    default:
      return <AnnotationsCards view={view} />;
  }
}

function AnnotationsCards({ view }: { view: QueryView }) {
  const shown = useQueryViewState(view, (s) => s.view);
  const cards = useAnnotStore((s) => s.annotations);
  useLayoutEffect(() => view.drewCards(cards), [view, cards]);
  const options = annotationsLayoutOptions(shown);
  const display = useMemo<CardDisplay>(
    () => ({
      comment: options.showComment,
      tags: options.showTags,
      page: options.showPage,
    }),
    [options.showComment, options.showTags, options.showPage],
  );
  return (
    <CardDisplayContext value={display}>
      <AnnotList collapsed cardWidth={options.cardWidth} />
    </CardDisplayContext>
  );
}

function OpenFileButton({ view }: { view: QueryView }) {
  const { openFile } = view;
  if (!openFile) return null;
  return (
    <ToolbarButton
      icon="external-link"
      label={m.query_view_open_file()}
      labelClassName="zt:sr-only"
      data-query-open-file=""
      onClick={(event) => openFile(event.nativeEvent)}
    />
  );
}

export function SaveAsButton({ view }: { view: QueryView }) {
  const { saveAs } = view;
  if (!saveAs) return null;
  return (
    <ToolbarButton
      icon="file-plus"
      label={m.annot_view_save_as_query_file()}
      data-query-save-as=""
      onClick={() => saveAs()}
    />
  );
}

export function SortButton({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const { literatureNotes } = view.tableDeps;
  const names = useVaultPropertyNames(literatureNotes);
  const properties = useViewProperties(view, names);
  const ranked = useQueryViewState(view, (s) => s.results?.ranked ?? false);
  useQueryViewState(view, (s) => s.defaults);
  if (!current || !properties) return null;
  const sort = current.sort ?? [];
  const set = view.setByResearcher(current).sort;
  const labelOf = (path: string) => properties.entry(path).label;
  return (
    <ToolbarPopover
      icon="arrow-up-down"
      label={m.query_view_sort()}
      active={set.length > 0}
      count={set.length}
      hook="sort"
      {...(ranked && { off: m.query_view_sort_ranked() })}
    >
      <SortEditor
        value={sort}
        options={viewSortOptions(current.from, names, {
          labelOf,
          typeOf: (name) => literatureNotes.propertyType(name),
        })}
        unused={properties.unused.sort}
        labelOf={labelOf}
        onChange={(next) =>
          view.document.editView({ sort: next.length > 0 ? next : undefined })
        }
      />
    </ToolbarPopover>
  );
}

function GroupButton({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const groups = useQueryViewState(
    view,
    (s) => (s.results ?? NO_RESULTS).groups,
  );
  const properties = useViewProperties(view);
  if (!current || !properties) return null;
  return (
    <ToolbarPopover
      icon="layout-list"
      label={m.query_view_group()}
      active={current.groupBy !== undefined}
      hook="group"
    >
      <GroupEditor
        value={{ groupBy: current.groupBy, groupOrder: current.groupOrder }}
        options={groupOptions(
          current.from,
          (path) => properties.entry(path).label,
        )}
        unused={properties.unused.groupBy !== null}
        labelOf={(path) => properties.entry(path).label}
        groups={groups}
        onChange={(next) =>
          view.document.editView({
            groupBy: next.groupBy,
            groupOrder: next.groupOrder,
          })
        }
      />
    </ToolbarPopover>
  );
}

function QueryViewBody({ view }: { view: QueryView }) {
  const search = useSearchBar();
  const shows = useQueryViewState(view, bodyShows);
  const toolbarName = useUniqueId();
  return (
    <div className="zt:flex zt:h-full zt:min-h-0 zt:grow zt:flex-col zt:in-[.print]:h-auto zt:not-in-[.print]:in-[.zt-query-note]:max-h-[var(--zt-query-note-max-height,500px)]">
      {!view.hostsToolbar && (
        <div
          className="zt:@container zt:flex zt:min-h-(--size-4-10) zt:shrink-0 zt:flex-nowrap zt:items-center zt:gap-(--size-2-2) zt:overflow-hidden zt:border-b-(length:--border-width) zt:border-(--table-border-color) zt:ps-[var(--zt-query-toolbar-inset-start,var(--size-2-1))] zt:pe-[var(--zt-query-toolbar-inset-end,var(--size-2-1))] zt:in-[.is-mobile]:min-h-(--touch-size-l) zt:in-[.print]:hidden"
          role="toolbar"
          aria-labelledby={toolbarName}
        >
          <span id={toolbarName} className="zt:sr-only">
            {m.query_view_toolbar_label()}
          </span>
          <ViewMenu view={view} />
          <ResultsMenu view={view} />
          <SortButton view={view} />
          {view.can.group && <GroupButton view={view} />}
          {view.can.filter && <FilterButton view={view} />}
          {view.can.properties && <PropertiesMenu view={view} />}
          {view.can.search && <SearchButton bar={search} />}
          <OpenFileButton view={view} />
          <SaveAsButton view={view} />
        </div>
      )}
      {view.can.search && <SearchRow view={view} bar={search} />}
      <ReadOnlyNote view={view} />
      <UnusedNote view={view} />
      {shows === "problem" ? (
        <PaneState>
          <div className="zt:w-full zt:max-w-120">
            <Problems view={view} />
          </div>
        </PaneState>
      ) : (
        <Problems view={view} />
      )}
      <Warnings view={view} />
      {shows === "empty" && (
        <PaneState>
          <NoResults view={view} />
        </PaneState>
      )}
      <div className="zt:[&:not([hidden])]:contents" hidden={shows !== "rows"}>
        <LayoutBody view={view} />
      </div>
    </div>
  );
}
