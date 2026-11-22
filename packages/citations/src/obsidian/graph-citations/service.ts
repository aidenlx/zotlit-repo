import type { CitationLookupObservation } from "#obsidian/citation-index/lookup-service.ts";
import type { CitationSyntax } from "#obsidian/citation-index/scan.ts";
import type { NavigationPane } from "#obsidian/citekey-navigation/index.ts";
import { Context, Effect, Exit, FiberHandle, Layer, Ref, Stream } from "effect";
import { around } from "monkey-around";
import type {
  GraphOptions,
  GraphData,
  GraphRenderer,
  GraphView,
  View,
  WorkspaceLeaf,
} from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import {
  Workspace,
  workspaceTrigger,
} from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag, forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { workLabel } from "@zotlit/plugin-kernel/item-summary.ts";
import type { WorkLabel } from "@zotlit/plugin-kernel/item-summary.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import {
  itemKeyFromFrontmatter,
  NoteIndex,
} from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { changed as readsChanged } from "@zotlit/zotero-reads/client/events.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { heldResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type { WorkLabelSource } from "@zotlit/zotero-reads/contract/rpc.ts";

import { graphCitationAdditions, NO_ADDITIONS } from "./adapter.ts";
import type { GraphCitationAdditions } from "./adapter.ts";
import { wrapNodeClick } from "./click.ts";
import {
  AUTHOR_TITLE_LABELS,
  colorCitationLinks,
  installDisplayRows,
} from "./display.ts";
import { renderWithFacade } from "./facade.ts";
import { graphCitationFilters, installFilterRows } from "./filters.ts";
import { installGroupsButton } from "./groups.ts";
import { wrapNodeHover } from "./hover.ts";
import type { NodeHoverDeps } from "./hover.ts";
import {
  GRAPH_CORE_PLUGIN_ID,
  GRAPH_VIEW_TYPES,
  graphMembersOf,
} from "./install.ts";
import type { GraphLeafMembers } from "./install.ts";
import { GraphLinkColor, installLinkColors } from "./link-color.ts";
import { GraphNodeColors, installNodeColors } from "./node-color.ts";
import { applyCitationGraphPreset } from "./preset.ts";
import { wrapNodeRightClick } from "./right-click.ts";
import type { NodeRightClickDeps } from "./right-click.ts";
import { rowFlag } from "./rows.ts";
import { deferredLeafOptions, savedLeafOptions } from "./saved-options.ts";
import { installGraphViewState } from "./view-state.ts";
import { WorkLabelGraphics } from "./work-labels.ts";

import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { CitekeyEditor } from "#obsidian/citekey-editor/service.ts";

const RENDER_SETTLE = "150 millis";

interface GraphInstallation {
  members: GraphLeafMembers;
  restores: DisposableStack;
  rows: Disposable;
  additions: GraphCitationAdditions;
  drawn: GraphData["nodes"];
  labels: Map<string, WorkLabel>;
  graphics: WorkLabelGraphics;
}

interface AttachOptions {
  saved: GraphOptions | null;
  view: View;
  wikilinks: boolean;
}

interface HeldLabel {
  readonly libraryID: number;
  readonly label: WorkLabel;
}

function heldLabel(source: WorkLabelSource | undefined): HeldLabel | null {
  const label = source ? workLabel(source, source) : null;
  return source && label ? { libraryID: source.libraryID, label } : null;
}

function releasedOnDispose(view: View, callback: () => void): Disposable {
  let held: (() => void) | null = callback;
  view.register(() => held?.());
  return disposable(() => {
    held = null;
  });
}

export class GraphCitations extends Context.Service<
  GraphCitations,
  {
    readonly enabled: Effect.Effect<boolean>;
    applyPreset(leaf: WorkspaceLeaf): Effect.Effect<void>;
  }
>()("zotlit/graph-citations/GraphCitations") {}

export const layerGraphCitations = Layer.effect(
  GraphCitations,
  Effect.gen(function* () {
    const env = yield* ObsidianEnv;
    const host = yield* PluginHost;
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const reads = yield* ZoteroReads;
    const libraryScope = yield* LibraryScope;
    const citationIndex = yield* CitationIndex;
    const citationLookup = yield* CitationLookup;
    const noteIndex = yield* NoteIndex;
    const citekeyEditor = yield* CitekeyEditor;
    const showInLibrary = yield* ShowInLibrary;
    const citationPopover = yield* CitationPopover;
    const settings = yield* PluginSettings;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    const savedLeaves = yield* Ref.make(
      yield* workspace.readWorkspaceFile.pipe(
        Effect.map((layout) => savedLeafOptions(layout)),
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "Workspace file unreadable; local graph rows start fresh",
          ).pipe(
            Effect.annotateLogs({ cause }),
            Effect.as(new Map<string, GraphOptions>()),
          ),
        ),
      ),
    );

    const labels = new Map<string, HeldLabel | null>();
    const staleLabels = new Set<string>();
    const labelRead = yield* Ref.make<{
      readonly keys: ReadonlySet<string>;
    } | null>(null);
    const labelReads = yield* FiberHandle.make<void>();
    let lookup: CitationLookupObservation | null = null;
    const installationCount = yield* Ref.make(0);
    const installations = new WeakMap<GraphRenderer, GraphInstallation>();
    const leftNative = new WeakSet<View>();
    const nodeColors = new GraphNodeColors();
    const linkColor = new GraphLinkColor();
    const deferredOptions = new WeakMap<WorkspaceLeaf, GraphOptions>();
    const enabled = yield* Ref.make(true);
    const wikilinkCitations = yield* Ref.make(false);
    const stopped = yield* Ref.make(false);
    const renderPending = yield* Ref.make(false);
    const renderTimer = yield* FiberHandle.make<void>();

    const active = Effect.gen(function* () {
      return (yield* Ref.get(enabled)) && !(yield* Ref.get(stopped));
    });

    const triggerWorkspace = workspaceTrigger(workspace, run);
    const cacheOf = (path: string) => run(metadata.cache(path));
    const resolveCitekey = (citekey: string) =>
      heldResolution(lookup?.current?.value ?? null, citekey);
    const open = (citekey: string, pane: NavigationPane): void => {
      bridge.runAndForget(citekeyEditor.openCitekey(citekey, pane));
    };

    const releaseLookup = (): void => {
      lookup?.[Symbol.dispose]();
      lookup = null;
    };

    const graphLeaves = Effect.forEach(GRAPH_VIEW_TYPES, (type) =>
      workspace.leavesOfType(type),
    ).pipe(Effect.map((found) => found.flat()));

    const installed = graphLeaves.pipe(
      Effect.map((leaves) =>
        leaves.flatMap((leaf) => {
          const { renderer } = leaf.view as GraphView;
          const installation = renderer && installations.get(renderer);
          return installation ? [{ leaf, installation }] : [];
        }),
      ),
    );

    const render = ({ engine, viewType }: GraphLeafMembers) =>
      Effect.suspend(() => {
        try {
          engine.render();
          return Effect.void;
        } catch (error) {
          return Effect.logWarning("Graph render failed").pipe(
            Effect.annotateLogs({ viewType, error }),
          );
        }
      });

    const additionsOf = Effect.fnUntraced(function* (
      engine: GraphLeafMembers["engine"],
    ) {
      const wikilinks = yield* Ref.get(wikilinkCitations);
      const syntaxes: CitationSyntax[] = wikilinks
        ? ["citekey", "wikilink"]
        : ["citekey"];
      const occurrences = yield* citationIndex.citationsByPath(syntaxes);
      lookup?.set({
        citekeys: [
          ...new Set(
            [...occurrences.values()].flatMap((found) =>
              found.flatMap((occurrence) =>
                occurrence.kind === "citekey" ? [occurrence.raw] : [],
              ),
            ),
          ),
        ],
      });
      const linkKey = (linkpath: string, sourcePath: string) =>
        `${sourcePath}\0${linkpath}`;
      const linkTargets = new Map<string, string | null>();
      for (const [sourcePath, found] of occurrences) {
        for (const { kind, raw } of found) {
          const key = linkKey(raw, sourcePath);
          if (kind !== "wikilink" || linkTargets.has(key)) continue;
          const target = yield* metadata.firstLinkpathDest(raw, sourcePath);
          linkTargets.set(key, target?.path ?? null);
        }
      }
      const notePaths = new Map<string, string[]>();
      for (const indexedKey of yield* noteIndex.getIndexedItemKeys) {
        const files = yield* noteIndex.getNotesByItemKey(indexedKey);
        notePaths.set(
          indexedKey,
          files.map((file) => file.path),
        );
      }
      const resolvedLinks = yield* metadata.resolvedLinks;
      return graphCitationAdditions({
        occurrences,
        resolveCitekey,
        resolveLink: (linkpath, sourcePath) =>
          linkTargets.get(linkKey(linkpath, sourcePath)) ?? null,
        notePathsOf: (indexedKey) => notePaths.get(indexedKey) ?? [],
        literatureNotes: [...notePaths.values()].flat(),
        resolvedLinks,
        filters: graphCitationFilters(engine, { wikilinkCitations: wikilinks }),
      });
    });

    const requestRender = Effect.fnUntraced(function* (withRender: boolean) {
      if (!(yield* active)) return;
      if (withRender) yield* Ref.set(renderPending, true);
      yield* FiberHandle.run(renderTimer)(
        Effect.sleep(RENDER_SETTLE).pipe(
          Effect.andThen(flushRender),
          Effect.interruptible,
        ),
      );
    });

    const flushRender: Effect.Effect<void> = Effect.gen(function* () {
      const rerender = yield* Ref.getAndSet(renderPending, false);
      const live = yield* installed;
      if (rerender)
        for (const { installation } of live)
          yield* render(installation.members);
      yield* showLabels;
    }).pipe(Effect.uninterruptible);

    const cancelLabelRead = Effect.gen(function* () {
      yield* Ref.set(labelRead, null);
      yield* FiberHandle.clear(labelReads);
    });

    const invalidateLabels = Effect.gen(function* () {
      for (const key of labels.keys()) staleLabels.add(key);
      yield* cancelLabelRead;
      yield* requestRender(true);
    });

    const readLabels: (keys: ReadonlySet<string>) => Effect.Effect<void> =
      Effect.fnUntraced(function* (keys) {
        if (yield* Ref.get(stopped)) return;
        const read = { keys };
        yield* Ref.set(labelRead, read);
        yield* FiberHandle.run(labelReads)(
          Effect.gen(function* () {
            const exit = yield* Effect.exit(
              reads.reads.WorkLabels({ indexedKeys: [...keys] }),
            );
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                if ((yield* Ref.get(labelRead)) !== read) return;
                yield* Ref.set(labelRead, null);
                if (Exit.isSuccess(exit)) {
                  for (const key of keys) {
                    labels.set(key, heldLabel(exit.value.get(key)));
                    staleLabels.delete(key);
                  }
                } else {
                  yield* Effect.logWarning(
                    "Graph Work Label metadata unavailable; left native",
                  ).pipe(
                    Effect.annotateLogs({ keys: keys.size, cause: exit.cause }),
                  );
                  for (const key of keys) {
                    if (!labels.has(key)) labels.set(key, null);
                    staleLabels.delete(key);
                  }
                }
                if (!(yield* Ref.get(stopped))) yield* showLabels;
              }),
            );
          }).pipe(Effect.interruptible),
        );
      });

    const fillLabels: Effect.Effect<void> = Effect.gen(function* () {
      const needed = new Set<string>();
      const pending: {
        installation: GraphInstallation;
        keys: Map<string, string>;
      }[] = [];
      for (const { installation } of yield* installed) {
        const keys = new Map<string, string>();
        for (const [id, node] of Object.entries(installation.drawn)) {
          if (node.type === "tag" || node.type === "attachment") continue;
          let key = installation.additions.literatureNotes.has(id)
            ? (itemKeyFromFrontmatter(yield* metadata.cache(id)) ?? undefined)
            : undefined;
          const citekey = installation.additions.citedWorkNodes.get(id);
          if (citekey !== undefined) {
            const resolution = resolveCitekey(citekey);
            key =
              resolution?.kind === "unique"
                ? resolution.item.indexedKey
                : undefined;
          }
          if (key) {
            keys.set(id, key);
            needed.add(key);
          }
        }
        pending.push({ installation, keys });
      }
      for (const key of labels.keys()) {
        if (needed.has(key)) continue;
        labels.delete(key);
        staleLabels.delete(key);
      }
      const missing = new Set(
        [...needed].filter((key) => !labels.has(key) || staleLabels.has(key)),
      );
      const reading = (yield* Ref.get(labelRead))?.keys;
      if (
        missing.size > 0 &&
        !(reading && [...missing].every((key) => reading.has(key)))
      )
        yield* readLabels(missing);

      const inScope = new Set(
        (yield* libraryScope.current)?.available.map(
          (library) => library.libraryID,
        ),
      );
      for (const { installation, keys } of pending) {
        installation.labels.clear();
        for (const [id, key] of keys) {
          const held = labels.get(key);
          if (held && inScope.has(held.libraryID))
            installation.labels.set(id, held.label);
        }
      }
    });

    const showLabels: Effect.Effect<void> = Effect.gen(function* () {
      yield* fillLabels;
      for (const { installation } of yield* installed)
        installation.graphics.update(installation.labels);
    });

    const uninstall = Effect.fnUntraced(function* (
      installation: GraphInstallation,
    ) {
      if (installations.get(installation.members.renderer) !== installation)
        return;
      installation.restores.dispose();
      installations.delete(installation.members.renderer);
      if ((yield* Ref.updateAndGet(installationCount, (n) => n - 1)) === 0)
        releaseLookup();
      installation.drawn = {};
      installation.labels.clear();
      yield* fillLabels;
    });

    const hoverDeps = (): NodeHoverDeps => ({
      workspace: triggerWorkspace,
      metadataCache: { getCache: cacheOf },
      settings,
      citationPopover,
      bridge,
      open: (indexedKey, pane) => {
        bridge.runAndForget(citekeyEditor.openIndexedKey(indexedKey, pane));
      },
    });

    const replaceRows = (
      installation: GraphInstallation,
      saved: GraphOptions | null,
      wikilinks: boolean,
    ): void => {
      installation.rows[Symbol.dispose]();
      installation.rows = installFilterRows(installation.members.engine, {
        wikilinkCitations: wikilinks,
        saved,
      });
    };

    const savedOptions = (leaf: WorkspaceLeaf) =>
      Ref.get(savedLeaves).pipe(
        Effect.map(
          (saved) => deferredOptions.get(leaf) ?? saved.get(leaf.id) ?? null,
        ),
      );

    const attach = (
      members: GraphLeafMembers,
      { saved, view, wikilinks }: AttachOptions,
    ): GraphInstallation => {
      const { engine, renderer } = members;
      const installation: GraphInstallation = {
        members,
        restores: new DisposableStack(),
        rows: installFilterRows(engine, {
          wikilinkCitations: wikilinks,
          saved,
        }),
        additions: NO_ADDITIONS,
        drawn: {},
        labels: new Map(),
        graphics: new WorkLabelGraphics(members),
      };
      const { restores } = installation;
      restores.use(installGraphViewState(view, engine));
      restores.defer(
        around(engine, {
          render: (native) => () => {
            installation.additions = run(additionsOf(engine));
            return renderWithFacade(engine, native, installation.additions);
          },
        }),
      );
      restores.defer(() => installation.rows[Symbol.dispose]());
      restores.use(installGroupsButton(engine, nodeColors));
      restores.use(installDisplayRows(engine, { saved }));
      restores.use(installation.graphics);
      restores.use(
        installNodeColors(
          renderer,
          {
            get additions() {
              return installation.additions;
            },
            handedOff: (data) => {
              const shown = rowFlag(engine, AUTHOR_TITLE_LABELS, false);
              const drawn = shown ? data.nodes : {};
              const previous = installation.drawn;
              installation.drawn = drawn;
              installation.graphics.update(
                shown ? installation.labels : new Map(),
              );
              if (
                Object.keys(previous).length !== Object.keys(drawn).length ||
                Object.keys(drawn).some(
                  (id) => previous[id]?.type !== drawn[id]?.type,
                )
              )
                run(requestRender(false));
            },
          },
          nodeColors,
        ),
      );
      restores.use(
        installLinkColors(members, installation, {
          color: linkColor,
          enabled: () => colorCitationLinks(engine),
        }),
      );
      const nodeDeps: NodeRightClickDeps = {
        citekeyOf: (id) => installation.additions.citedWorkNodes.get(id),
        resolveCitekey,
        open,
        workspace: triggerWorkspace,
        showInLibrary: (indexedKey) =>
          bridge.runAndForget(showInLibrary.show(indexedKey)),
      };
      restores.use(wrapNodeClick(renderer, nodeDeps));
      restores.use(wrapNodeRightClick(renderer, nodeDeps));
      restores.use(
        wrapNodeHover(members, hoverDeps(), () => installation.additions),
      );
      restores.use(releasedOnDispose(view, () => run(uninstall(installation))));
      return installation;
    };

    const install = Effect.fnUntraced(function* (
      leaf: WorkspaceLeaf,
      members: GraphLeafMembers,
      { saved, view = leaf.view }: { saved: GraphOptions | null; view?: View },
    ) {
      const { engine, renderer, viewType } = members;
      lookup ??= yield* citationLookup.observe(() => {
        bridge.runAndForget(invalidateLabels);
      });
      const wikilinks = yield* Ref.get(wikilinkCitations);
      const installation = attach(members, { saved, view, wikilinks });
      installations.set(renderer, installation);
      yield* Ref.update(installationCount, (n) => n + 1);
      if (saved) engine.setOptions?.(saved);
      yield* Ref.update(savedLeaves, (held) => {
        const next = new Map(held);
        next.delete(leaf.id);
        return next;
      });
      deferredOptions.delete(leaf);
      yield* Effect.logDebug("Graph citations installed").pipe(
        Effect.annotateLogs({ viewType }),
      );
    });

    const refresh = Effect.gen(function* () {
      if (!(yield* active)) return;
      if (!(yield* env.corePluginEnabled(GRAPH_CORE_PLUGIN_ID))) {
        yield* Effect.logDebug(
          "Graph core plugin disabled; nothing to install",
        );
        return;
      }
      for (const leaf of yield* graphLeaves) {
        if (leaf.isDeferred) {
          const saved = deferredLeafOptions(leaf);
          if (saved) deferredOptions.set(leaf, saved);
          yield* Effect.logTrace(
            "Graph leaf deferred; install waits for its load",
          ).pipe(Effect.annotateLogs({ viewType: leaf.view.getViewType() }));
          continue;
        }
        if (leftNative.has(leaf.view)) continue;
        const { renderer } = leaf.view as GraphView;
        if (renderer && installations.has(renderer)) continue;
        const members = graphMembersOf(leaf);
        if (!members) {
          leftNative.add(leaf.view);
          continue;
        }
        yield* install(leaf, members, { saved: yield* savedOptions(leaf) });
        yield* render(members);
      }
    });

    const rebuildRows = Effect.gen(function* () {
      const wikilinks = yield* Ref.get(wikilinkCitations);
      for (const { leaf, installation } of yield* installed) {
        replaceRows(installation, yield* savedOptions(leaf), wikilinks);
        yield* render(installation.members);
      }
      yield* Effect.logDebug("Graph rows rebuilt").pipe(
        Effect.annotateLogs({
          wikilinkCitations: yield* Ref.get(wikilinkCitations),
        }),
      );
    });

    const uninstallAll = Effect.gen(function* () {
      for (const { installation } of yield* installed) {
        const { members } = installation;
        yield* uninstall(installation);
        yield* render(members);
        yield* Effect.logDebug("Graph citations restored").pipe(
          Effect.annotateLogs({ viewType: members.viewType }),
        );
      }
    });

    const applySettings = Effect.fnUntraced(function* (
      next: Readonly<Settings>,
    ) {
      const nextEnabled = next["citation.graph-citations"];
      const nextWikilinks = next["citation.wikilink-citations"];
      const rowsChanged =
        (yield* Ref.getAndSet(wikilinkCitations, nextWikilinks)) !==
        nextWikilinks;
      if (nextEnabled === (yield* Ref.get(enabled))) {
        if (nextEnabled && rowsChanged) yield* rebuildRows;
        return;
      }
      yield* Ref.set(enabled, nextEnabled);
      yield* Effect.logDebug("Graph citations toggled").pipe(
        Effect.annotateLogs({ enabled: nextEnabled }),
      );
      yield* nextEnabled ? refresh : uninstallAll;
    });

    yield* Effect.addFinalizer(() => Effect.sync(releaseLookup));
    const viewCreationHooked = yield* host.onViewCreated(
      GRAPH_VIEW_TYPES,
      (leaf, view) =>
        run(
          Effect.gen(function* () {
            if (!(yield* active)) return;
            const members = graphMembersOf({ view });
            if (members) yield* install(leaf, members, { saved: null, view });
          }),
        ),
    );
    if (!viewCreationHooked)
      yield* Effect.logWarning(
        "Graph view factory unavailable; new views install on layout change",
      ).pipe(
        Effect.annotateLogs({
          missing: ["viewRegistry.getViewCreatorByType"],
        }),
      );
    yield* forkEach(
      filterTag(
        workspace.changes,
        "layout-change",
        "active-leaf-change",
        "css-change",
      ),
      (event) =>
        event._tag === "css-change"
          ? Effect.gen(function* () {
              nodeColors.invalidate();
              linkColor.invalidate();
              yield* requestRender(true);
            })
          : refresh,
    );
    yield* forkEach(
      citationIndex.events.pipe(
        Stream.filter(
          (event) =>
            event.type === "changed" || event.type === "membership-changed",
        ),
      ),
      () => invalidateLabels,
    );
    yield* forkEach(
      citationIndex.changes.pipe(
        Stream.map((state) => state.backfilled),
        Stream.changes,
        Stream.filter((backfilled) => backfilled),
      ),
      () => invalidateLabels,
    );
    yield* forkEach(
      noteIndex.changes.pipe(
        Stream.filter(
          (change) => change.type === "changed" || change.type === "indexed",
        ),
      ),
      () => invalidateLabels,
    );
    yield* forkEach(readsChanged(reads), () => invalidateLabels);
    yield* forkEach(settings.changes, applySettings);
    yield* workspace.layoutReady.pipe(
      Effect.andThen(refresh),
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Ref.set(stopped, true);
        yield* FiberHandle.clear(renderTimer);
        yield* cancelLabelRead;
        yield* uninstallAll;
      }),
    );
    yield* Effect.logInfo("Graph citations ready").pipe(
      Effect.annotateLogs({ enabled: yield* Ref.get(enabled) }),
    );

    return GraphCitations.of({
      enabled: Ref.get(enabled).pipe(Effect.withSpan("GraphCitations.enabled")),
      applyPreset: Effect.fn("GraphCitations.applyPreset")(function* (leaf) {
        yield* refresh;
        applyCitationGraphPreset(leaf, {
          wikilinkCitations: yield* Ref.get(wikilinkCitations),
          color: nodeColors.literatureNoteGroupColor(),
        });
      }),
    });
  }).pipe(withLogCategory("graph-citations")),
);
