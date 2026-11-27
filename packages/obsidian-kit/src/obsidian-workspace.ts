import type { ObsidianEventEmitter } from "#obsidian-event-source.ts";
import type { Cause, Scope, Stream } from "effect";
import { Context, Effect, Layer, Schema } from "effect";
import type {
  Editor,
  MarkdownFileInfo,
  Menu,
  OpenViewState,
  PaneType,
  SplitDirection,
  TAbstractFile,
  TextFileView,
  TFile,
  Workspace as ObsidianWorkspace,
  WorkspaceLeaf,
  WorkspaceRoot,
} from "obsidian";
import { MarkdownView, View } from "obsidian";

import { logAndContinue } from "@zotlit/plugin-kernel/effect-log.ts";

import { loadedTextFileView } from "#live-text.ts";
import { ObsidianApp } from "#obsidian-app.ts";
import {
  obsidianEventSource,
  obsidianListener,
} from "#obsidian-event-source.ts";

export class OpenLinkFailed extends Schema.TaggedError<
  OpenLinkFailed,
  { readonly brand: unique symbol }
>()("OpenLinkFailed", {
  linktext: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export type WorkspaceSource = Pick<
  ObsidianWorkspace,
  | "activeEditor"
  | "activeLeaf"
  | "leftSplit"
  | "rightSplit"
  | "getLastOpenFiles"
  | "getMostRecentLeaf"
  | "onLayoutReady"
  | "getActiveFile"
  | "getActiveViewOfType"
  | "getLeavesOfType"
  | "iterateAllLeaves"
  | "updateOptions"
  | "openLinkText"
  | "getLeaf"
  | "getRightLeaf"
  | "createLeafBySplit"
  | "openPopoutLeaf"
  | "moveLeafToPopout"
  | "rootSplit"
  | "setActiveLeaf"
  | "revealLeaf"
  | "trigger"
  | "requestActiveLeafEvents"
  | "readWorkspaceFile"
> &
  ObsidianEventEmitter & { requestSaveLayout(): void };

export function insertionEditor(
  source: Pick<WorkspaceSource, "activeEditor" | "getMostRecentLeaf">,
): MarkdownFileInfo | null {
  const active = source.activeEditor;
  if (active instanceof MarkdownView && active.getMode() !== "source")
    return null;
  if (active) return active;
  const view = source.getMostRecentLeaf()?.view;
  return view instanceof MarkdownView && view.getMode() === "source"
    ? view
    : null;
}

export type WorkspaceEvent =
  | {
      readonly _tag: "quick-preview";
      readonly file: TFile;
      readonly source: string;
    }
  | { readonly _tag: "file-open"; readonly file: TFile | null }
  | { readonly _tag: "layout-change" }
  | {
      readonly _tag: "active-leaf-change";
      readonly leaf: WorkspaceLeaf | null;
    }
  | { readonly _tag: "css-change" }
  | {
      readonly _tag: "window-open" | "window-close";
      readonly window: Window;
    };

export interface FileMenuOrigin {
  readonly source: string;
  readonly leaf: WorkspaceLeaf | undefined;
}

export interface WorkspaceShape {
  readonly activeView: Effect.Effect<View | null>;
  readonly activeEditor: Effect.Effect<MarkdownFileInfo | null>;
  readonly activeLeaf: Effect.Effect<WorkspaceLeaf | null>;
  readonly insertionEditor: Effect.Effect<MarkdownFileInfo | null>;
  readonly sidebarRoots: Effect.Effect<
    Pick<WorkspaceSource, "leftSplit" | "rightSplit">
  >;
  readonly lastOpenFiles: Effect.Effect<readonly string[]>;
  readonly requestSaveLayout: Effect.Effect<void>;
  readonly layoutReady: Effect.Effect<void>;
  readonly changes: Stream.Stream<WorkspaceEvent>;
  readonly windows: Effect.Effect<readonly Window[]>;
  readonly getActiveFile: Effect.Effect<TFile | null>;
  readonly activeMarkdownView: Effect.Effect<MarkdownView | null>;
  readonly markdownViews: Effect.Effect<readonly MarkdownView[]>;
  leavesOfType(type: string): Effect.Effect<readonly WorkspaceLeaf[]>;
  loadedTextView(
    file: TFile,
    exclude?: TextFileView,
  ): Effect.Effect<TextFileView | null>;
  readonly readWorkspaceFile: Effect.Effect<unknown, Cause.UnknownError>;
  readonly updateOptions: Effect.Effect<void>;
  readonly requestActiveLeafEvents: Effect.Effect<void>;
  openLinkText(
    linktext: string,
    sourcePath: string,
    options?: {
      readonly newLeaf?: PaneType | boolean;
      readonly state?: OpenViewState;
    },
  ): Effect.Effect<void, OpenLinkFailed>;
  getLeaf(newLeaf?: PaneType | boolean): Effect.Effect<WorkspaceLeaf>;
  getRightLeaf(split: boolean): Effect.Effect<WorkspaceLeaf | null>;
  createLeafBySplit(
    leaf: WorkspaceLeaf,
    direction?: SplitDirection,
    before?: boolean,
  ): Effect.Effect<WorkspaceLeaf>;
  openPopoutLeaf(size: {
    readonly width: number;
    readonly height: number;
  }): Effect.Effect<WorkspaceLeaf>;
  moveLeafToPopout(
    leaf: WorkspaceLeaf,
    size: { readonly width: number; readonly height: number },
  ): Effect.Effect<void>;
  readonly rootSplit: Effect.Effect<WorkspaceRoot>;
  revealLeaf(leaf: WorkspaceLeaf): Effect.Effect<void, Cause.UnknownError>;
  setActiveLeaf(
    leaf: WorkspaceLeaf,
    options?: { readonly focus?: boolean },
  ): Effect.Effect<void>;
  trigger(name: string, ...data: unknown[]): Effect.Effect<void>;
  onFileMenu<R = never>(
    handler: (
      menu: Menu,
      file: TAbstractFile,
      origin: FileMenuOrigin,
    ) => Effect.Effect<void, never, R>,
  ): Effect.Effect<void, never, R | Scope.Scope>;
  onEditorMenu<R = never>(
    handler: (
      menu: Menu,
      editor: Editor,
      info: MarkdownView | MarkdownFileInfo,
    ) => Effect.Effect<void, never, R>,
  ): Effect.Effect<void, never, R | Scope.Scope>;
}

export class Workspace extends Context.Service<Workspace, WorkspaceShape>()(
  "zotlit/obsidian/Workspace",
) {}

export const makeWorkspace = Effect.fnUntraced(function* (
  source: WorkspaceSource,
) {
  const events = yield* obsidianEventSource<WorkspaceEvent>();
  yield* events.listen(source, "file-open", (file: TFile | null) => ({
    _tag: "file-open",
    file,
  }));
  yield* events.listen(source, "layout-change", () => ({
    _tag: "layout-change",
  }));
  yield* events.listen(
    source,
    "active-leaf-change",
    (leaf: WorkspaceLeaf | null) => ({ _tag: "active-leaf-change", leaf }),
  );
  yield* events.listen(source, "css-change", () => ({ _tag: "css-change" }));
  yield* events.listen(
    source,
    "window-open",
    (_win: unknown, window: Window) => ({ _tag: "window-open", window }),
  );
  yield* events.listen(
    source,
    "window-close",
    (_win: unknown, window: Window) => ({ _tag: "window-close", window }),
  );

  const menuHook = <Args extends unknown[], R>(
    name: string,
    toEffect: (...args: Args) => Effect.Effect<void, never, R>,
  ) =>
    Effect.gen(function* () {
      const run = Effect.runSyncWith(yield* Effect.context<R>());
      yield* obsidianListener(source, name, (...args) => {
        run(
          toEffect(...(args as Args)).pipe(
            logAndContinue("Menu handler failed", "workspace", { menu: name }),
          ),
        );
      });
    });

  yield* events.listen(
    source,
    "quick-preview",
    (file: TFile, text: string) => ({
      _tag: "quick-preview",
      file,
      source: text,
    }),
  );

  return Workspace.of({
    activeView: Effect.sync(() => source.getActiveViewOfType(View)).pipe(
      Effect.withSpan("Workspace.activeView"),
    ),
    activeLeaf: Effect.sync(() => source.activeLeaf).pipe(
      Effect.withSpan("Workspace.activeLeaf"),
    ),
    activeEditor: Effect.sync(() => source.activeEditor).pipe(
      Effect.withSpan("Workspace.activeEditor"),
    ),
    insertionEditor: Effect.sync(() => insertionEditor(source)).pipe(
      Effect.withSpan("Workspace.insertionEditor"),
    ),
    windows: Effect.sync(() => {
      const windows = new Set<Window>();
      source.iterateAllLeaves((leaf) => {
        windows.add(leaf.getContainer().win);
      });
      return [...windows];
    }).pipe(Effect.withSpan("Workspace.windows")),
    sidebarRoots: Effect.sync(() => ({
      leftSplit: source.leftSplit,
      rightSplit: source.rightSplit,
    })).pipe(Effect.withSpan("Workspace.sidebarRoots")),
    lastOpenFiles: Effect.sync(() => source.getLastOpenFiles()).pipe(
      Effect.withSpan("Workspace.lastOpenFiles"),
    ),
    requestSaveLayout: Effect.sync(() => source.requestSaveLayout()).pipe(
      Effect.withSpan("Workspace.requestSaveLayout"),
    ),
    layoutReady: Effect.callback<void>((resume) => {
      source.onLayoutReady(() => resume(Effect.void));
    }),
    changes: events.stream,
    getActiveFile: Effect.sync(() => source.getActiveFile()),
    activeMarkdownView: Effect.sync(() =>
      source.getActiveViewOfType(MarkdownView),
    ),
    markdownViews: Effect.sync(() =>
      source
        .getLeavesOfType("markdown")
        .flatMap(({ view }) => (view instanceof MarkdownView ? [view] : [])),
    ).pipe(Effect.withSpan("Workspace.markdownViews")),
    leavesOfType: Effect.fn("Workspace.leavesOfType")((type) =>
      Effect.sync(() => source.getLeavesOfType(type)),
    ),
    loadedTextView: Effect.fn("Workspace.loadedTextView")((file, exclude) =>
      Effect.sync(() =>
        loadedTextFileView({ workspace: source }, file, exclude),
      ),
    ),
    readWorkspaceFile: Effect.suspend(() => {
      const read = source.readWorkspaceFile?.bind(source);
      return read === undefined
        ? Effect.succeed(null)
        : Effect.tryPromise(() => read());
    }).pipe(Effect.withSpan("Workspace.readWorkspaceFile")),
    updateOptions: Effect.sync(() => source.updateOptions()).pipe(
      Effect.withSpan("Workspace.updateOptions"),
    ),
    requestActiveLeafEvents: Effect.sync(() =>
      source.requestActiveLeafEvents.run(),
    ).pipe(Effect.withSpan("Workspace.requestActiveLeafEvents")),
    openLinkText: Effect.fn("Workspace.openLinkText")(
      (linktext, sourcePath, options = {}) =>
        Effect.tryPromise({
          try: () =>
            source.openLinkText(
              linktext,
              sourcePath,
              options.newLeaf,
              options.state,
            ),
          catch: (cause) =>
            new OpenLinkFailed({
              linktext,
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
    ),
    getLeaf: Effect.fn("Workspace.getLeaf")((newLeaf) =>
      Effect.sync(() => source.getLeaf(newLeaf)),
    ),
    getRightLeaf: Effect.fn("Workspace.getRightLeaf")((split) =>
      Effect.sync(() => source.getRightLeaf(split)),
    ),
    createLeafBySplit: Effect.fn("Workspace.createLeafBySplit")(
      (leaf, direction, before) =>
        Effect.sync(() => source.createLeafBySplit(leaf, direction, before)),
    ),
    openPopoutLeaf: Effect.fn("Workspace.openPopoutLeaf")((size) =>
      Effect.sync(() => source.openPopoutLeaf({ size })),
    ),
    moveLeafToPopout: Effect.fn("Workspace.moveLeafToPopout")((leaf, size) =>
      Effect.sync(() => void source.moveLeafToPopout(leaf, { size })),
    ),
    rootSplit: Effect.sync(() => source.rootSplit).pipe(
      Effect.withSpan("Workspace.rootSplit"),
    ),
    revealLeaf: Effect.fn("Workspace.revealLeaf")((leaf) =>
      Effect.tryPromise((_signal) => source.revealLeaf(leaf)),
    ),
    setActiveLeaf: Effect.fn("Workspace.setActiveLeaf")((leaf, options = {}) =>
      Effect.sync(() => source.setActiveLeaf(leaf, options)),
    ),
    trigger: Effect.fnUntraced(function* (name, ...data) {
      yield* Effect.sync(() => source.trigger(name, ...data));
    }),
    onFileMenu: Effect.fn("Workspace.onFileMenu")((handler) =>
      menuHook(
        "file-menu",
        (
          ...[menu, file, from, leaf]: [
            Menu,
            TAbstractFile,
            string,
            WorkspaceLeaf | undefined,
          ]
        ) => handler(menu, file, { source: from, leaf }),
      ),
    ),
    onEditorMenu: Effect.fn("Workspace.onEditorMenu")((handler) =>
      menuHook(
        "editor-menu",
        (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) =>
          handler(menu, editor, info),
      ),
    ),
  });
});

export const layerWorkspaceFrom = (
  source: WorkspaceSource,
): Layer.Layer<Workspace> => Layer.effect(Workspace, makeWorkspace(source));

export interface WorkspaceEventHost {
  readonly workspace: Pick<ObsidianWorkspace, "trigger">;
}

export function workspaceTrigger(
  workspace: Pick<WorkspaceShape, "trigger">,
  run: (effect: Effect.Effect<void>) => void,
): Pick<ObsidianWorkspace, "trigger"> {
  return { trigger: (name, ...data) => run(workspace.trigger(name, ...data)) };
}

export const layerWorkspace: Layer.Layer<Workspace, never, ObsidianApp> =
  Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      return yield* makeWorkspace(app.workspace);
    }),
  );
