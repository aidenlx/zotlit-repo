import type { DisplayNode } from "#core/data-tree/index.ts";
import type { WorkbenchRunner } from "#core/language/host-effects.ts";
import type { ExplorerActions } from "#obsidian/data-explorer/actions.ts";
import type {
  TemplateRoot,
  WorkbenchItemChoice,
} from "#obsidian/workbench-ui/index.tsx";
import type { ChooserScope } from "#obsidian/workbench-ui/suggester.ts";
import { Effect } from "effect";
import type { Cause } from "effect";
import { ItemView, setIcon } from "obsidian";
import type { Menu, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { AppContext } from "@zotlit/obsidian-kit/app-context.ts";
import { ViewRegistryProvider } from "@zotlit/obsidian-kit/view-atoms.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import {
  answerOf,
  inFlightSlot,
  latestSlot,
  makeViewRunner,
} from "@zotlit/obsidian-kit/view-runner.ts";
import type {
  InFlightSlot,
  LatestSlot,
  ViewRunner,
} from "@zotlit/obsidian-kit/view-runner.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import { indexedKeyForClipboard } from "@zotlit/plugin-services/obsidian/indexed-key/actions.ts";
import type { ItemLookupHandle } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { itemKeyFromFrontmatter } from "@zotlit/plugin-services/obsidian/note-index/parse.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import { makeExportTemplateDataCommand } from "./atoms.ts";
import { Explorer } from "./Explorer.tsx";
import { exportTarget } from "./export-file.ts";
import {
  allSectionsCollapsed,
  annotationIndexedKey,
  annotationKeyOfNode,
  ExplorerModelContext,
  holdExplorerModel,
  makeExplorerModel,
  readEphemeralExplorer,
  readSavedExplorer,
  refresh,
  setTarget,
  toggleSections,
} from "./model.ts";
import type { ExplorerSession, ExplorerState } from "./model.ts";

import { getSampleItem } from "#core/editor/selection-data.ts";
import {
  failedRender,
  renderIdentity,
  SAMPLE_ANNOTATIONS,
} from "#core/render/index.ts";
import {
  createExplorerActions,
  ExplorerActionsContext,
} from "#obsidian/data-explorer/actions.ts";
import { rememberTemplateItem } from "#obsidian/data-explorer/item-memory.ts";
import {
  copyToClipboard,
  createTemplateWorkbenchHost,
} from "#obsidian/editor/host.tsx";
import {
  workbenchAnnotationChoice,
  workbenchItemChoice,
  workbenchItemSearch,
} from "#obsidian/editor/item-choice.ts";
import {
  selectionViewTitle,
  updateSelectionTitle,
} from "#obsidian/editor/selection.tsx";
import {
  visibleSectionIds,
  WorkbenchHostProvider,
  NO_MATCH_DATA,
} from "#obsidian/workbench-ui/index.tsx";

export const EXPLORER_VIEW_TYPE = "zotlit-template-data-explorer";
export interface ExplorerViewDeps {
  registry: ViewRegistryHandle;
  itemLookup: Pick<ItemLookupHandle, "search" | "openSession">;
  settings: Pick<PluginSettings["Service"], "current" | "changes">;
  bridge: Pick<EffectBridge, "runSync">;
  pluginVersion: string;
}
export class TemplateDataExplorerView extends ItemView {
  readonly #model = makeExplorerModel();
  readonly #exportCommand = makeExportTemplateDataCommand();
  readonly #deps: ExplorerViewDeps;
  #release: (() => void) | null;
  #root: Root | null = null;
  #cleanup: DisposableStack | null = null;
  #host: ReturnType<typeof createTemplateWorkbenchHost> | null = null;
  readonly #runner: ViewRunner;
  readonly #choosingItem: InFlightSlot<void, never>;
  readonly #choosingAnnotation: InFlightSlot<void, never>;
  #actions: ExplorerActions | null = null;
  #closed = false;
  readonly #choices: LatestSlot<ViewServices>;
  constructor(leaf: WorkspaceLeaf, deps: ExplorerViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    this.#deps = deps;
    this.#release = holdExplorerModel(deps.registry, this.#model);
    this.#runner = makeViewRunner(deps.registry);
    this.#choices = latestSlot(this.#runner.run);
    this.#choosingItem = inFlightSlot(
      this.#choices.run,
      Effect.suspend(() => this.#chooseItem()),
    );
    this.#choosingAnnotation = inFlightSlot(
      this.#choices.run,
      Effect.suspend(() => this.#chooseAnnotation()),
    );
  }
  #state(): ExplorerState {
    return this.#deps.registry.get(this.#model.state);
  }
  #update(transition: (session: ExplorerSession) => ExplorerSession): void {
    this.#deps.registry.update(this.#model.session, transition);
  }
  #setTarget(
    item: WorkbenchItemChoice | null,
    root: TemplateRoot,
    annotationId: string | null = null,
  ): void {
    this.#update(setTarget(item, root, annotationId));
  }
  override getViewType(): string {
    return EXPLORER_VIEW_TYPE;
  }
  override getDisplayText(): string {
    const state = this.#state();
    const title =
      state.root === "note" && typeof state.data?.title === "string"
        ? state.data.title
        : state.item?.title;
    return selectionViewTitle({
      item: state.item && { ...state.item, title: title ?? null },
      annotation:
        state.root === "annotation" && state.data && state.annotationId
          ? { id: state.annotationId, root: state.data }
          : null,
      annotationMode: state.root === "annotation",
      view: "fields",
    });
  }
  override getIcon(): string {
    return "braces";
  }
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_choose_item())
        .setIcon("search")
        .onClick(() => this.#choosingItem.start()),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_choose_annotation())
        .setIcon("highlighter")
        .onClick(() => this.#choosingAnnotation.start()),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(
          this.#allSectionsCollapsed()
            ? m.workbench_explorer_expand_all()
            : m.workbench_explorer_collapse_all(),
        )
        .setIcon(
          this.#allSectionsCollapsed()
            ? "chevrons-up-down"
            : "chevrons-down-up",
        )
        .onClick(() => this.#toggleSections()),
    );
    this.#actions?.addCopyKeyMenuItem(menu);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_refresh_item())
        .setIcon("refresh-cw")
        .onClick(() => this.#update(refresh)),
    );
    this.#actions?.addExportMenuItem(menu);
  }
  override getState(): Record<string, unknown> {
    const { item, annotationId, root, collapsedSections } = this.#state();
    return {
      itemIndexedKey: item?.id ?? null,
      anchorAnnotationKey: annotationId,
      root,
      collapsedSections: [...collapsedSections],
    };
  }
  #allSectionsCollapsed(): boolean {
    if (!this.#host) return false;
    return allSectionsCollapsed(
      this.#shownSections(),
      this.#state().collapsedSections,
    );
  }
  #shownSections(): readonly string[] {
    const { root, data } = this.#state();
    return visibleSectionIds(data, {
      root,
      locale: runtime.getLocale(),
    });
  }
  #toggleSections(): void {
    if (this.#host) this.#update(toggleSections(this.#shownSections()));
  }
  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    const previous = JSON.stringify(this.getState());
    try {
      await answerOf(
        this.#runner.run(this.#restoreState(state, result)),
        undefined,
      );
    } finally {
      if (previous !== JSON.stringify(this.getState())) result.history = true;
    }
  }
  #restoreState(
    state: unknown,
    result: ViewStateResult,
  ): Effect.Effect<void, Cause.UnknownError, ViewServices> {
    return Effect.tryPromise(() => super.setState(state, result)).pipe(
      Effect.map(() => this.#applySaved(state)),
    );
  }
  #applySaved(state: unknown): void {
    const saved = readSavedExplorer(state);
    if (!saved) return;
    const { anchorAnnotationKey: annotationId, root } = saved;
    const item = saved.itemIndexedKey
      ? { id: saved.itemIndexedKey, title: saved.itemIndexedKey }
      : null;
    this.#update((session) =>
      setTarget(
        item,
        root,
        annotationId,
      )({ ...session, collapsedSections: saved.collapsedSections }),
    );
  }
  #presentationContext(): string {
    const { item, root, annotationId } = this.#state();
    return JSON.stringify([item?.id ?? null, root, annotationId]);
  }
  override getEphemeralState(): Record<string, unknown> {
    const { navigation, presentation } = this.#state();
    return {
      zotlitDataExplorer: {
        context: this.#presentationContext(),
        navigation: {
          ...navigation,
          expanded: [...navigation.expanded],
          filterCollapsed: [...navigation.filterCollapsed],
          noteRootExpanded: navigation.noteRootExpanded && [
            ...navigation.noteRootExpanded,
          ],
          preFilterExpanded: navigation.preFilterExpanded && [
            ...navigation.preFilterExpanded,
          ],
        },
        presentation,
      },
    };
  }
  override setEphemeralState(input: unknown): void {
    const saved = readEphemeralExplorer(input);
    if (!saved || saved.context !== this.#presentationContext()) return;
    const { navigation, presentation } = saved;
    const focus = (input as Record<string, unknown>).focus === true;
    this.#update((session) => ({
      ...session,
      navigation,
      presentation,
      restore: { ...presentation, focus },
    }));
  }
  protected override async onOpen(): Promise<void> {
    using cleanup = new DisposableStack();
    const { registry } = this.#deps;
    this.#release ??= holdExplorerModel(registry, this.#model);
    cleanup.defer(registry.mount(this.#exportCommand));
    const sectionsAction = this.addAction(
      "chevrons-down-up",
      m.workbench_explorer_collapse_all(),
      () => this.#toggleSections(),
    );
    let syncedSections: boolean | null = null;
    const syncSectionsAction = () => {
      const collapsed = this.#allSectionsCollapsed();
      if (collapsed === syncedSections) return;
      syncedSections = collapsed;
      setIcon(
        sectionsAction,
        collapsed ? "chevrons-up-down" : "chevrons-down-up",
      );
      sectionsAction.setAttribute(
        "aria-label",
        collapsed
          ? m.workbench_explorer_expand_all()
          : m.workbench_explorer_collapse_all(),
      );
    };
    syncSectionsAction();
    const chooseAction = this.addAction(
      "search",
      m.workbench_choose_item(),
      () => {
        if (this.#state().root === "annotation")
          this.#choosingAnnotation.start();
        else this.#choosingItem.start();
      },
    );
    let previous = this.#state();
    cleanup.defer(
      registry.subscribe(this.#model.state, (state) => {
        const saved = previous;
        previous = state;
        updateSelectionTitle(this);
        syncSectionsAction();
        chooseAction.setAttribute(
          "aria-label",
          state.root === "annotation"
            ? m.workbench_choose_annotation()
            : m.workbench_choose_item(),
        );
        if (
          state.item?.id !== saved.item?.id ||
          state.root !== saved.root ||
          state.annotationId !== saved.annotationId ||
          state.collapsedSections !== saved.collapsedSections
        )
          this.app.workspace.requestSaveLayout();
      }),
    );
    const runner = this.#runner;
    this.#host = cleanup.use(
      createTemplateWorkbenchHost(this.app, {
        run: runner.run,
        render: (request) =>
          Effect.succeed(
            failedRender(renderIdentity(request), { code: "render-error" }),
          ),
        matchData: NO_MATCH_DATA,
        insertTarget: () => null,
      }),
    );
    this.#actions = createExplorerActions({
      onChooseItem: () => this.#choosingItem.start(),
      onBackToNoteRoot: () => {
        this.#setTarget(this.#state().item, "note");
      },
      onToggleSections: () => this.#toggleSections(),
      onRefresh: () => this.#update(refresh),
      canExport: () => this.#exportTarget() !== null,
      onExport: () => this.#export(),
      exportLabel: () =>
        this.#state().root === "annotation" &&
        this.#exportTarget()?.root === "note"
          ? m.template_data_explorer_export_selected_paper()
          : m.template_data_explorer_menu_export_json(),
      copyTarget: () => {
        const target = this.#exportTarget();
        return target
          ? {
              indexedKey: target.indexedKey,
              kind: target.root === "annotation" ? "annotation" : "item",
            }
          : null;
      },
    });
    this.#root = cleanup.adopt(createRoot(this.contentEl), (root) =>
      root.unmount(),
    );
    this.#mount();
    this.#cleanup = cleanup.move();
    updateSelectionTitle(this);
    if (this.#closed) return;
    if (!this.#state().item) {
      const file = this.app.workspace.getActiveFile();
      const key = file
        ? itemKeyFromFrontmatter(this.app.metadataCache.getFileCache(file))
        : null;
      if (key) this.#setTarget({ id: key, title: key }, "note");
    } else this.#update(refresh);
  }
  #chooserScope(host: { readonly run: WorkbenchRunner }): ChooserScope {
    return { app: this.app, window: this.contentEl.win, run: host.run };
  }
  #mount(): void {
    if (!this.#host || !this.#actions) return;
    this.#root?.render(
      <AppContext value={this.app}>
        <WorkbenchHostProvider host={this.#host}>
          <ViewRegistryProvider registry={this.#deps.registry}>
            <ExplorerModelContext value={this.#model}>
              <ExplorerActionsContext value={this.#actions}>
                <Explorer
                  onSelectAnnotation={(id) => this.#selectAnnotation(id)}
                  onChooseAnnotation={() => this.#choosingAnnotation.start()}
                  onSelectItem={(item) => this.#selectItem(item)}
                  onSearchItem={() => this.#choices.run(this.#searchItem())}
                  explorer={{
                    copy: copyToClipboard,
                    canExploreAnnotation: (node) =>
                      this.#annotationKey(node) !== null,
                    onExploreAnnotation: (node) => {
                      const key = this.#annotationKey(node);
                      if (key) {
                        this.#selectAnnotation(key);
                      }
                    },
                  }}
                />
              </ExplorerActionsContext>
            </ExplorerModelContext>
          </ViewRegistryProvider>
        </WorkbenchHostProvider>
      </AppContext>,
    );
  }
  #annotationKey(node: DisplayNode): string | null {
    const { item, root } = this.#state();
    const key = annotationKeyOfNode(root, node);
    if (!item || key === null) return null;
    const parsed = parseIndexedKey(item.id);
    if (getSampleItem(item.id)) return key;
    return parsed
      ? indexedKeyForClipboard({ key, groupID: parsed.groupID })
      : null;
  }
  #exportTarget() {
    const { item, root, annotationId, status } = this.#state();
    if (status !== "ready" && status !== "empty") return null;
    const sample =
      !annotationId || SAMPLE_ANNOTATIONS.some(({ id }) => id === annotationId);
    const annotation =
      item && !sample ? annotationIndexedKey(item.id, annotationId) : null;
    if (root === "annotation" && !sample && !annotation) return null;
    return exportTarget(item, root, annotation);
  }
  #export(): void {
    const target = this.#exportTarget();
    if (target)
      this.#deps.registry.set(this.#exportCommand, {
        ...target,
        pluginVersion: this.#deps.pluginVersion,
      });
  }
  #chooseItem(): Effect.Effect<void, never, ViewServices> {
    return Effect.gen({ self: this }, function* () {
      const host = this.#host;
      if (!host) return;
      const previous = this.#state().item;
      yield* this.#pickItem(
        workbenchItemChoice(
          this.#chooserScope(host),
          this.#searchDeps(),
          previous ?? undefined,
        ),
      );
    });
  }
  #searchItem(): Effect.Effect<void, never, ViewServices> {
    return this.#pickItem(workbenchItemSearch(this.#searchDeps()));
  }
  #searchDeps() {
    return {
      app: this.app,
      lookup: this.#deps.itemLookup,
      settings: this.#deps.settings,
      bridge: this.#deps.bridge,
    };
  }
  #pickItem<R>(
    choice: Effect.Effect<WorkbenchItemChoice | null, never, R>,
  ): Effect.Effect<void, never, R> {
    return Effect.gen({ self: this }, function* () {
      const previous = this.#state().item;
      const item = yield* choice;
      if (!item || this.#state().item !== previous) return;
      this.#selectItem(item);
    });
  }
  #selectItem(item: WorkbenchItemChoice): void {
    const state = this.#state();
    if (this.#closed) return;
    this.#setTarget(item, state.root, state.annotationId);
    if (!getSampleItem(item.id)) rememberTemplateItem(this.app, item.id);
  }
  #selectAnnotation(id: string): void {
    this.#setTarget(this.#state().item, "annotation", id);
  }
  #chooseAnnotation(): Effect.Effect<void, never, ViewServices> {
    return Effect.gen({ self: this }, function* () {
      const host = this.#host;
      if (!host) return;
      const state = this.#state();
      const id = yield* workbenchAnnotationChoice(
        this.#chooserScope(host),
        state.annotations ?? [],
        state.item
          ? (annotationIndexedKey(state.item.id, state.annotationId) ??
              state.annotationId)
          : state.annotationId,
      );
      if (id !== null && state.item === this.#state().item)
        this.#selectAnnotation(id);
    });
  }
  protected override async onClose(): Promise<void> {
    this.#closed = true;
    this.#cleanup?.dispose();
    this.#cleanup = null;
    this.#root = null;
    this.#host = null;
    this.#actions = null;
    this.#release?.();
    this.#release = null;
    await this.#runner[Symbol.asyncDispose]();
  }
}
