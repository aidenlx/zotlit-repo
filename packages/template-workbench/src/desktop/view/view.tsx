import type {
  WorkbenchDocumentKind,
  WorkbenchProblem,
  WorkbenchSliceRange,
} from "#core/document/index.ts";
import type {
  PartialChoice,
  PartialContext,
  WorkbenchReportContext,
} from "#core/render/index.ts";
import type { TemplateDataExportTarget } from "#desktop/data-explorer/export-file.ts";
import type {
  PreviewRenderDeps,
  PreviewRenderResult,
} from "#desktop/view/preview/render.ts";
import type { ExplorerActions } from "#obsidian/data-explorer/actions.ts";
import type { CreateSharedPartialOptions } from "#obsidian/view/new-partial.ts";
import type {
  FieldInsertionContext,
  FieldInsertOptions,
  WorkbenchHostError,
  WorkbenchEditorInstance,
  WorkbenchFieldsAction,
  WorkbenchHost,
  WorkbenchInsertTarget,
  WorkbenchItemChoice,
  WorkbenchModel,
  WorkbenchViewState,
  TemplateRoot,
  WorkbenchPanels,
  PartialPlaceholderHost,
  ViewSize,
} from "#obsidian/workbench-ui/index.tsx";
import type { ChooserScope } from "#obsidian/workbench-ui/suggester.ts";
import { EditorView } from "@codemirror/view";
import { useAtomValue } from "@effect/atom-react";
import { Cause, Effect, Schema, Semaphore, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { apiVersion, Menu, Scope, TextFileView } from "obsidian";
import type {
  App,
  TFile,
  HoverParent,
  HoverPopover,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { bibliographyRevisionAtom } from "@zotlit/citations/obsidian/pandoc/atoms.ts";
import type { UpdateResult } from "@zotlit/notes/desktop/note-feature/operations.ts";
import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { updateNoteToast } from "@zotlit/notes/desktop/note-feature/update-single.ts";
import { plainNoteError } from "@zotlit/notes/obsidian/note-feature/errors.ts";
import {
  defaultProfilePathAtom,
  profilesAtom,
} from "@zotlit/notes/obsidian/profile/atoms.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { reportCitationTemplateOpen } from "@zotlit/notes/obsidian/template/actions.ts";
import { templateFolderAtom } from "@zotlit/notes/obsidian/template/atoms.ts";
import {
  partialDocumentsAtom,
  partialNamesAtom,
  templateRevisionAtom,
} from "@zotlit/notes/obsidian/template/atoms.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import type { PartialUnpackOutcome } from "@zotlit/notes/obsidian/template/service.ts";
import type { ArrivingProblem } from "@zotlit/notes/obsidian/template/workbench-recovery.ts";
import { AppContext } from "@zotlit/obsidian-kit/app-context.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import { communityUrl, docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import { Notifier, withOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeMessage } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import {
  ViewRegistryProvider,
  viewRuntime,
  watch,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import {
  answerOf,
  inFlightSlot,
  joinOnView,
  latestSlot,
  makeViewRunner,
} from "@zotlit/obsidian-kit/view-runner.ts";
import type {
  InFlightSlot,
  LatestSlot,
  ViewRunner,
} from "@zotlit/obsidian-kit/view-runner.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ItemLookupHandle } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import type { ItemSearchDeps } from "@zotlit/plugin-services/obsidian/item-lookup/search-modal.ts";
import { itemKeyFromFrontmatter } from "@zotlit/plugin-services/obsidian/note-index/parse.ts";
import type { TemplateLanguage } from "@zotlit/templates/facade";
import { zoteroStateAtom } from "@zotlit/zotero-reads/client/atoms.ts";

import {
  builtInSource,
  installedStyles,
  materializeDefault,
  profileOfFile,
} from "./atoms.ts";
import {
  FieldsMoreOptions,
  FieldsPanel,
  makeFieldsActions,
  makeFieldsPanelModel,
} from "./fields-panel.tsx";
import type { FieldsPanelModel } from "./fields-panel.tsx";
import { ViewItemRow } from "./item-row.tsx";
import { openWorkbenchLayout, setLeafState } from "./layout.ts";
import {
  holdTemplateWorkbenchModel,
  makePartialPreviews,
  makeTemplateWorkbenchModel,
  readEphemeralWorkbench,
  readSavedWorkbench,
  savedWorkbench,
  setPresentation,
} from "./model.ts";
import type { TemplateWorkbenchModel } from "./model.ts";
import { openTemplateWorkbench } from "./open.ts";
import { createSharedPartialEffect } from "./partial-command.ts";
import {
  PreviewPanel,
  WorkbenchMarkdown,
  previewTarget,
} from "./preview-panel.tsx";

import {
  externalEdit,
  WorkbenchDocumentController,
  entryPosition,
} from "#core/document/index.ts";
import { getSampleItem } from "#core/editor/selection-data.ts";
import {
  CITATION_EXAMPLE_IDS,
  DEFAULT_PARTIAL_CONTEXT,
  failedRender,
  isPartialContext,
  renderIdentity,
} from "#core/render/index.ts";
import { makeExportTemplateDataCommand } from "#desktop/data-explorer/atoms.ts";
import { exportTarget } from "#desktop/data-explorer/export-file.ts";
import { templateWorkbenchAction } from "#desktop/editor/actions.ts";
import {
  previewResult,
  retainPreviewOutputs,
  makePreviewRenderer,
} from "#desktop/view/preview/render.ts";
import { rememberTemplateItem } from "#obsidian/data-explorer/item-memory.ts";
import { partialCall } from "#obsidian/editor/extract-partial.ts";
import {
  createTemplateWorkbenchHost,
  hostEffect,
} from "#obsidian/editor/host.tsx";
import {
  workbenchAnnotationChoice,
  workbenchItemChoice,
} from "#obsidian/editor/item-choice.ts";
import { ViewMatchPane } from "#obsidian/editor/match-pane.tsx";
import {
  templateDocumentKind,
  templatePartialName,
} from "#obsidian/view/document-kind.ts";
import { fieldsActionHost } from "#obsidian/view/fields-popover.tsx";
import { createMatchData } from "#obsidian/view/match-data.ts";
import {
  readPartialChoice,
  writePartialChoice,
} from "#obsidian/view/partial-choice-memory.ts";
import {
  chooseAnnotation,
  chooseCitation,
  chooseItem,
  choosePartialProfile,
  citationExampleLabel,
  entryDiagnostics,
  fieldsActionAttributes,
  patchAt,
  pressFieldsAction,
  repairCommands,
  insertionTarget,
  setAdvanced,
  setPanelWidth,
  setPreview,
  setPreviewHeight,
  setRoot,
  setTab,
  showPreview,
  HELP_PAGES,
} from "#obsidian/workbench-ui/index.tsx";
import {
  AnnotationPane,
  diagnosticText,
  createWorkbenchEditor,
  NameFolderPane,
  NotePane,
  PropertiesPane,
  ProblemsFooter,
  WorkbenchDiagnosticsProvider,
  useWorkbenchProblems,
  workbenchDiagnoses,
  renderDiagnosis,
  SliceEditor,
  usePartialBoxes,
  TabBar,
  TabPanel,
  TABS,
  tabsFor,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
  SidePanels,
  AnnotationSampleBar,
} from "#obsidian/workbench-ui/index.tsx";
import {
  originatingNoteNotice,
  templateWorkbenchButton,
  selectionHint,
} from "#obsidian/workbench-ui/look.ts";
import { PANEL_HANDLE_WIDTH } from "#obsidian/workbench-ui/panel-layout.ts";
import {
  panelSizeMenus,
  pickPanelSize,
} from "#obsidian/workbench-ui/panel-menu.ts";

export const TEMPLATE_WORKBENCH_VIEW_TYPE = "zotlit-template-workbench";

class StaleSourceRead extends Schema.TaggedError<
  StaleSourceRead,
  { readonly brand: unique symbol }
>()("StaleSourceRead", {}) {}
export type OriginatingNoteUpdateOutcome =
  | { outcome: "no-target" }
  | { outcome: "unavailable" | "save-failed" | "not-ready"; name: string }
  | { outcome: "updated" | "refused"; name: string; result: UpdateResult };

export class OriginatingNoteUpdateError extends Schema.TaggedError<
  OriginatingNoteUpdateError,
  { readonly brand: unique symbol }
>()("OriginatingNoteUpdateError", {
  note: Schema.String,
  cause: Schema.Defect(),
}) {}

export function unpackedPartialNotices(
  result: Pick<
    PartialUnpackOutcome,
    "written" | "kept" | "otherCase" | "refused"
  >,
): string[] {
  const { written, kept, otherCase, refused } = result;
  return [
    ...(written.length > 0
      ? [m.notice_partials_unpacked({ names: written.join(", ") })]
      : []),
    ...(kept.length > 0
      ? [m.notice_partials_kept({ names: kept.join(", ") })]
      : []),
    ...(otherCase.length > 0
      ? [m.notice_partials_other_case({ names: otherCase.join(", ") })]
      : []),
    ...(refused.length > 0
      ? [m.notice_partials_refused({ names: refused.join(", ") })]
      : []),
  ];
}

export function originatingNoteUpdateNotice(
  app: App,
  result: OriginatingNoteUpdateOutcome,
): string | DocumentFragment | null {
  const feedback = updateNoteToast("full", { app });
  switch (result.outcome) {
    case "no-target":
      return null;
    case "unavailable":
      return m.template_workbench_update_unavailable({ name: result.name });
    case "save-failed":
      return m.template_workbench_update_save_failed();
    case "not-ready":
      return m.template_workbench_update_not_ready();
    case "refused":
    case "updated": {
      if (result.result.bodyUpdated && !result.result.diagnostic)
        return m.template_workbench_updated_note({ name: result.name });
      const message = feedback.success(result.result);
      return !result.result.diagnostic && typeof message === "string"
        ? m.template_workbench_note_update_result({
            name: result.name,
            result: message,
          })
        : message;
    }
  }
}

export interface TemplateWorkbenchDeps {
  registry: ViewRegistryHandle;
  render?: WorkbenchHost["render"];
  previewRender?: PreviewRenderDeps;
  pluginVersion?: string;
  itemLookup: Pick<ItemLookupHandle, "search" | "openSession">;
  settings: ItemSearchDeps["settings"];
  bridge: ItemSearchDeps["bridge"];
}

const PANEL_SIZE_ICONS = {
  horizontal: {
    menu: "move-horizontal",
    grow: "unfold-horizontal",
    shrink: "fold-horizontal",
    reset: "rotate-ccw",
  },
  vertical: {
    menu: "move-vertical",
    grow: "unfold-vertical",
    shrink: "fold-vertical",
    reset: "rotate-ccw",
  },
} as const;

export class TemplateWorkbenchView extends TextFileView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  readonly #editor: WorkbenchEditorInstance<PreviewRenderResult>;
  readonly viewSize = Atom.make<ViewSize | null>(null);
  #sizeObserver: ResizeObserver | null = null;
  readonly #revealListeners = new Set<
    (target: Pick<WorkbenchProblem, "slice" | "range" | "params">) => void
  >();
  readonly #openProblemsListeners = new Set<() => void>();
  #arrival: ArrivingProblem | null = null;
  readonly model: TemplateWorkbenchModel;
  readonly partialPreviews: ReturnType<typeof makePartialPreviews> | null;
  readonly fields: FieldsPanelModel;
  readonly fieldsActions: ExplorerActions;
  get registry() {
    return this.#deps.registry;
  }
  get workbench(): WorkbenchModel<PreviewRenderResult> {
    return this.#editor.model;
  }
  readonly change = {
    setTab: (tab: WorkbenchViewState["tab"]) => this.#update(setTab(tab)),
    setRoot: (root: TemplateRoot) => this.#update(setRoot(root)),
    setAdvanced: (advanced: boolean) => this.#update(setAdvanced(advanced)),
  };
  get #view(): WorkbenchViewState {
    return this.registry.get(this.model.view);
  }
  #update(transition: (state: WorkbenchViewState) => WorkbenchViewState) {
    this.registry.update(this.model.view, transition);
  }
  readonly #runner: ViewRunner;
  readonly #exportCommand = makeExportTemplateDataCommand();
  #release: (() => void) | null;
  readonly #cleanup = new DisposableStack();
  readonly #deps: TemplateWorkbenchDeps;
  readonly #host: ReturnType<typeof createTemplateWorkbenchHost>;
  #controller = new WorkbenchDocumentController("");
  #root: Root | null = null;
  #updateActions = () => {};
  readonly #fieldsButton: { current: HTMLElement | null } = { current: null };
  readonly #fieldsAction: WorkbenchFieldsAction = fieldsActionHost(
    this.#fieldsButton,
    { current: this.contentEl },
  );
  #unsubscribe: (() => void) | null = null;
  #closed = false;
  #loads = 0;
  #partialChoiceFile: string | null = null;
  get #defaultDraft(): boolean {
    return this.registry.get(this.model.defaultDraft);
  }
  set #defaultDraft(value: boolean) {
    this.registry.set(this.model.defaultDraft, value);
  }
  #bindingDraft = false;
  #receivingSource = false;
  #sourceRevision = 0;
  readonly #reads: LatestSlot<ViewServices>;
  #initialRead: object | null = null;
  #pendingSource: string | null = null;
  #clearing = false;
  readonly #origins: LatestSlot<ViewServices>;
  readonly #saveLock = Semaphore.makeUnsafe(1);
  readonly #noteUpdates: InFlightSlot<
    OriginatingNoteUpdateOutcome,
    OriginatingNoteUpdateError
  >;
  readonly #customizing: InFlightSlot<void, never>;
  readonly #styles: InFlightSlot<void, never>;

  #saveFile(clear?: boolean): Effect.Effect<void, Cause.UnknownError> {
    const write = () => super.save(clear);
    return this.#saveLock.withPermit(
      Effect.uninterruptible(Effect.tryPromise(() => write())),
    );
  }
  override save(clear?: boolean): Promise<void> {
    return answerOf(this.#runner.run(this.#saveFile(clear)), undefined);
  }

  get originatingNote(): TFile | null {
    return this.registry.get(this.model.origin)?.file ?? null;
  }
  get updatingNote(): boolean {
    return this.registry.get(this.model.updating);
  }
  #start(flow: Effect.Effect<unknown, never, ViewServices>): void {
    this.#runner.run(flow);
  }
  setOriginatingNote(file: TFile | null) {
    return this.#origins.join(
      Effect.gen({ self: this }, function* () {
        const indexedKey =
          file &&
          itemKeyFromFrontmatter(
            yield* MetadataCache.use((metadata) => metadata.fileCache(file)),
          );
        const resolved = file ? yield* profileOfFile(file) : null;
        this.registry.set(
          this.model.origin,
          file && indexedKey && resolved?.ok
            ? {
                file,
                indexedKey,
                template: this.file,
                profile: resolved.profile.selector,
              }
            : null,
        );
        return file && (!indexedKey || !resolved?.ok) ? file.basename : null;
      }),
      null,
    );
  }
  updateOriginatingNote(): Effect.Effect<
    OriginatingNoteUpdateOutcome,
    OriginatingNoteUpdateError
  > {
    return this.#noteUpdates.join;
  }
  #act(operation: string, action: Effect.Effect<void, unknown, ViewServices>) {
    this.#start(Effect.ignore(templateWorkbenchAction(operation, action)));
  }
  startNoteUpdate(): void {
    this.#noteUpdates.start();
  }
  startCustomize(): void {
    this.#customizing.start();
  }
  startItemChoice(): void {
    this.#start(this.chooseItem());
  }
  startAnnotationChoice(): void {
    this.#start(this.chooseAnnotation());
  }
  startStylesRefresh(): void {
    this.#styles.start();
  }
  #noteUpdate(): Effect.Effect<
    OriginatingNoteUpdateOutcome,
    OriginatingNoteUpdateError,
    ViewServices
  > {
    return Effect.gen({ self: this }, function* () {
      return yield* withOutcome(this.#updateOriginatingNote(), {
        success: (result): NoticeMessage | undefined =>
          originatingNoteUpdateNotice(this.app, result) ?? undefined,
        error: (error) =>
          updateNoteToast("full", { app: this.app }).error(
            error instanceof OriginatingNoteUpdateError ? error.cause : error,
          ),
      });
    });
  }
  toHostEffect<A, E>(
    effect: Effect.Effect<A, E, ViewServices>,
  ): Effect.Effect<A, WorkbenchHostError> {
    return hostEffect(this.#runner.provide(effect));
  }
  #updateOriginatingNote(): Effect.Effect<
    OriginatingNoteUpdateOutcome,
    OriginatingNoteUpdateError,
    ViewServices
  > {
    return Effect.gen({ self: this }, function* () {
      const origin = this.registry.get(this.model.origin);
      if (!origin) return { outcome: "no-target" } as const;
      const name = origin.file.basename;
      const vault = yield* Vault;
      const available = Effect.gen({ self: this }, function* () {
        return (
          this.registry.get(this.model.origin) === origin &&
          this.file === origin.template &&
          (yield* vault.getFileByPath(origin.file.path)) === origin.file
        );
      });
      if (!(yield* available)) return { outcome: "unavailable", name } as const;
      const saved = Effect.gen({ self: this }, function* () {
        const file = this.file;
        return (
          file !== null && (yield* vault.read(file)) === this.getViewData()
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logError("Failed to read the saved template").pipe(
            Effect.annotateLogs({ error }),
            Effect.as(false),
          ),
        ),
      );
      const written = yield* this.#saveFile().pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.logError("Failed to save template before note update").pipe(
            Effect.annotateLogs({ error }),
            Effect.as(false),
          ),
        ),
      );
      if (!written || !(yield* saved))
        return { outcome: "save-failed", name } as const;
      const revision = this.#sourceRevision;
      const settled = yield* (yield* Template).waitUntilSettled(10_000);
      if (settled !== "settled") return { outcome: "not-ready", name } as const;
      if (!(yield* saved)) return { outcome: "save-failed", name } as const;
      const refusal = Effect.gen({ self: this }, function* () {
        if (!(yield* available))
          return { outcome: "unavailable", name } as const;
        return this.#sourceRevision !== revision
          ? ({ outcome: "not-ready", name } as const)
          : null;
      });
      const before = yield* refusal;
      if (before) return before;
      return yield* (yield* NoteFeature)
        .updateNote(origin.file, {
          indexedKey: origin.indexedKey,
          scope: "full",
          profile: origin.profile,
          beforeWrite: () => {
            if (this.#runner.runSync(refusal))
              throw new Error("The originating note moved on");
          },
        })
        .pipe(
          Effect.map((result): OriginatingNoteUpdateOutcome =>
            result.diagnostic?.code === "literature-note-key-changed"
              ? { outcome: "unavailable", name }
              : {
                  outcome: result.diagnostic ? "refused" : "updated",
                  name,
                  result,
                },
          ),
          Effect.catch((error) =>
            Effect.flatMap(refusal, (refused) =>
              refused
                ? Effect.succeed(refused)
                : Effect.fail(
                    new OriginatingNoteUpdateError({
                      note: name,
                      cause: plainNoteError(error),
                    }),
                  ),
            ),
          ),
        );
    }).pipe(withLogCategory("template-workbench"));
  }

  constructor(leaf: WorkspaceLeaf, deps: TemplateWorkbenchDeps) {
    super(leaf);
    this.#deps = deps;
    const renderer = deps.previewRender
      ? makePreviewRenderer(deps.previewRender)
      : null;
    this.model = makeTemplateWorkbenchModel();
    this.#release = holdTemplateWorkbenchModel(deps.registry, this.model);
    this.#runner = makeViewRunner(deps.registry);
    this.#origins = latestSlot(this.#runner.run);
    this.#reads = latestSlot(this.#runner.run);
    this.#noteUpdates = inFlightSlot(
      this.#runner.run,
      Effect.suspend(() => this.#noteUpdate()),
      () => this.registry.set(this.model.updating, this.#noteUpdates.running()),
    );
    this.#customizing = inFlightSlot(
      this.#runner.run,
      Effect.suspend(() => this.#customize()),
    );
    this.#styles = inFlightSlot(
      this.#runner.run,
      Effect.suspend(() => this.#refreshStyles()),
    );
    this.#cleanup.defer(deps.registry.mount(this.#exportCommand));
    this.#cleanup.defer(deps.registry.mount(templateFolderAtom));
    this.#cleanup.defer(deps.registry.mount(defaultProfilePathAtom));
    this.#cleanup.defer(deps.registry.mount(partialDocumentsAtom));
    this.#cleanup.defer(deps.registry.mount(zoteroStateAtom));
    this.#cleanup.defer(deps.registry.mount(profilesAtom));
    this.contentEl.addClass("zt-root", "zt-template-workbench");
    const previewRenderer = renderer;
    const render: WorkbenchHost["render"] =
      (previewRenderer
        ? (request) => this.toHostEffect(previewRenderer.render(request))
        : deps.render) ??
      ((request) =>
        Effect.succeed(
          failedRender(renderIdentity(request), { code: "render-error" }),
        ));
    this.#host = createTemplateWorkbenchHost(this.app, {
      run: this.#runner.run,
      render,
      ...(deps.previewRender && {
        openCitationEngineSettings:
          deps.previewRender.openCitationEngineSettings,
      }),
      markdown: (props) => <WorkbenchMarkdown {...props} view={this} />,
      matchData: createMatchData(this.#runner.provide),
      insertTarget: () => this.insertTarget,
      partials: {
        names: () => this.partialNames,
        create: (query) =>
          this.toHostEffect(
            createSharedPartialEffect(this.app, {
              name: query,
              from: this.leaf,
            }),
          ),
      },
      extractPartial: (source) =>
        this.#runner.provide(this.#extractPartial(source)),
      hoverParent: this,
      fieldsAction: this.#fieldsAction,
    });
    this.#editor = createWorkbenchEditor({
      host: this.#host,
      registry: deps.registry,
      runtime: viewRuntime,
      view: this.model.view,
      partialName: Atom.map(this.model.document, (facts) => facts.partialName),
      itemData: this.model.itemData,
      viewSize: this.viewSize,
      controller: this.#controller,
      reportContext: () => this.reportContext(this.#defaultRoot),
      mapResult: previewResult,
      retain: retainPreviewOutputs,
    });
    this.partialPreviews =
      renderer &&
      makePartialPreviews({
        model: this.model,
        workbench: this.#editor.model,
        renderPartial: renderer.partial,
        source: () => this.#controller.source,
      });
    this.fields = makeFieldsPanelModel(this.model, this.#editor.model, {
      document: this.#editor.model.document,
      insertTarget: () => this.insertTarget,
    });
    this.#cleanup.defer(deps.registry.mount(this.fields.local));
    this.fieldsActions = makeFieldsActions(this, (target) =>
      this.exportTemplateData(target),
    );
    this.#cleanup.defer(this.#follow());
    this.#cleanup.defer(this.#logRenders());
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "z", (event) => this.#history(event, false));
    this.scope.register(["Mod", "Shift"], "z", (event) =>
      this.#history(event, true),
    );
    this.scope.register(["Mod"], "y", (event) => this.#history(event, true));
    this.#subscribe();
    this.#cleanup.defer(
      this.#runner.subscribe(
        Stream.unwrap(Effect.map(Workspace, (workspace) => workspace.changes)),
        (event) => {
          if (event._tag !== "quick-preview") return;
          const { file, source } = event;
          if (
            this.#closed ||
            this.#defaultDraft ||
            this.#bindingDraft ||
            file !== this.file
          )
            return;
          if (this.#initialRead !== null) {
            this.#pendingSource = source;
            return;
          }
          if (source === this.#controller.source) return;
          this.#receivingSource = true;
          try {
            this.#controller.applyExternalSource(source);
            this.dirty = true;
          } finally {
            this.#receivingSource = false;
          }
        },
      ),
    );
    this.#cleanup.defer(
      watch(deps.registry, this.model.bindingDefaults, () =>
        this.#invalidate(),
      ),
    );
  }
  #log(entry: Effect.Effect<void>): void {
    this.#runner.run(entry.pipe(withLogCategory("template-workbench")));
  }
  #logRenders(): () => void {
    const { registry } = this;
    const { state } = this.workbench.scheduler;
    let previous = registry.get(state);
    return registry.subscribe(state, (next) => {
      const before = previous;
      previous = next;
      if (next.busy === before.busy) return;
      const revision = registry.get(this.model.read).snapshot?.revision;
      this.#log(
        next.busy
          ? Effect.logDebug("Preview render started").pipe(
              Effect.annotateLogs({
                revision,
                live: registry.get(this.workbench.preview).live,
              }),
            )
          : next.result !== null && next.result !== before.result
            ? Effect.logDebug("Preview render published").pipe(
                Effect.annotateLogs({
                  revision: next.result.snapshotRevision,
                  diagnostics: next.result.diagnostics.length,
                }),
              )
            : Effect.logDebug("Discarded stale preview render").pipe(
                Effect.annotateLogs({ revision, closed: this.#closed }),
              ),
      );
    });
  }
  #invalidate(): void {
    if (!this.#closed)
      this.registry.set(this.workbench.scheduler.invalidate, undefined);
  }
  #follow(): () => void {
    const { registry, model } = this;
    const stops: (() => void)[] = [];
    stops.push(
      watch(registry, model.view, (next, previous) => {
        if (next.root !== previous.root && this.documentKind === "partial")
          this.#rememberPartialChoice();
        if (
          next.tab !== previous.tab ||
          next.root !== previous.root ||
          next.advanced !== previous.advanced ||
          next.item?.id !== previous.item?.id
        )
          this.#runner.runSync(
            Workspace.use((workspace) => workspace.requestSaveLayout),
          );
      }),
    );
    stops.push(
      registry.subscribe(this.workbench.choices, () =>
        this.#runner.runSync(
          Workspace.use((workspace) => workspace.requestSaveLayout),
        ),
      ),
      registry.subscribe(this.workbench.panels, () => {
        this.#updateActions();
        this.#runner.runSync(
          Workspace.use((workspace) => workspace.requestSaveLayout),
        );
      }),
      registry.subscribe(this.workbench.fieldsAction, () =>
        this.#updateActions(),
      ),
    );
    stops.push(
      watch(registry, model.read, (next, previous) => {
        if (
          next.status === "error" &&
          next.error &&
          next.error !== previous.error
        )
          registry.set(this.workbench.scheduler.fail, {
            code: "render-error",
            message: next.error,
          });
      }),
    );
    if (this.#deps.previewRender) stops.push(this.#followRenderInputs());
    return () => {
      for (const stop of stops.reverse()) stop();
    };
  }
  #followRenderInputs(): () => void {
    const previewRender = this.#deps.previewRender!;
    const { registry } = previewRender;
    const stops: (() => void)[] = [];
    for (const atom of [templateRevisionAtom, bibliographyRevisionAtom])
      stops.push(
        watch(registry, atom, (next, previous) => {
          if (next !== previous) this.#invalidate();
        }),
      );
    stops.push(
      this.#runner.subscribe(
        Stream.unwrap(Effect.map(Vault, (vault) => vault.changes)),
        (event) => {
          if (
            event._tag === "modify" &&
            event.file.path ===
              this.registry.get(this.workbench.scheduler.state).result
                ?.sourcePath
          )
            this.#invalidate();
        },
      ),
    );
    return () => {
      for (const stop of stops.reverse()) stop();
    };
  }

  get previewRenderDeps(): PreviewRenderDeps | undefined {
    return this.#deps.previewRender;
  }
  get documentKind(): WorkbenchDocumentKind {
    return this.#controller.kind;
  }
  reportContext(
    root: TemplateRoot,
    selection: string | null = this.#view.item?.id ?? null,
  ): WorkbenchReportContext {
    const path = this.file?.path;
    const version = this.#deps.pluginVersion;
    return {
      ...(path === undefined ? {} : { document: path }),
      language: this.#controller.language,
      root,
      ...(selection === null ? {} : { selection }),
      ...(version === undefined ? {} : { zotlitVersion: version }),
      hostVersion: `Obsidian ${apiVersion}`,
    };
  }
  get #templateFolder(): string {
    return this.registry.get(templateFolderAtom);
  }
  get #defaultRoot(): TemplateRoot {
    if (this.documentKind === "citation") return "citation";
    return this.documentKind === "partial" ? this.partialContext : "note";
  }
  get partialContext(): PartialContext {
    const { root } = this.#view;
    return isPartialContext(root) ? root : DEFAULT_PARTIAL_CONTEXT;
  }
  get partialProfile(): string | null {
    return this.registry.get(this.workbench.choices).partialProfile;
  }
  setPartialSelection(selection: PartialChoice): void {
    if (this.documentKind !== "partial") return;
    this.registry.update(
      this.workbench.choices,
      choosePartialProfile(selection.profile),
    );
    this.#update(setRoot(selection.context));
    this.#rememberPartialChoice();
  }

  #rememberPartialChoice(): void {
    if (this.documentKind !== "partial") return;
    writePartialChoice(this.app, this.file?.path ?? null, {
      context: this.partialContext,
      profile: this.partialProfile,
    });
  }
  #panelsBox: HTMLElement | null = null;
  readonly measurePanels = (box: HTMLElement | null): void => {
    this.#panelsBox = box;
    if (!this.#closed) this.#observeSize(this.contentEl.win);
  };
  #observeSize(win: Window): void {
    this.#sizeObserver?.disconnect();
    const { ResizeObserver } = win as typeof window;
    const observer = new ResizeObserver(() => this.#measure());
    observer.observe(this.#panelsBox ?? this.contentEl);
    this.#sizeObserver = observer;
    this.#measure();
  }
  #measure(): void {
    const { clientWidth: width, clientHeight: height } =
      this.#panelsBox ?? this.contentEl;
    if (width === 0 || height === 0) return;
    const current = this.registry.get(this.viewSize);
    if (current?.width !== width || current.height !== height)
      this.registry.set(this.viewSize, {
        width,
        height,
        handle: PANEL_HANDLE_WIDTH,
      });
  }
  override onResize(): void {
    super.onResize();
    for (const element of this.contentEl.querySelectorAll<HTMLElement>(
      ".cm-editor",
    )) {
      const editor = EditorView.findFromDOM(element);
      if (editor && editor.root !== element.ownerDocument)
        editor.setRoot(element.ownerDocument);
    }
  }
  subscribeReveals(
    listener: (
      target: Pick<WorkbenchProblem, "slice" | "range" | "params">,
    ) => void,
  ): () => void {
    this.#revealListeners.add(listener);
    return () => {
      this.#revealListeners.delete(listener);
    };
  }
  openProblems(reveal = true): void {
    for (const listener of this.#openProblemsListeners) listener();
    if (reveal)
      this.#runner.run(
        Workspace.use((workspace) => workspace.revealLeaf(this.leaf)),
      );
  }
  subscribeOpenProblems(listener: () => void): () => void {
    this.#openProblemsListeners.add(listener);
    return () => {
      this.#openProblemsListeners.delete(listener);
    };
  }
  explainArrival(arrival: ArrivingProblem): void {
    this.#arrival = arrival;
    this.openProblems(false);
  }
  takeArrival(): ArrivingProblem | null {
    const held = this.#arrival;
    this.#arrival = null;
    return held;
  }
  get arrival(): ArrivingProblem | null {
    return this.#arrival;
  }
  revealSlice(slice: "advanced" | "annotation" | `entry:${number}`): void {
    const range = this.#controller.sliceRange(slice);
    for (const listener of this.#revealListeners)
      listener({ slice, ...(range ? { range } : {}) });
    this.#runner.run(
      Workspace.use((workspace) => workspace.revealLeaf(this.leaf)),
    );
  }
  get controller(): WorkbenchDocumentController {
    return this.#controller;
  }
  get insertTarget(): WorkbenchInsertTarget | null {
    return insertionTarget(this.#view.presentation.selection, this.#controller);
  }

  fieldInsertion(): FieldInsertionContext {
    const target = this.insertTarget;
    const region =
      target &&
      this.#controller.templateRegions.find(
        (region) =>
          target.range.from >= region.from && target.range.to <= region.to,
      );
    return {
      engine: this.#documentLanguage,
      mode: region?.expression
        ? "expression"
        : region?.language === "json-e"
          ? "json-e"
          : "template",
    };
  }

  insertField(
    snippet: string,
    { keepOpen }: FieldInsertOptions = { keepOpen: false },
  ): boolean {
    if (this.#controller.readOnly || this.#closed) return false;
    const target = this.insertTarget;
    if (!target) {
      this.#log(
        Effect.logTrace("Rejected Explorer insertion").pipe(
          Effect.annotateLogs({
            slice: this.#view.presentation.selection?.slice ?? null,
            reason: this.#view.presentation.selection
              ? "removed-slice"
              : "no-selection",
          }),
        ),
      );
      return false;
    }
    const range = this.#controller.sliceRange(target.slice);
    const from = Math.min(Math.max(target.range.from, range.from), range.to);
    const to = Math.min(Math.max(target.range.to, from), range.to);
    this.#controller.dispatch({
      changes: { from, to, insert: snippet },
      userEvent: "input.complete",
    });
    this.#log(
      Effect.logDebug("Applied Explorer insertion").pipe(
        Effect.annotateLogs({ slice: target.slice }),
      ),
    );
    const cursor = from + snippet.length;
    this.#focusTarget(
      {
        slice: target.slice,
        range: { from: cursor, to: cursor, placed: true },
      },
      !keepOpen,
    );
    return true;
  }

  #focusTarget(target: WorkbenchInsertTarget, focus: boolean): void {
    this.registry.set(this.model.insertRequest, { ...target, focus });
    this.setPresentation({ selection: target });
    const state = this.change;
    state.setAdvanced(target.slice === "advanced");
    state.setTab(
      entryPosition(target.slice) !== null
        ? "properties"
        : target.slice === "filename"
          ? "name"
          : target.slice === "annotation"
            ? "annotation"
            : target.slice === "source"
              ? this.documentKind === "partial"
                ? "partial"
                : "citation"
              : "note",
    );
    state.setRoot(
      this.#controller.templateRegions.find(
        (region) =>
          target.range.from >= region.from && target.range.to <= region.to,
      )?.root ?? this.#defaultRoot,
    );
    this.#runner.runSync(
      Workspace.use((workspace) =>
        workspace.setActiveLeaf(this.leaf, { focus: false }),
      ),
    );
  }

  override getViewType(): string {
    return TEMPLATE_WORKBENCH_VIEW_TYPE;
  }
  override getDisplayText(): string {
    if (this.documentKind === "citation")
      return m.template_workbench_title_citation();
    const name = templatePartialName(
      this.file?.path ?? "",
      this.#templateFolder,
    );
    if (name !== null) return m.template_workbench_title_partial({ name });
    const label = this.profileLabel;
    return label === null
      ? m.template_workbench_name()
      : m.template_workbench_title_profile({ label });
  }
  get profileLabel(): string | null {
    return (
      this.#controller.document?.manifest.name ?? this.file?.basename ?? null
    );
  }
  override getIcon(): string {
    return "file-pen-line";
  }
  override getViewData(): string {
    return this.#controller.source;
  }
  override setViewData(input: string, clear: boolean): void {
    let source = input;
    if (this.#bindingDraft) {
      this.data = source;
      return;
    }
    const file = this.file;
    if (clear && file && !this.#clearing) {
      source =
        this.#pendingSource ??
        this.#runner
          .runSync(
            Workspace.use((workspace) => workspace.loadedTextView(file, this)),
          )
          ?.getViewData() ??
        source;
      this.#pendingSource = null;
    }
    if (clear) {
      this.#host[Symbol.dispose]();
      this.#unsubscribe?.();
      this.#loads++;
      this.#sourceRevision++;
      this.#controller = new WorkbenchDocumentController(source, {
        readOnly: this.#defaultDraft,
        kind: templateDocumentKind(this.file, this.#templateFolder),
        context: () => this.partialContext,
      });
      this.registry.set(this.model.document, {
        path: this.file?.path ?? null,
        partialName: templatePartialName(
          this.file?.path ?? "",
          this.#templateFolder,
        ),
      });
      this.#editor.attach(this.#controller);
      this.setPresentation({
        selection: null,
        selected: null,
        reveal: null,
        fieldFocus: null,
        scroll: {},
        restoring: false,
      });
      this.registry.set(this.model.insertRequest, null);
      this.#applyKindDefaults();
      this.#subscribe();
      this.#mount();
    } else this.#controller.applyExternalSource(source);
    this.data = this.#controller.source;
    if (clear && this.file && !this.#clearing) {
      if (this.data !== this.lastSavedData) this.dirty = true;
      this.#runner.runSync(
        Workspace.use((workspace) =>
          workspace.trigger("quick-preview", this.file, this.data),
        ),
      );
    }
  }
  override loadFileInternal(file: TFile, clear: boolean): Promise<void> {
    return answerOf(this.#reads.run(this.#loadFile(file, clear)), undefined);
  }
  #loadFile(
    file: TFile,
    clear: boolean,
  ): Effect.Effect<void, Cause.UnknownError> {
    const loadBase = (receiver: this, reset: boolean) =>
      super.loadFileInternal.call(receiver, file, reset);
    return Effect.suspend(() => {
      const initial = {};
      let reset = clear;
      if (clear) this.#initialRead = initial;
      let stopped = false;
      const read = (): Effect.Effect<void, Cause.UnknownError> =>
        Effect.suspend(() => {
          if (file !== this.file) return Effect.void;
          const revision = this.#sourceRevision;
          const baseline = this.lastSavedData;
          const receiver = new Proxy(this, {
            get(target, property) {
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
            set: (target, property, value) => {
              if (
                property === "lastSavedData" &&
                (stopped ||
                  file !== this.file ||
                  revision !== this.#sourceRevision ||
                  baseline !== this.lastSavedData)
              )
                throw new StaleSourceRead();
              return Reflect.set(target, property, value, target);
            },
          });
          return Effect.tryPromise({
            try: () => loadBase(receiver, reset),
            catch: (cause) =>
              cause instanceof StaleSourceRead
                ? cause
                : new Cause.UnknownError(cause),
          }).pipe(
            Effect.catchTag("StaleSourceRead", () =>
              Effect.gen({ self: this }, function* () {
                yield* Effect.logTrace(
                  "Discarded stale Profile source read",
                ).pipe(
                  Effect.annotateLogs({
                    path: file.path,
                    fileChanged: file !== this.file,
                    sourceChanged: revision !== this.#sourceRevision,
                    baselineChanged: baseline !== this.lastSavedData,
                  }),
                );
                if (revision !== this.#sourceRevision) reset = false;
                yield* read();
              }),
            ),
          );
        });
      return read().pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            stopped = true;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#initialRead === initial) {
              this.#initialRead = null;
              this.#pendingSource = null;
            }
          }),
        ),
        withLogCategory("template-workbench"),
      );
    });
  }
  override clear(): void {
    if (this.#defaultDraft || this.#bindingDraft) return;
    this.#reads.interrupt();
    this.#clearing = true;
    try {
      this.setViewData("", true);
    } finally {
      this.#clearing = false;
    }
  }

  override getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      ...savedWorkbench({
        defaultDraft: this.#defaultDraft,
        view: this.#view,
        choices: this.registry.get(this.workbench.choices),
        panels: this.registry.get(this.workbench.panels),
        partial:
          this.documentKind === "partial"
            ? { context: this.partialContext, profile: this.partialProfile }
            : null,
      }),
    };
  }
  setPresentation(value: Partial<WorkbenchViewState["presentation"]>): void {
    this.#update(setPresentation(value));
  }
  #presentationContext(): string {
    return JSON.stringify([
      this.file?.path ?? (this.#defaultDraft ? "default" : null),
      this.#view.item?.id ?? null,
    ]);
  }
  override getEphemeralState(): Record<string, unknown> {
    const { presentation } = this.#view;
    return {
      zotlitTemplateWorkbench: {
        context: this.#presentationContext(),
        selection: presentation.selection,
        selected: presentation.selected,
        field: presentation.fieldFocus?.field ?? null,
        scroll: presentation.scroll,
      },
    };
  }
  override setEphemeralState(input: unknown): void {
    const state = readEphemeralWorkbench(input);
    if (!state || state.context !== this.#presentationContext()) return;
    const selection = state.selection as WorkbenchInsertTarget | null;
    let restoredSelection: WorkbenchInsertTarget | null = null;
    if (selection && this.controller.hasSlice(selection.slice)) {
      const slice = this.controller.sliceRange(selection.slice);
      const clamp = (position: number) =>
        Math.max(slice.from, Math.min(slice.to, position));
      const anchor = clamp(selection.range.anchor ?? selection.range.from);
      const head = clamp(selection.range.head ?? selection.range.to);
      restoredSelection = {
        slice: selection.slice,
        range: {
          from: Math.min(anchor, head),
          to: Math.max(anchor, head),
          ...(anchor > head ? { anchor, head } : {}),
        },
      };
    }
    const selected =
      state.selected !== null &&
      state.selected < (this.controller.managedEntries?.length ?? 0)
        ? state.selected
        : null;
    this.setPresentation({
      selection: restoredSelection,
      selected,
      reveal: restoredSelection
        ? {
            ...restoredSelection.range,
            slice: restoredSelection.slice,
            focus: state.focus,
            scrollIntoView: false,
          }
        : null,
      fieldFocus:
        state.field === null
          ? null
          : { field: state.field, focus: state.focus, scrollIntoView: false },
      scroll: state.scroll,
      restoreVersion: this.#view.presentation.restoreVersion + 1,
      restoring: true,
    });
  }
  restoreScroll(): void {
    const { scroll, restoring } = this.#view.presentation;
    if (
      !restoring ||
      this.registry.get(this.model.read).status === "loading" ||
      !this.contentEl.querySelector("[data-workbench-scroll]")
    )
      return;
    for (const element of this.contentEl.querySelectorAll<HTMLElement>(
      "[data-workbench-scroll]",
    )) {
      const position = scroll[element.dataset.workbenchScroll!];
      if (position) {
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
    }
    this.setPresentation({ restoring: false });
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
  #restoreState(state: unknown, result: ViewStateResult) {
    const restoreBase = (state: unknown) =>
      Effect.tryPromise(() => super.setState(state, result));
    return Effect.gen({ self: this }, function* () {
      const value = readSavedWorkbench(state);
      if (value) {
        const { itemIndexedKey, annotationId } = value;
        if (itemIndexedKey !== undefined)
          this.#update(
            chooseItem(
              itemIndexedKey === null
                ? null
                : this.#view.item?.id === itemIndexedKey
                  ? this.#view.item
                  : { id: itemIndexedKey, title: null },
            ),
          );
        if (annotationId !== undefined)
          this.registry.update(
            this.workbench.choices,
            chooseAnnotation(annotationId),
          );
      }
      const builtin =
        !!state &&
        typeof state === "object" &&
        "defaultDraft" in state &&
        state.defaultDraft === true;
      if (builtin) {
        this.allowNoFile = true;
        yield* restoreBase({ ...state, file: null });
        this.#defaultDraft = true;
        this.setViewData(yield* builtInSource, true);
      } else {
        if (
          !this.#bindingDraft &&
          state &&
          typeof state === "object" &&
          "file" in state &&
          typeof state.file === "string"
        ) {
          this.#defaultDraft = false;
          this.allowNoFile = false;
        }
        yield* restoreBase(state);
      }
      if (!value) return;
      const { fields } = value.panels;
      if (fields)
        this.registry.update(
          this.workbench.panels,
          patchAt<WorkbenchPanels, "fields">("fields", fields),
        );
      const panel = value.panels.preview;
      if (panel)
        this.registry.update(this.workbench.panels, (panels) =>
          setPanelWidth(
            "preview",
            panel.width,
          )(showPreview(panel.shown)(panels)),
        );
      const height = value.panels.preview?.height;
      if (height !== undefined)
        this.registry.update(this.workbench.panels, setPreviewHeight(height));
      this.registry.update(this.workbench.choices, setPreview(value.preview));
      this.registry.update(
        this.workbench.choices,
        chooseCitation(value.citation),
      );
      const { change } = this;
      if (this.#applyKindDefaults()) {
        if (this.documentKind === "partial" && value.partialContext !== null) {
          this.registry.update(
            this.workbench.choices,
            choosePartialProfile(value.partialProfile),
          );
          change.setRoot(value.partialContext);
        }
      } else {
        if (value.tab !== null)
          change.setTab(
            value.tab === "match" && this.isDefaultProfile ? "note" : value.tab,
          );
        if (value.root !== null && value.root !== "citation")
          change.setRoot(value.root);
        else if (value.tab !== null)
          change.setRoot(
            this.#view.tab === "annotation"
              ? "annotation"
              : this.#view.tab === "name"
                ? "filename"
                : "note",
          );
        if (value.advanced !== null) change.setAdvanced(value.advanced);
      }
    });
  }

  #applyKindDefaults(): boolean {
    const { change } = this;
    const kind = this.documentKind;
    if (kind === "profile") {
      if (!TABS.includes(this.#view.tab)) {
        change.setTab("note");
        change.setRoot("note");
      }
      return false;
    }
    change.setTab(kind);
    change.setAdvanced(false);
    if (kind === "citation") {
      change.setRoot("citation");
      return true;
    }
    const path = this.file?.path ?? null;
    if (path !== this.#partialChoiceFile) {
      this.#partialChoiceFile = path;
      const held = readPartialChoice(this.app, path);
      this.registry.update(
        this.workbench.choices,
        choosePartialProfile(held.profile),
      );
      change.setRoot(held.context);
    } else if (!isPartialContext(this.#view.root))
      change.setRoot(DEFAULT_PARTIAL_CONTEXT);
    return true;
  }

  protected override onOpen(): Promise<void> {
    this.#closed = false;
    this.#release ??= holdTemplateWorkbenchModel(this.registry, this.model);
    this.#observeSize(this.contentEl.win);
    const migrated = this.contentEl.onWindowMigrated((win) =>
      this.#observeSize(win),
    );
    this.#cleanup.defer(migrated);
    this.registerDomEvent(
      this.contentEl,
      "scroll",
      (event) => {
        const element = event.target as HTMLElement;
        const key = element.dataset?.workbenchScroll;
        if (!key || this.#view.presentation.restoring) return;
        this.setPresentation({
          scroll: {
            ...this.#view.presentation.scroll,
            [key]: { top: element.scrollTop, left: element.scrollLeft },
          },
        });
      },
      true,
    );
    const help: HTMLElement = this.addAction(
      "circle-help",
      m.workbench_help(),
      () => this.#showHelpMenu(help),
    );
    const preview = this.addAction("eye", m.workbench_show_preview(), () =>
      this.togglePreview(),
    );
    const fields = this.addAction("braces", m.workbench_view_fields(), () =>
      pressFieldsAction(this.registry, this.workbench),
    );
    this.#fieldsButton.current = fields;
    const source = this.addAction("code", m.workbench_advanced(), () =>
      this.#toggleSource(),
    );
    const redo = this.addAction("redo-2", m.workbench_redo(), () => {
      this.#controller.redo();
    });
    const undo = this.addAction("undo-2", m.workbench_undo(), () => {
      this.#controller.undo();
    });
    this.#updateActions = () => {
      for (const [action, enabled] of [
        [undo, this.#controller.canUndo],
        [redo, this.#controller.canRedo],
      ] as const) {
        action.setAttribute("aria-disabled", String(!enabled));
        action.classList.toggle("is-disabled", !enabled);
      }
      source.toggle(this.documentKind === "profile");
      const { advanced } = this.#view;
      source.setAttribute("aria-pressed", String(advanced));
      source.classList.toggle("is-active", advanced);
      const shown = this.registry.get(this.workbench.panels).preview.shown;
      preview.setAttribute("aria-pressed", String(shown));
      preview.classList.toggle("is-active", shown);
      const action = this.registry.get(this.workbench.fieldsAction);
      for (const [name, value] of Object.entries(
        fieldsActionAttributes(action, this.#fieldsAction.popoverId),
      ))
        if (value === undefined) fields.removeAttribute(name);
        else fields.setAttribute(name, value);
      fields.classList.toggle("is-active", action !== "closed");
    };
    const syncChrome = () => {
      this.#updateActions();
      const title = this.getDisplayText();
      if (this.titleEl.textContent !== title) {
        this.titleEl.textContent = title;
        this.leaf.updateHeader();
      }
    };
    this.#cleanup.defer(this.registry.subscribe(this.model.view, syncChrome));
    this.#cleanup.defer(
      this.registry.subscribe(this.workbench.document.revision, syncChrome),
    );
    this.#cleanup.defer(
      this.registry.subscribe(templateFolderAtom, syncChrome),
    );
    this.#cleanup.defer(
      this.registry.subscribe(defaultProfilePathAtom, syncChrome),
    );
    syncChrome();
    this.#updateActions();
    this.#root = createRoot(this.contentEl);
    this.#mount();
    this.startStylesRefresh();
    return Promise.resolve();
  }
  protected override async onClose(): Promise<void> {
    this.#closed = true;
    try {
      await super.onClose();
    } finally {
      this.#root?.unmount();
      this.#root = null;
      this.#sizeObserver?.disconnect();
      this.#sizeObserver = null;
      this.#cleanup.dispose();
      const stopped = this.#runner[Symbol.asyncDispose]();
      this.#editor[Symbol.dispose]();
      this.#host[Symbol.dispose]();
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      this.#release?.();
      this.#release = null;
      await stopped;
    }
  }

  templateDataTarget(): TemplateDataExportTarget | null {
    const { item, root } = this.#view;
    const { current, example } = this.registry.get(this.workbench.examples);
    const indexedKey = example?.root.indexedKey;
    return exportTarget(
      item,
      root,
      typeof indexedKey === "string" &&
        current.some((entry) => entry.id === example?.id)
        ? indexedKey
        : null,
    );
  }

  exportTemplateData(target: TemplateDataExportTarget): void {
    const pluginVersion = this.#deps.pluginVersion;
    if (pluginVersion)
      this.registry.set(this.#exportCommand, { ...target, pluginVersion });
  }

  templateDataExportLabel(): string {
    return this.#view.root === "annotation" &&
      this.templateDataTarget()?.root === "note"
      ? m.template_data_explorer_export_selected_paper()
      : m.template_data_explorer_menu_export_json();
  }

  togglePreview(): void {
    this.registry.update(this.workbench.panels, (panels) =>
      showPreview(!panels.preview.shown)(panels),
    );
  }

  #toggleSource(): void {
    this.change.setAdvanced(!this.#view.advanced);
  }

  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_show_fields())
        .setIcon("braces")
        .setChecked(this.registry.get(this.workbench.fieldsAction) !== "closed")
        .onClick(() => pressFieldsAction(this.registry, this.workbench)),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_show_preview())
        .setIcon("eye")
        .setChecked(this.registry.get(this.workbench.panels).preview.shown)
        .onClick(() => this.togglePreview()),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_choose_item())
        .setIcon("search")
        .onClick(() => this.startItemChoice()),
    );
    if (this.documentKind !== "citation")
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.pane)
          .setTitle(m.workbench_choose_annotation())
          .setIcon("highlighter")
          .onClick(() => this.startAnnotationChoice()),
      );
    this.#addPreviewMenu(menu);
    this.#addPanelSizeMenus(menu);
    if (this.documentKind === "profile")
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.pane)
          .setTitle(m.workbench_advanced())
          .setIcon("code")
          .setChecked(this.#view.advanced)
          .onClick(() => this.#toggleSource()),
      );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_undo())
        .setIcon("undo-2")
        .setDisabled(!this.#controller.canUndo)
        .onClick(() => this.#controller.undo()),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_redo())
        .setIcon("redo-2")
        .setDisabled(!this.#controller.canRedo)
        .onClick(() => this.#controller.redo()),
    );
    this.#addPartialsMenu(menu);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.command_customize_citation_text_name())
        .setIcon("quote")
        .onClick(() =>
          this.#start(Effect.ignore(reportCitationTemplateOpen(this.leaf))),
        ),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.template_workbench_open_markdown())
        .setIcon("file-text")
        .setDisabled(!this.file)
        .onClick(() => this.#act("open-markdown", this.#openMarkdown())),
    );
    this.#addTemplateEntries(menu);
    menu.addItem((item) => {
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_help())
        .setIcon("circle-help");
      this.#addHelpEntries(item.setSubmenu());
    });
    if (this.file?.path === this.registry.get(defaultProfilePathAtom))
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.danger)
          .setTitle(m.settings_profile_document_restore())
          .setWarning(true)
          .setIcon("rotate-ccw")
          .onClick(() => this.#start(Effect.ignore(this.#restoreDefault()))),
      );
  }
  #addTemplateEntries(menu: Menu): void {
    if (this.documentKind !== "profile") this.#addLanguageMenu(menu);
    const target = this.templateDataTarget();
    if (this.registry.get(this.workbench.fieldsAction) !== "closed")
      this.fieldsActions.addExportMenuItem(menu);
    else if (target && this.#deps.pluginVersion)
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.action)
          .setTitle(this.templateDataExportLabel())
          .setIcon("file-json")
          .onClick(() => this.exportTemplateData(target)),
      );
  }
  #addPreviewMenu(menu: Menu): void {
    if (!this.registry.get(this.workbench.panels).preview.shown) return;
    menu.addItem((item) => {
      item
        .setSection(MENU_SECTION.pane)
        .setTitle(m.workbench_view_preview())
        .setIcon("sliders-horizontal");
      this.#addPreviewSettings(item.setSubmenu());
    });
  }
  #addPanelSizeMenus(menu: Menu): void {
    const { registry, workbench } = this;
    const menus = panelSizeMenus(registry.get(workbench.panels), {
      size: registry.get(this.viewSize),
      defaults: workbench.panelDefaults,
    });
    for (const { axis, label, items } of menus) {
      const icons = PANEL_SIZE_ICONS[axis];
      menu.addItem((entry) => {
        entry.setSection(MENU_SECTION.pane).setTitle(label).setIcon(icons.menu);
        const submenu = entry.setSubmenu();
        for (const size of items)
          submenu.addItem((item) =>
            item
              .setTitle(size.label)
              .setIcon(icons[size.resize])
              .setDisabled(size.disabled)
              .onClick(() => pickPanelSize(registry, workbench, size)),
          );
      });
    }
  }
  showPreviewMenu(trigger: HTMLElement): void {
    const menu = new Menu();
    this.#addPreviewSettings(menu);
    showMenuAtButton(menu, trigger, "end");
  }
  showFieldsMenu(trigger: HTMLElement): void {
    const menu = new Menu().addSections([
      MENU_SECTION.action,
      MENU_SECTION.info,
    ]);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.workbench_choose_item())
        .setIcon("search")
        .onClick(() => this.startItemChoice()),
    );
    this.fieldsActions.addExportMenuItem(menu);
    this.fieldsActions.addCopyKeyMenuItem(menu);
    showMenuAtButton(menu, trigger, "end");
  }
  #addPreviewSettings(menu: Menu): void {
    const { registry } = this;
    const { mode, citationSet } = previewTarget(
      this.documentKind,
      this.#view.root,
    );
    const { choices } = this.workbench;
    const { preview, variant, citationExample } = registry.get(choices);
    const setSettings = (value: Partial<typeof preview>) =>
      registry.update(choices, setPreview(value));
    const setCitation = (value: Parameters<typeof chooseCitation>[0]) =>
      registry.update(choices, chooseCitation(value));
    if (mode === "partial") this.#addCallerMenu(menu);
    if (citationSet) {
      for (const [value, title] of [
        ["main", m.template_workbench_preview_main_citation()],
        ["alt", m.template_workbench_preview_alt_citation()],
      ] as const)
        menu.addItem((item) =>
          item
            .setTitle(title)
            .setIcon("quote")
            .setChecked(variant === value)
            .onClick(() => setCitation({ variant: value })),
        );
      menu.addItem((item) => {
        item.setTitle(m.template_workbench_use_example()).setIcon("list");
        const submenu = item.setSubmenu().setNoIcon();
        for (const id of CITATION_EXAMPLE_IDS)
          submenu.addItem((entry) =>
            entry
              .setTitle(citationExampleLabel(id))
              .setChecked(citationExample === id)
              .onClick(() => setCitation({ citationExample: id })),
          );
      });
    }
    if (mode === "note") {
      const result = registry.get(this.workbench.scheduler.state).result;
      for (const [value, title, icon] of [
        ["create", m.workbench_preview_as_new_note(), "file-plus"],
        ["update", m.workbench_preview_as_updated_note(), "file-pen"],
      ] as const)
        menu.addItem((item) =>
          item
            .setTitle(title)
            .setIcon(icon)
            .setChecked(preview.mode === value && !preview.showManaged)
            .setDisabled(
              value === "update" && result !== null && !result.sourcePath,
            )
            .onClick(() => setSettings({ mode: value, showManaged: false })),
        );
      menu.addItem((item) =>
        item
          .setTitle(m.workbench_preview_updated_section())
          .setIcon("rows-3")
          .setChecked(preview.showManaged)
          .onClick(() => setSettings({ showManaged: true })),
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(m.workbench_preview_auto_refresh())
        .setIcon("zap")
        .setChecked(preview.live)
        .onClick(() => setSettings({ live: !preview.live })),
    );
    menu.addItem((item) =>
      item
        .setTitle(m.workbench_show_markdown())
        .setIcon("code")
        .setChecked(preview.showMarkdown)
        .onClick(() => setSettings({ showMarkdown: !preview.showMarkdown })),
    );
    if (!preview.live)
      menu.addItem((item) =>
        item
          .setTitle(m.workbench_preview_run())
          .setIcon("play")
          .onClick(() => registry.set(this.workbench.scheduler.run, undefined)),
      );
    menu.addItem((item) =>
      item
        .setTitle(m.workbench_refresh_item())
        .setIcon("refresh-cw")
        .onClick(() => this.refresh()),
    );
  }
  #addCallerMenu(menu: Menu): void {
    const current = this.partialContext;
    const profile = this.partialProfile;
    for (const [context, title, icon] of [
      ["note", m.template_workbench_preview_as_note(), "file-text"],
      [
        "annotation",
        m.template_workbench_preview_as_annotation(),
        "highlighter",
      ],
      ["citation", m.template_workbench_preview_as_citation(), "quote"],
    ] as const)
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .setChecked(current === context)
          .onClick(() => this.setPartialSelection({ context, profile })),
      );
    const profiles = this.registry.get(profilesAtom);
    if (profiles.length === 0) return;
    menu.addItem((item) => {
      item.setTitle(m.template_workbench_use_profile()).setIcon("book-user");
      const submenu = item.setSubmenu().setNoIcon();
      for (const [id, label] of [
        [null, m.settings_profile_default_name()],
        ...profiles.map(({ id, label }) => [id, label] as const),
      ] as const)
        submenu.addItem((entry) =>
          entry
            .setTitle(label)
            .setChecked(profile === id)
            .onClick(() =>
              this.setPartialSelection({ context: current, profile: id }),
            ),
        );
    });
  }
  #addHelpEntries(menu: Menu): void {
    for (const { label, path } of HELP_PAGES)
      menu.addItem((entry) =>
        entry
          .setTitle(label())
          .setIcon("book-open")
          .onClick(() => window.open(docsUrl(path))),
      );
    menu.addSeparator();
    menu.addItem((entry) =>
      entry
        .setTitle(m.workbench_problems_community())
        .setIcon("messages-square")
        .onClick(() => window.open(communityUrl())),
    );
  }
  #showHelpMenu(trigger: HTMLElement): void {
    const menu = new Menu();
    this.#addHelpEntries(menu);
    showMenuAtButton(menu, trigger, "end");
  }
  #addPartialsMenu(menu: Menu): void {
    const partials = this.registry.get(partialDocumentsAtom);
    if (!AsyncResult.isSuccess(partials)) return;
    const bundled = this.#controller.document?.manifest.partials ?? [];
    menu.addItem((item) => {
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.template_workbench_partials())
        .setIcon("puzzle");
      const submenu = item.setSubmenu();
      for (const partial of partials.value)
        submenu.addItem((entry) =>
          entry
            .setTitle(partial.name)
            .setChecked(this.file?.path === partial.path)
            .onClick(() => this.#openPartial(partial.path)),
        );
      submenu.addSeparator();
      submenu.addItem((entry) =>
        entry
          .setTitle(m.workbench_partial_new())
          .setIcon("plus")
          .onClick(() =>
            this.#start(Effect.ignore(this.#createPartial({ name: "" }))),
          ),
      );
      if (bundled.length > 0 && !this.#controller.readOnly)
        submenu.addItem((entry) =>
          entry
            .setTitle(m.workbench_problem_bundled_partial_unpack())
            .setIcon("package-open")
            .onClick(() =>
              this.#start(Effect.ignore(this.#unpackBundledPartials())),
            ),
        );
    });
  }

  #openPartial(path: string): void {
    const { leaf } = this;
    this.#act(
      "open-partial",
      Effect.gen(function* () {
        const file = yield* (yield* Vault).getFileByPath(path);
        if (file)
          yield* openTemplateWorkbench(file, {
            from: { leaf, place: "tab" },
          });
      }),
    );
  }

  #createPartial(
    options: CreateSharedPartialOptions,
  ): Effect.Effect<string | null, never, ViewServices> {
    return createSharedPartialEffect(this.app, { ...options, from: this.leaf });
  }

  extractPartial(source: string): Effect.Effect<string | null> {
    return joinOnView(this.#runner.run, this.#extractPartial(source));
  }
  #extractPartial(source: string) {
    const language = this.#documentLanguage;
    return this.#createPartial({ source, language, open: "split" }).pipe(
      Effect.map((name) =>
        name === null ? null : partialCall(name, language),
      ),
    );
  }

  get #documentLanguage(): TemplateLanguage {
    return (
      this.#controller.document?.manifest.language ??
      this.#controller.plainDocument?.manifest.language ??
      "liquid"
    );
  }

  #addLanguageMenu(menu: Menu): void {
    const current = this.#controller.plainDocument?.manifest.language;
    if (current === undefined) return;
    menu.addItem((item) => {
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.template_workbench_change_language())
        .setIcon("code-2");
      const submenu = item.setSubmenu().setNoIcon();
      for (const [language, title] of [
        ["liquid", m.workbench_name_language_liquid()],
        ["eta", m.workbench_name_language_eta()],
      ] as const)
        submenu.addItem((entry) =>
          entry
            .setTitle(title)
            .setChecked(current === language)
            .setDisabled(this.#controller.readOnly)
            .onClick(() => this.#controller.setPlainLanguage(language)),
        );
    });
  }
  get isDefaultProfile(): boolean {
    return (
      this.#defaultDraft ||
      Boolean(
        this.file &&
        this.file.path === this.registry.get(defaultProfilePathAtom),
      )
    );
  }
  get isDefaultDraft(): boolean {
    return this.#defaultDraft;
  }
  get partialNames(): readonly string[] {
    if (this.#closed) return [];
    return this.registry.get(partialNamesAtom);
  }
  openPartial(name: string): void {
    const partials = this.registry.get(partialDocumentsAtom);
    if (!AsyncResult.isSuccess(partials)) {
      this.#log(
        Effect.logDebug("Edit partial before the folder scan settled").pipe(
          Effect.annotateLogs({ name }),
        ),
      );
      return;
    }
    const document = partials.value.find((partial) => partial.name === name);
    if (!document) {
      this.#log(
        Effect.logDebug(
          "Edit partial for a name the vault holds no document for",
        ).pipe(Effect.annotateLogs({ name })),
      );
      return;
    }
    this.#openPartial(document.path);
  }
  unpackBundledPartials() {
    return joinOnView(this.#runner.run, this.#unpackBundledPartials());
  }
  #unpackBundledPartials() {
    return templateWorkbenchAction(
      "unpack-partials",
      Effect.gen({ self: this }, function* () {
        const bundled = this.#controller.document?.manifest.partials ?? [];
        if (this.#controller.readOnly || !bundled.length) return;
        const template = yield* Template;
        const result = yield* template.unpackPartials(
          yield* template.planPartialUnpack(bundled),
        );
        this.#controller.dropBundledPartials(result.dropped);
        const notifier = yield* Notifier;
        for (const message of unpackedPartialNotices(result))
          yield* notifier.show(message);
      }),
    );
  }
  restoreDefault() {
    return joinOnView(this.#runner.run, this.#restoreDefault());
  }
  #restoreDefault() {
    return templateWorkbenchAction(
      "restore-default",
      Effect.gen({ self: this }, function* () {
        const path = this.registry.get(defaultProfilePathAtom);
        const confirmed = yield* awaitConfirm(
          {
            title: m.settings_profile_document_restore_title(),
            content: m.settings_profile_document_restore_desc({ path }),
            action: m.settings_profile_document_restore_action(),
            destructive: true,
          },
          this.app,
        );
        if (!confirmed) return;
        yield* this.#saveFile();
        this.allowNoFile = true;
        this.#defaultDraft = true;
        yield* setLeafState(this.leaf, {
          type: TEMPLATE_WORKBENCH_VIEW_TYPE,
          state: { file: null, defaultDraft: true },
          active: true,
        });
        const profile = yield* Profile;
        yield* profile.restoreDefault;
        this.setViewData(yield* profile.getSource("default"), true);
      }),
    );
  }

  customizeDefault(): Effect.Effect<void> {
    return this.#customizing.join;
  }
  #customize(): Effect.Effect<void, never, ViewServices> {
    const path = this.registry.get(defaultProfilePathAtom);
    if (!this.#defaultDraft) return Effect.void;
    const controller = this.#controller;
    this.registry.set(this.model.customization, "pending");
    return Effect.gen({ self: this }, function* () {
      yield* Effect.logDebug("Opening Default Profile for customization");
      const { file } = yield* materializeDefault;
      if (!this.#defaultDraft || this.#controller !== controller) return;
      this.#bindingDraft = true;
      yield* Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          yield* setLeafState(this.leaf, {
            type: TEMPLATE_WORKBENCH_VIEW_TYPE,
            state: { ...this.getState(), defaultDraft: false, file: file.path },
            active: true,
          });
          const peer = yield* Workspace.use((workspace) =>
            workspace.loadedTextView(file, this),
          );
          const source = peer?.getViewData() ?? this.data;
          this.#bindingDraft = false;
          this.#defaultDraft = false;
          controller.setReadOnly(false);
          if (source !== controller.source) this.setViewData(source, true);
          this.allowNoFile = false;
          this.data = this.#controller.source;
        }),
        Effect.sync(() => {
          this.#bindingDraft = false;
        }),
      );
      this.#mount();
      yield* openWorkbenchLayout(this);
    }).pipe(
      recover(
        (cause) =>
          Effect.logError("Failed to customize Default Profile").pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
            Effect.andThen(
              Effect.sync(() =>
                this.registry.set(this.model.customization, "failed"),
              ),
            ),
          ),
        Effect.void,
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          if (this.registry.get(this.model.customization) === "pending")
            this.registry.set(this.model.customization, "idle");
        }),
      ),
      Effect.annotateLogs({ path }),
      withLogCategory("template-workbench"),
    );
  }
  #refreshStyles(): Effect.Effect<void, never, ViewServices> {
    return Effect.gen({ self: this }, function* () {
      const list = yield* installedStyles;
      this.registry.set(this.model.styles, { list, unavailable: false });
    }).pipe(
      recover(
        (cause) =>
          Effect.logWarning(
            "Failed to read Template Workbench citation styles",
          ).pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
            Effect.andThen(
              Effect.sync(() =>
                this.registry.update(this.model.styles, (styles) => ({
                  ...styles,
                  unavailable: true,
                })),
              ),
            ),
          ),
        Effect.void,
      ),
      withLogCategory("template-workbench"),
    );
  }
  refreshStyles(): Effect.Effect<void> {
    return this.#styles.join;
  }
  #openMarkdown(): Effect.Effect<void, Cause.UnknownError> {
    return Effect.gen({ self: this }, function* () {
      const file = this.file;
      if (!file) return;
      yield* this.#saveFile();
      yield* setLeafState(this.leaf, {
        type: "markdown",
        state: { file: file.path },
        active: true,
      });
    });
  }
  chooseItem(): Effect.Effect<boolean> {
    return this.#join<WorkbenchItemChoice>(this.model.chooseItem, () =>
      workbenchItemChoice(
        this.#chooserScope(),
        {
          app: this.app,
          lookup: this.#deps.itemLookup,
          settings: this.#deps.settings,
          bridge: this.#deps.bridge,
        },
        this.#view.item ?? undefined,
      ).pipe(
        Effect.tap((choice) =>
          Effect.sync(() => {
            if (choice) this.setItem(choice);
          }),
        ),
      ),
    ).pipe(Effect.map((choice) => choice !== null));
  }
  #join<A>(
    command: Atom.AtomResultFn<
      Effect.Effect<A | null, never, ViewServices>,
      A | null,
      unknown
    >,
    open: () => Effect.Effect<A | null, never, ViewServices>,
  ): Effect.Effect<A | null> {
    return joinOnView(
      this.#runner.run,
      Effect.suspend(() => {
        const { registry } = this;
        if (this.#closed) return Effect.interrupt;
        if (!registry.get(command).waiting) registry.set(command, open());
        return AtomRegistry.getResult(registry, command, {
          suspendOnWaiting: true,
        }).pipe(
          recover(
            (cause) =>
              Effect.logWarning("Template Workbench chooser failed").pipe(
                Effect.annotateLogs({ error: Cause.squash(cause) }),
                withLogCategory("template-workbench"),
              ),
            Effect.succeed(null),
          ),
        );
      }),
    );
  }
  setItem(item: WorkbenchItemChoice): void {
    if (this.#closed) return;
    this.registry.set(this.workbench.pick, item);
    this.#remember(item);
  }
  #remember(item: WorkbenchItemChoice): void {
    if (!getSampleItem(item.id)) rememberTemplateItem(this.app, item.id);
  }
  selectItem(item: WorkbenchItemChoice): Effect.Effect<boolean> {
    return joinOnView(
      this.#runner.run,
      Effect.suspend(() => {
        this.setItem(item);
        const { registry, model } = this;
        const read = AtomRegistry.getResult(registry, model.chosen, {
          suspendOnWaiting: true,
        }).pipe(
          Effect.as(true),
          recover(
            (cause) =>
              Effect.logWarning(
                "Failed to restore Template Workbench Item",
              ).pipe(
                Effect.annotateLogs({
                  indexedKey: item.id,
                  error: Cause.squash(cause),
                }),
                withLogCategory("template-workbench"),
              ),
            Effect.succeed(false),
          ),
        );
        const outrun = AtomRegistry.toStream(registry, model.item).pipe(
          Stream.filter((choice) => choice?.id !== item.id),
          Stream.runHead,
          Effect.as(false),
        );
        return Effect.raceFirst(read, outrun);
      }),
    );
  }
  refresh(): void {
    if (!this.#closed) this.registry.update(this.model.refresh, (n) => n + 1);
  }
  chooseAnnotation(): Effect.Effect<void> {
    return this.#join<string>(this.model.chooseAnnotation, () => {
      const { current, example } = this.registry.get(this.workbench.examples);
      return workbenchAnnotationChoice(
        this.#chooserScope(),
        current,
        example?.id ?? null,
      ).pipe(
        Effect.tap((id) =>
          Effect.sync(() => {
            if (id !== null && !this.#closed)
              this.registry.update(
                this.workbench.choices,
                chooseAnnotation(id),
              );
          }),
        ),
      );
    }).pipe(Effect.asVoid);
  }
  #subscribe(): void {
    this.#unsubscribe = this.#controller.subscribe(
      ({ docChanged, transaction }) => {
        if (!docChanged) return;
        this.#log(
          Effect.logTrace("Preview source changed").pipe(
            Effect.annotateLogs({
              live: this.registry.get(this.workbench.preview).live,
            }),
          ),
        );
        const selection = this.#view.presentation.selection;
        if (selection) {
          const { slice, range } = selection;
          this.setPresentation({
            selection: {
              slice,
              range: {
                from: transaction.changes.mapPos(range.from, 1),
                to: transaction.changes.mapPos(range.to, 1),
                ...(range.anchor === undefined
                  ? {}
                  : {
                      anchor: transaction.changes.mapPos(range.anchor, 1),
                      head: transaction.changes.mapPos(
                        range.head ?? range.to,
                        1,
                      ),
                    }),
                ...(range.placed ? { placed: range.placed } : {}),
              },
            },
          });
        }
        this.#sourceRevision++;
        this.data = this.#controller.source;
        if (this.file && !this.#receivingSource)
          this.#runner.runSync(
            Workspace.use((workspace) =>
              workspace.trigger("quick-preview", this.file, this.data),
            ),
          );
        if (transaction.annotation(externalEdit) !== true) {
          if (!this.#defaultDraft) this.requestSave();
        }
      },
    );
  }
  #history(event: KeyboardEvent, redo: boolean): boolean | void {
    const target = event.target as Node | null;
    if (
      target?.instanceOf(HTMLElement) &&
      target.closest("input, textarea, [contenteditable], .cm-editor")
    )
      return;
    if (redo ? this.#controller.redo() : this.#controller.undo()) return false;
  }
  #chooserScope(): ChooserScope {
    return {
      app: this.app,
      window: this.contentEl.win,
      run: this.#runner.run,
    };
  }
  provide(content: ReactNode): ReactNode {
    return (
      <ViewRegistryProvider registry={this.registry}>
        <AppContext value={this.app}>
          <WorkbenchHostProvider host={this.#host}>
            <WorkbenchEditorProvider key={this.#loads} editor={this.#editor}>
              {content}
            </WorkbenchEditorProvider>
          </WorkbenchHostProvider>
        </AppContext>
      </ViewRegistryProvider>
    );
  }
  #mount(): void {
    if (this.#closed) return;
    this.#updateActions();
    this.#root?.render(
      this.provide(
        <EditorContent
          view={this}
          onSelection={(target) => {
            this.setPresentation({ selection: target });
            const root =
              this.#controller.templateRegions.find(
                (region) =>
                  target.range.from >= region.from &&
                  target.range.from <= region.to,
              )?.root ?? this.#defaultRoot;
            this.#update(setRoot(root));
          }}
        />,
      ),
    );
  }
}

function EditorContent({
  view,
  onSelection,
}: {
  view: TemplateWorkbenchView;
  onSelection: (target: WorkbenchInsertTarget) => void;
}) {
  const controller = view.controller;
  const insertRequest = useAtomValue(view.model.insertRequest);
  const origin = useAtomValue(view.model.origin);
  const originatingNote = origin?.file ?? null;
  const updatingNote = useAtomValue(view.model.updating);
  const isDefaultDraft = useAtomValue(view.model.defaultDraft);
  const unavailable = useAtomValue(view.model.unavailable);
  const bindingDefaults = useAtomValue(view.model.bindingDefaults);
  const { list: citationStyles } = useAtomValue(view.model.styles);
  const { workbench } = view;
  const tab = useAtomValue(workbench.tab);
  useAtomValue(workbench.document.revision);
  const { result, trigger, attempt, busy, staleReason } = useAtomValue(
    workbench.scheduler.state,
  );
  const formatProblem = (result?.diagnostics ?? []).find(
    ({ part, engine }) =>
      part === "annotation" || engine?.template === "annotation",
  );
  const annotation = useAtomValue(workbench.examples).example;
  const advanced = useAtomValue(workbench.advanced);
  const [sourceVisited, setSourceVisited] = useState(advanced);
  useEffect(() => {
    if (advanced && !sourceVisited) setSourceVisited(true);
  }, [advanced, sourceVisited]);
  const kind = controller.kind;
  const languageCaption =
    controller.plainDocument?.manifest.language === "eta"
      ? m.workbench_name_language_eta()
      : m.workbench_name_language_liquid();
  const { presentation } = useAtomValue(view.model.view);
  const customization = useAtomValue(view.model.customization);
  const { selected, reveal, fieldFocus } = presentation;
  const setSelected = (selected: number | null) =>
    view.setPresentation({ selected });
  const setReveal = (reveal: WorkbenchViewState["presentation"]["reveal"]) =>
    view.setPresentation({ reveal });
  const previewStatus = useAtomValue(view.model.read).status;
  useEffect(
    () => view.restoreScroll(),
    [view, presentation.restoreVersion, previewStatus, reveal],
  );
  useEffect(() => {
    if (!insertRequest) return;
    const position = entryPosition(insertRequest.slice);
    view.setPresentation({
      ...(position === null ? {} : { selected: position }),
      reveal: { ...insertRequest.range, focus: insertRequest.focus },
    });
  }, [view, insertRequest]);
  const manifest = useAtomValue(view.workbench.document.manifest);
  const missingPartials = (result?.diagnostics ?? []).flatMap((diagnostic) =>
    diagnostic.code === "missing-partial" &&
    diagnostic.params?.name !== undefined
      ? [String(diagnostic.params.name)]
      : [],
  );
  const partialsFor = (
    partialContext: PartialContext,
  ): PartialPlaceholderHost | undefined => {
    const previews = view.partialPreviews;
    if (!previews) return undefined;
    return {
      missing: missingPartials,
      preview: (name) => previews(JSON.stringify([name, partialContext])),
      onEdit: (name) => view.openPartial(name),
      onShowProblem: (name) => {
        const found = diagnoses.find(
          (diagnosis) =>
            diagnosis.kind === "render" &&
            diagnosis.diagnostic.code === "missing-partial" &&
            String(diagnosis.diagnostic.params?.name) === name,
        );
        if (found) problems.select(found.id);
        else problems.setOpen(true);
      },
    };
  };
  const sourceBoxes = usePartialBoxes(
    controller,
    "source",
    kind === "profile"
      ? undefined
      : partialsFor(
          kind === "citation" ? "citation" : controller.partialContext,
        ),
  );
  const documentProblems = controller.problems.map((entry) =>
    entry.slice === "details" && manifest === null
      ? { ...entry, slice: "advanced" as const }
      : entry,
  );
  const [arrival, setArrival] = useState<ArrivingProblem | null>(null);
  const arrivalAttempt = useRef(0);
  const pendingArrival = view.arrival;
  const arrivalDiagnostic = arrival?.diagnostic;
  const diagnoses = workbenchDiagnoses(documentProblems, [
    ...(result?.diagnostics ?? []),
    ...(arrivalDiagnostic === undefined ? [] : [arrivalDiagnostic]),
  ]);
  const problems = useWorkbenchProblems({
    diagnoses,
    trigger,
    attempt,
    capture: {
      source: controller.source,
      context: () =>
        view.reportContext(view.registry.get(view.model.view).root),
    },
  });
  const selectProblem = problems.select;
  const openProblems = problems.setOpen;
  useEffect(
    () => view.subscribeOpenProblems(() => openProblems(true)),
    [view, openProblems],
  );
  useEffect(() => {
    if (!pendingArrival) return;
    arrivalAttempt.current = attempt;
    setArrival(pendingArrival);
    view.takeArrival();
    openProblems(true);
  }, [view, pendingArrival, openProblems, attempt]);
  const arrivalSelection = useRef<ArrivingProblem | null>(null);
  const detected = diagnoses.map(({ id }) => id).join("\n");
  useEffect(() => {
    if (!arrival || arrivalSelection.current === arrival) return;
    const match = diagnoses.find(
      (diagnosis) =>
        diagnosis.kind === "render" &&
        diagnosis.diagnostic.code === arrival.diagnostic.code &&
        String(diagnosis.diagnostic.params?.name ?? "") ===
          String(arrival.diagnostic.params?.name ?? ""),
    );
    if (!match) return;
    arrivalSelection.current = arrival;
    selectProblem(match.id);
  }, [arrival, detected, diagnoses, selectProblem]);
  useEffect(() => {
    if (
      !arrival ||
      attempt <= arrivalAttempt.current ||
      busy ||
      staleReason !== null ||
      !result ||
      documentProblems.length > 0
    )
      return;
    const { report, part } = arrival.diagnostic;
    const annotationCheck =
      kind === "profile" &&
      (part === "annotation" || report?.context.root === "annotation");
    const output = annotationCheck
      ? result.annotation
      : kind === "profile"
        ? result.creationBody
        : kind === "citation"
          ? result.citation
          : result.partial;
    if (output === null) return;
    if (
      result.diagnostics.some((diagnostic) =>
        annotationCheck
          ? diagnostic.part === "annotation"
          : diagnostic.part !== "annotation",
      )
    )
      return;
    const context = view.reportContext(
      kind === "profile"
        ? "note"
        : kind === "citation"
          ? "citation"
          : view.partialContext,
    );
    if (
      (report?.context.document !== undefined &&
        report.context.document !== context.document) ||
      (report?.context.selection !== undefined &&
        report.context.selection !== context.selection) ||
      (report?.context.root !== undefined &&
        report.context.root !== context.root &&
        !(
          report.context.root === "annotation" && result.annotation !== null
        )) ||
      (report?.context.selection === undefined &&
        report?.identity.snapshotRevision &&
        report.identity.snapshotRevision !== result.snapshotRevision) ||
      (report?.identity.annotationId !== undefined &&
        report.identity.annotationId !== result.annotationId) ||
      (annotationCheck && result.annotation === null)
    )
      return;
    setArrival(null);
  }, [
    arrival,
    attempt,
    busy,
    staleReason,
    result,
    documentProblems.length,
    view,
    kind,
  ]);
  const state = view.change;
  const repair = repairCommands({
    registry: view.registry,
    model: { view: view.model.view, fieldsPanel: workbench.fieldsPanel },
    controller,
    problems,
  });
  const revealHandler = useRef(repair.goToProblem);
  revealHandler.current = repair.goToProblem;
  useEffect(
    () => view.subscribeReveals((target) => revealHandler.current(target)),
    [view],
  );
  const selection =
    (slice: WorkbenchInsertTarget["slice"]) => (range: WorkbenchSliceRange) =>
      onSelection({ slice, range });
  const content = (
    <div className="zt:@container-[size]/workbench-editor zt:flex zt:h-full zt:min-w-0 zt:flex-col zt:text-sm">
      {originatingNote && (
        <div
          data-part="originating-note"
          className={originatingNoteNotice.root}
        >
          <div className={originatingNoteNotice.guidance}>
            <p className={originatingNoteNotice.scope}>
              {(tab === "annotation"
                ? m.template_workbench_shared_annotation
                : m.template_workbench_shared_template)({
                name: view.profileLabel ?? m.settings_profile_default_name(),
              })}
            </p>
            <p className={originatingNoteNotice.behavior}>
              {m.template_workbench_auto_save_scope()}
            </p>
          </div>
          <div className={originatingNoteNotice.action}>
            <span className={originatingNoteNotice.note}>
              <Icon name="file-text" aria-hidden="true" />
              <span className={originatingNoteNotice["note-name"]}>
                {originatingNote.basename}
              </span>
            </span>
            <button
              className={originatingNoteNotice.button}
              disabled={updatingNote}
              onClick={() => view.startNoteUpdate()}
            >
              <span className={originatingNoteNotice.labels}>
                <span
                  className={
                    updatingNote
                      ? originatingNoteNotice["label-hidden"]
                      : undefined
                  }
                  aria-hidden={updatingNote}
                >
                  {m.template_workbench_update_this_note()}
                </span>
                <span
                  className={
                    !updatingNote
                      ? originatingNoteNotice["label-hidden"]
                      : undefined
                  }
                  aria-hidden={!updatingNote}
                >
                  {m.notice_updating_note()}
                </span>
              </span>
            </button>
          </div>
        </div>
      )}
      {isDefaultDraft && (
        <p
          role="status"
          className="zt:px-3 zt:pb-2 zt:text-xs zt:leading-normal zt:text-muted-foreground"
        >
          {m.template_workbench_default_inspect()}
          <button
            className={templateWorkbenchButton}
            disabled={customization === "pending"}
            onClick={() => view.startCustomize()}
          >
            {customization === "pending"
              ? m.template_workbench_default_creating()
              : customization === "failed"
                ? m.settings_citation_engine_retry()
                : m.template_workbench_customize()}
          </button>
          {customization === "failed" && (
            <span role="alert">
              {m.notice_profile_document_customize_failed()}
            </span>
          )}
        </p>
      )}
      {unavailable.map((message) => (
        <p
          key={message}
          role="status"
          className="zt:px-3 zt:pb-2 zt:text-xs zt:leading-normal zt:text-muted-foreground"
        >
          {message}
        </p>
      ))}
      {!advanced && (
        <TabBar
          tabs={tabsFor(kind)}
          defaultProfile={view.isDefaultProfile ? true : undefined}
          onTabChange={(tab) => {
            if (tab !== "partial")
              state.setRoot(
                tab === "annotation"
                  ? "annotation"
                  : tab === "name"
                    ? "filename"
                    : tab === "citation"
                      ? "citation"
                      : "note",
              );
            setReveal(null);
            if (tab === "name") view.startStylesRefresh();
          }}
        />
      )}
      <div
        data-workbench-scroll="editor"
        className="zt:min-h-0 zt:flex-1 zt:overflow-auto"
      >
        {kind !== "profile" ? (
          <TabPanel tab={kind}>
            <p className={selectionHint}>{languageCaption}</p>
            <SliceEditor
              controller={controller}
              slice="source"
              label={
                kind === "citation"
                  ? m.workbench_tab_citation()
                  : m.workbench_tab_partial()
              }
              extensions={sourceBoxes.extensions}
              reveal={reveal}
              onSelection={selection("source")}
            />
            {sourceBoxes.boxes}
          </TabPanel>
        ) : (
          <>
            {(advanced || sourceVisited) && (
              <div data-workbench-mode="source" hidden={!advanced}>
                <SliceEditor
                  controller={controller}
                  slice="advanced"
                  label={m.workbench_advanced()}
                  reveal={advanced ? reveal : null}
                  onSelection={selection("advanced")}
                />
              </div>
            )}
            <TabPanel tab="note" modeActive={!advanced}>
              <NotePane
                controller={controller}
                preview={result?.annotation ?? null}
                previewHint={
                  annotation ? null : m.workbench_preview_choose_annotation()
                }
                formatProblem={
                  formatProblem ? diagnosticText(formatProblem) : null
                }
                annotationSelector={
                  view.previewRenderDeps ? (
                    <AnnotationSelection view={view} />
                  ) : null
                }
                onOpenAnnotation={repair.openAnnotationBox}
                partials={partialsFor("note")}
                reveal={advanced ? null : reveal}
                onSelection={(range) => {
                  selection("note")(range);
                }}
              />
            </TabPanel>
            <TabPanel tab="properties" modeActive={!advanced}>
              {controller.managedEntries === null ? (
                <p>
                  {m.template_workbench_properties_advanced()}{" "}
                  <button
                    className={templateWorkbenchButton}
                    onClick={() => state.setAdvanced(true)}
                  >
                    {m.workbench_advanced()}
                  </button>
                </p>
              ) : (
                <PropertiesPane
                  onChooseItem={() => view.startItemChoice()}
                  onRetry={() => view.refresh()}
                  onShowProblem={(id) => problems.select(id)}
                  controller={controller}
                  entries={controller.managedEntries}
                  properties={result?.properties ?? []}
                  fold={result?.fold ?? []}
                  diagnostics={entryDiagnostics(
                    result?.diagnostics ?? [],
                    controller.problems,
                  )}
                  selected={selected}
                  onSelect={setSelected}
                  onOpenSource={(range) => {
                    state.setAdvanced(true);
                    setReveal(range);
                  }}
                  reveal={advanced ? null : reveal}
                  onSelection={selection(
                    selected === null ? "advanced" : `entry:${selected}`,
                  )}
                />
              )}
            </TabPanel>
            <TabPanel tab="match" modeActive={!advanced}>
              <ViewMatchPane
                onChooseItem={() => view.startItemChoice()}
                controller={controller}
              />
            </TabPanel>
            <TabPanel tab="annotation" modeActive={!advanced}>
              {formatProblem && (
                <button
                  type="button"
                  data-part="problem-open"
                  className={templateWorkbenchButton}
                  onClick={() =>
                    problems.select(renderDiagnosis(formatProblem).id)
                  }
                >
                  {m.workbench_problem_show()}
                </button>
              )}
              <AnnotationPane
                controller={controller}
                problem={formatProblem ? diagnosticText(formatProblem) : null}
                partials={partialsFor("annotation")}
                reveal={advanced ? null : reveal}
                onSelection={selection("annotation")}
              />
            </TabPanel>
            <TabPanel tab="name" modeActive={!advanced}>
              <NameFolderPane
                onChooseItem={() => view.startItemChoice()}
                onRetry={() => view.refresh()}
                controller={controller}
                manifest={manifest}
                defaults={bindingDefaults}
                citationStyles={citationStyles}
                focus={fieldFocus}
                filename={result?.filename ?? null}
                notePath={result?.notePath ?? null}
                onOpenSource={() => state.setAdvanced(true)}
                onShowProblem={(id) => problems.select(id)}
                reveal={advanced ? null : reveal}
                onSelection={selection("filename")}
              />
            </TabPanel>
            <TabPanel tab="profile" modeActive={!advanced}>
              <NameFolderPane
                section="profile"
                controller={controller}
                manifest={manifest}
                focus={fieldFocus}
                filename={null}
                notePath={null}
                onOpenSource={() => state.setAdvanced(true)}
              />
            </TabPanel>
          </>
        )}
      </div>
      <ProblemsFooter
        problems={problems}
        onOpen={repair.openDiagnosis}
        onReturn={repair.returnToTemplate}
      />
    </div>
  );
  return (
    <WorkbenchDiagnosticsProvider
      value={problems.diagnoses}
      onReveal={selectProblem}
    >
      <div className="zt:flex zt:h-full zt:min-h-0 zt:flex-col">
        <ViewItemRow view={view} />
        <div
          ref={view.measurePanels}
          data-workbench-panels=""
          className="zt:min-h-0 zt:flex-1"
        >
          <SidePanels
            panels={{
              fields: {
                label: m.workbench_view_fields(),
                resizeLabel: m.workbench_fields_resize(),
                content: (
                  <FieldsPanel view={view} actions={view.fieldsActions} />
                ),
                actions: <FieldsMoreOptions view={view} />,
              },
              preview: {
                label: m.workbench_view_preview(),
                resizeLabel: m.workbench_preview_resize(),
                content: (
                  <PreviewPanel view={view} showProblem={repair.showProblem} />
                ),
              },
            }}
          >
            {content}
          </SidePanels>
        </div>
      </div>
    </WorkbenchDiagnosticsProvider>
  );
}

function AnnotationSelection({ view }: { view: TemplateWorkbenchView }) {
  const { current, example } = useAtomValue(view.workbench.examples);
  return (
    <AnnotationSampleBar
      compact
      current={current}
      example={example}
      onSelect={(id) =>
        view.registry.update(view.workbench.choices, chooseAnnotation(id))
      }
    />
  );
}
