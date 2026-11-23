import type { Inlines } from "#core/pandoc/ast.ts";
import type { CitationPopoverBlock } from "#obsidian/citation-popover/blocks.ts";
import type { WorkHoverRequest } from "#obsidian/citation-popover/service.ts";
import type { HoverVisit } from "#obsidian/citation-popover/visits.ts";
import type { CitationHoverRequest } from "#obsidian/citekey-navigation/index.ts";
import type { ProfilePresentationFailure } from "#obsidian/pandoc/document-presentation.ts";
import type { BibliographyEntry } from "#obsidian/pandoc/engine.ts";
import type { RenderedReference } from "#obsidian/references/entries.ts";
import { Cause, Effect, Exit, Fiber, FiberHandle, Layer, Scope } from "effect";
import type { ReactNode } from "react";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import {
  Workspace,
  workspaceTrigger,
} from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { WorkspaceEventHost } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { requestProfileSwitch } from "@zotlit/obsidian-kit/profile-recovery.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import {
  bridgeLog,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { CitekeyResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import { createCitationPopoverActions } from "./actions.ts";
import { CitationPopoverContent } from "./content.tsx";

import {
  describeCandidatesEffect,
  describeJoinedCandidates,
} from "#obsidian/citation-index/ambiguity.ts";
import {
  CitationLookup,
  lookupChanged,
  lookupStatusChanged,
} from "#obsidian/citation-index/lookup-service.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";
import { readReferenceSources } from "#obsidian/citation-index/service.ts";
import { citationPopoverBlocks } from "#obsidian/citation-popover/blocks.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { HoverVisits } from "#obsidian/citation-popover/visits.ts";
import { shownCitationContent } from "#obsidian/citation-text/present.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import {
  documentCitationPresentation,
  documentPresentation,
  profileReaderOf,
} from "#obsidian/pandoc/document-presentation.ts";
import { noteContent } from "#obsidian/pandoc/inline-content.tsx";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import {
  BibliographyRender,
  renderInvalidated,
} from "#obsidian/pandoc/render-cache.ts";
import { buildReferenceEntries } from "#obsidian/references/entries.ts";

type PopoverServices =
  | Vault
  | MetadataCache
  | ZoteroReads
  | CitationLookup
  | CitationIndex
  | LibraryScope
  | CitationText
  | BibliographyRender
  | ProfileStyles;

interface PopoverEdges {
  host: WorkspaceEventHost;
  runAction<A, E>(effect: Effect.Effect<A, E>): Promise<A | null>;
  showInLibrary: (indexedKey: string) => void;
  showNotice: (message: string) => void;
  log: (
    level: "debug" | "warn",
    message: string,
    fields: Record<string, unknown>,
  ) => void;
}

type PopoverRequest = CitationHoverRequest | WorkHoverRequest;

interface CitationVisitState {
  content: ReactNode;
  lead: ReactNode;
  painted: ReactNode;
}

type PopoverVisit = HoverVisit<CitationVisitState>;

interface PopoverRead {
  blocks: CitationPopoverBlock[];
  note: Inlines | undefined;
  profileFailure: ProfilePresentationFailure | undefined;
  pending: boolean;
  indexedKey?: string;
  unavailable?: "database" | "item";
}

export const layerCitationPopover: Layer.Layer<
  CitationPopover,
  never,
  | Vault
  | Workspace
  | MetadataCache
  | ZoteroReads
  | CitationLookup
  | CitationIndex
  | LibraryScope
  | CitationText
  | BibliographyRender
  | ProfileStyles
  | ShowInLibrary
  | Notifier
> = Layer.effect(
  CitationPopover,
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const lookup = yield* CitationLookup;
    const render = yield* BibliographyRender;
    const showInLibrary = yield* ShowInLibrary;
    const notifier = yield* Notifier;
    const bridge = yield* scopedBridge;
    const layerScope = yield* Effect.scope;
    const context = yield* Effect.context<PopoverServices>();
    const visits = new HoverVisits<CitationVisitState>(() => ({
      content: null,
      lead: null,
      painted: null,
    }));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        visits.hideAll();
      }),
    );

    const logs = bridgeLog(bridge, "citation-popover");
    const host: WorkspaceEventHost = {
      workspace: workspaceTrigger(workspace, bridge.runSync),
    };
    const log: PopoverEdges["log"] = (level, message, fields) =>
      logs[level](message, fields);

    const showVisit = Effect.fn("CitationPopover.showVisit")(function* (
      request: PopoverRequest,
    ) {
      if (bridge.closed()) return undefined;
      const currentVisit = visits.open(request.hoverParent, request.targetEl);
      const { popover, subscriptions } = currentVisit;
      if ("work" in request && request.lead) {
        request.lead({
          owner: popover,
          subscriptions,
          draw: (content) => {
            currentVisit.state.lead = content;
            return paint(currentVisit, currentVisit.state.painted);
          },
        });
      }
      const scope = yield* Scope.fork(layerScope);
      subscriptions.defer(() =>
        bridge.runAndForget(Scope.close(scope, Exit.void)),
      );
      const reading = yield* FiberHandle.make<void, never>().pipe(
        Scope.provide(scope),
      );
      const edges: PopoverEdges = {
        host,
        log,
        showInLibrary: (indexedKey) =>
          bridge.runAndForget(showInLibrary.show(indexedKey)),
        showNotice: (message) => bridge.runAndForget(notifier.show(message)),
        runAction: (effect) =>
          bridge.runPromise(
            Effect.forkIn(effect, scope).pipe(
              Effect.flatMap((fiber) => Fiber.await(fiber)),
              Effect.flatMap((exit) =>
                Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                  ? Effect.succeed(null)
                  : exit,
              ),
            ),
          ),
      };
      const read = FiberHandle.run(
        reading,
        fill(edges, currentVisit, request).pipe(
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError(
                  "Cannot show the entries of a hovered citation",
                ).pipe(Effect.annotateLogs({ error: Cause.squash(cause) })),
          ),
          Effect.provideContext(context),
          withLogCategory("citation-popover"),
        ),
      );
      const draw = (): void => {
        bridge.runSync(read);
      };
      subscriptions.defer(bridge.subscribe(renderInvalidated(render), draw));
      if (!("work" in request) || request.work.kind !== "item") {
        subscriptions.defer(bridge.subscribe(lookupChanged(lookup), draw));
        let freshness = (yield* lookup.current).status;
        subscriptions.defer(
          bridge.subscribe(lookupStatusChanged(lookup), () => {
            const previous = freshness;
            freshness = bridge.runSync(lookup.current).status;
            if (freshness === "failed") showFailure(currentVisit);
            else if (freshness === "fresh" && previous === "failed") draw();
          }),
        );
      }
      if (!("work" in request)) {
        subscriptions.defer(
          bridge.subscribe(
            filterTag(metadata.changes, "deleted"),
            ({ file }) => {
              if (file.path === request.sourcePath) popover.hide();
            },
          ),
        );
        subscriptions.defer(
          bridge.subscribe(
            filterTag(metadata.changes, "changed"),
            ({ file }) => {
              if (file.path === request.sourcePath) draw();
            },
          ),
        );
      }
      return yield* read;
    });

    return CitationPopover.of({
      show: Effect.fn("CitationPopover.show")(function* (request) {
        yield* showVisit(request);
      }),
      showWork: Effect.fn("CitationPopover.showWork")(function* (request) {
        const first = yield* showVisit(request);
        if (!first) return;
        const exit = yield* Fiber.await(first);
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
          return yield* Effect.failCause(exit.cause);
      }),
      hide: Effect.fn("CitationPopover.hide")((parent, targetEl) =>
        Effect.sync(() => visits.hide(parent, targetEl)),
      ),
    });
  }).pipe(withLogCategory("citation-popover")),
);

function failureOf(cause: Cause.Cause<unknown>): unknown {
  const error = Cause.squash(cause);
  return Cause.isUnknownError(error) ? error.cause : error;
}

const fill = Effect.fn("CitationPopover.fill")(function* (
  edges: PopoverEdges,
  visit: PopoverVisit,
  request: PopoverRequest,
): Effect.fn.Return<void, never, PopoverServices> {
  const { popover } = visit;
  const reads = yield* ZoteroReads;
  const read = yield* (
    "work" in request ? readWork(request) : readBlocks(request)
  ).pipe(
    recover(
      (cause) =>
        Effect.logWarning("Cannot read the entries of a hovered citation").pipe(
          Effect.annotateLogs({
            path: "sourcePath" in request ? request.sourcePath : undefined,
            error: failureOf(cause),
          }),
          Effect.andThen(Effect.sync(() => showFailure(visit))),
        ),
      Effect.succeed(null),
    ),
  );
  if (read === null) return;
  if (read.unavailable === "database" && visit.state.content) {
    showFailure(visit);
    return;
  }
  const { blocks, note, profileFailure, pending, unavailable } = read;
  if (blocks.length === 0 && !unavailable) {
    if ("work" in request && request.lead) paint(visit, null);
    else popover.hide();
    return;
  }
  const actions = createCitationPopoverActions({
    host: edges.host,
    open: (block, pane) => {
      if ("work" in request) {
        if (read.indexedKey) request.open(read.indexedKey, pane);
      } else if (block.citekey !== null) {
        request.open(block.citekey, pane);
      }
    },
    prepare:
      "work" in request && read.indexedKey
        ? async (block) => {
            const join = await edges.runAction(
              readReferenceSources(reads, [
                { indexedKey: read.indexedKey!, linkpath: null },
              ]),
            );
            if (join === null) return null;
            const { sources, database } = join;
            const source = sources.get(read.indexedKey!);
            if (database === "unreadable" || !source) {
              paint(
                visit,
                <CitationPopoverContent
                  blocks={[]}
                  actions={actions}
                  unavailable={database === "unreadable" ? "database" : "item"}
                />,
              );
              return null;
            }
            return {
              ...block,
              itemKey: source.itemKey,
              groupID: source.groupID,
              attachments: source.attachments,
            };
          }
        : undefined,
    onAttachmentsEmpty: (displayed, current) => {
      paintContent(
        blocks.map((block) => (block === displayed ? current : block)),
      );
    },
    hide: () => popover.hide(),
    showInLibrary: edges.showInLibrary,
    showNotice: edges.showNotice,
    switchProfile: (path) => requestProfileSwitch(edges.host, path),
    log: edges.log,
  });
  const paintContent = (currentBlocks: readonly CitationPopoverBlock[]) => {
    visit.state.content = (
      <CitationPopoverContent
        blocks={currentBlocks}
        note={note}
        profileFailure={profileFailure}
        actions={actions}
        pending={pending}
        unavailable={unavailable}
      />
    );
    return paint(visit, visit.state.content);
  };
  const shown = paintContent(blocks);
  yield* Effect.logDebug("Citation popover entries read").pipe(
    Effect.annotateLogs({
      path: "sourcePath" in request ? request.sourcePath : undefined,
      blocks: blocks.length,
      note: note !== undefined && note.length > 0,
      shown,
    }),
  );
});

const readWork = Effect.fn("CitationPopover.readWork")(function* (
  request: WorkHoverRequest,
): Effect.fn.Return<PopoverRead, unknown, PopoverServices> {
  const reads = yield* ZoteroReads;
  const lookup = yield* CitationLookup;
  const libraries = yield* LibraryScope;
  const render = yield* BibliographyRender;
  const work = request.work;
  const empty: PopoverRead = {
    blocks: [],
    note: undefined,
    profileFailure: undefined,
    pending: false,
  };
  if ((yield* reads.current).state === "degraded")
    return { ...empty, unavailable: "database" };
  if (work.kind === "citekey" && (yield* lookup.current).status === "pending") {
    return {
      ...empty,
      pending: true,
      blocks: [{ kind: "unresolved", citekey: work.citekey }],
    };
  }
  let indexedKey: string;
  if (work.kind === "annotation") {
    const answer = yield* lookup
      .read({ annotationKeys: [work.annotationKey] })
      .pipe(recover(() => Effect.void, Effect.succeed(null)));
    if (answer === null) return { ...empty, unavailable: "database" };
    const parent = answer.parentOfAnnotation(work.annotationKey);
    if (parent === null) return empty;
    indexedKey = parent.indexedKey;
  } else if (work.kind === "citekey") {
    const answer = yield* lookup
      .read({ citekeys: [work.citekey], indexedKeys: [], annotationKeys: [] })
      .pipe(recover(() => Effect.void, Effect.succeed(null)));
    if (answer === null) return { ...empty, unavailable: "database" };
    const resolution: CitekeyResolution = answer.resolve(work.citekey);
    if (resolution.kind !== "unique") {
      return {
        ...empty,
        blocks: [
          resolution.kind === "ambiguous"
            ? {
                kind: "ambiguous",
                citekey: work.citekey,
                candidates: yield* describeCandidatesEffect(
                  {
                    db: reads,
                    libraryScope: {
                      current: yield* libraries.current,
                    },
                  },
                  resolution.candidates,
                ),
              }
            : { kind: "unresolved", citekey: work.citekey },
        ],
      };
    }
    indexedKey = resolution.item.indexedKey;
  } else {
    indexedKey = work.indexedKey;
  }
  const { sources, database } = yield* readReferenceSources(reads, [
    { indexedKey, linkpath: null },
  ]);
  if (database === "unreadable") return { ...empty, unavailable: "database" };
  const source = sources.get(indexedKey);
  if (!source && work.kind === "annotation") return empty;
  if (!source) return { ...empty, unavailable: "item" };
  const bibliography = yield* render
    .readBibliography([source.csl])
    .pipe(
      recover(
        (cause) =>
          Effect.logWarning("Cannot format source-less Item").pipe(
            Effect.annotateLogs({ indexedKey, error: Cause.squash(cause) }),
          ),
        Effect.succeed(null),
      ),
    );
  const entry = bibliography?.entries.find(
    (entry) => entry.id === String(source.csl.id),
  );
  return {
    ...empty,
    indexedKey,
    blocks: [
      {
        kind: "entry",
        citekey: source.citekey,
        marker: undefined,
        serial: undefined,
        content: entry?.content.length ? entry.content : null,
        summary: source.summary,
        itemKey: source.itemKey,
        groupID: source.groupID,
        attachments: source.attachments,
      },
    ],
  };
});

const readBlocks = Effect.fn("CitationPopover.readBlocks")(function* (
  request: CitationHoverRequest,
): Effect.fn.Return<PopoverRead, unknown, PopoverServices> {
  const vault = yield* Vault;
  const metadata = yield* MetadataCache;
  const index = yield* CitationIndex;
  const lookupService = yield* CitationLookup;
  const render = yield* BibliographyRender;
  const text = yield* CitationText;
  const libraryScope = yield* LibraryScope;
  const profiles = yield* ProfileStyles;
  const file = yield* vault.getFileByPath(request.sourcePath);
  if (!file) {
    yield* Effect.logDebug("Hovered citation sits in no note").pipe(
      Effect.annotateLogs({ path: request.sourcePath }),
    );
    return {
      blocks: [],
      note: undefined,
      profileFailure: undefined,
      pending: false,
    };
  }
  const citekeys = request.works.map(({ citekey }) => citekey);
  const { citations, lookup, sources } = yield* index.getDocumentCitationSet(
    file,
    { include: { citekeys } },
  );
  const pending = (yield* lookupService.current).status === "pending";
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  const presented = documentCitationPresentation(
    documentPresentation(
      { getFileCache: (target) => run(metadata.fileCache(target)) },
      file,
      profileReaderOf(profiles, run),
    ),
    (yield* render.state).vaultPresentation,
    { citations, works: sources },
  );
  const outcome =
    presented.kind === "unusable"
      ? null
      : yield* render.render(presented.items, presented.presentation);
  const entries = buildReferenceEntries(citations, {
    bibliography:
      outcome?.kind === "held"
        ? {
            entries: renderedEntries(outcome.record.value.entries),
            complete: true,
          }
        : undefined,
  });
  const documentText = yield* text.read(file.path);
  const libraries = new Map(
    ((yield* libraryScope.current)?.available ?? []).map((library) => [
      library.libraryID,
      library,
    ]),
  );
  const ambiguous = (citekey: string) => {
    const resolution = lookup.resolve(citekey);
    return resolution.kind === "ambiguous"
      ? describeJoinedCandidates(resolution.candidates, sources, libraries)
      : null;
  };
  const formatted =
    request.shown && documentText
      ? shownCitationContent(request.shown, documentText)
      : undefined;
  return {
    blocks: citationPopoverBlocks(request.works, entries, {
      serials: documentText?.entrySerials ?? false,
      ambiguous,
    }),
    note: formatted ? noteContent(formatted.text.content) : undefined,
    profileFailure:
      presented.kind === "unusable" && presented.property === "profile"
        ? presented
        : undefined,
    pending,
  };
});

function renderedEntries(
  entries: readonly BibliographyEntry[],
): Map<string, RenderedReference> {
  return new Map(
    entries.map(({ id, marker, content }) => [id, { marker, content }]),
  );
}

function paint(visit: PopoverVisit, reference: ReactNode): boolean {
  visit.state.painted = reference;
  const { lead } = visit.state;
  return visit.popover.render(
    lead === null ? (
      reference
    ) : (
      <>
        {lead}
        {reference}
      </>
    ),
  );
}

function showFailure(visit: PopoverVisit): void {
  paint(
    visit,
    <>
      <div role="status" data-citation-lookup-status="failed">
        {m.citation_popover_database_unavailable()}
      </div>
      {visit.state.content}
    </>,
  );
}
