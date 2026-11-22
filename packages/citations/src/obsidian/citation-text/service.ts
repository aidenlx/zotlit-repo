import type { NoteScanRecord } from "#core/citation-index/scan-note.ts";
import type { OpenDocuments } from "#core/citation-text/open-documents.ts";
import type {
  Citation,
  CitationOccurrence,
  DocumentCitationSet,
} from "#obsidian/citation-index/service.ts";
import type { RenderPresentation } from "#obsidian/pandoc/render-cache.ts";
import { QueryObserver } from "@tanstack/query-core";
import {
  Cause,
  Context,
  Duration,
  Effect,
  Layer,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { TFile } from "obsidian";

import type { CslItemData } from "@zotlit/db";
import { obsidianEvents } from "@zotlit/obsidian-kit/effect-obsidian-events.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { FIELD_ZOTERO_NOTE_KEY } from "@zotlit/plugin-kernel/constants.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag, forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { FileNotFound } from "@zotlit/plugin-kernel/vault-errors.ts";
import {
  citationOfRun,
  citationRuns,
  wikilinkCitation,
} from "@zotlit/plugin-kernel/wikilink-citation.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import {
  formatPandocCitation,
  scanPandocCitations,
} from "@zotlit/templates/pandoc-citation";
import type { ScannedPandocCitation } from "@zotlit/templates/pandoc-citation";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import { citationKey, presentedCitationEqual } from "./present.ts";
import type {
  CitationSource,
  DocumentCitations,
  FormattedOccurrence,
} from "./present.ts";

import { mapsEqual } from "#core/citation-text/maps-equal.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { renderParsedCitation } from "#obsidian/citation-index/parsed-note.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";
import {
  documentCitationPresentation,
  documentPresentation,
} from "#obsidian/pandoc/document-presentation.ts";
import { holdsNote } from "#obsidian/pandoc/inline-content.tsx";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import { BibliographyRender } from "#obsidian/pandoc/render-cache.ts";

export { type DocumentCitations } from "./present.ts";

const CITATION_TEXT = "citation-text";

const TEXT_GC_TIME = Duration.toMillis(Duration.minutes(5));

const NO_SERIALS: readonly undefined[] = [];

export type CitationTextEvent =
  | { readonly type: "changed"; readonly path: string }
  | {
      readonly type: "settled";
      readonly path: string;
      readonly held: Held<DocumentCitations> | null;
    }
  | { readonly type: "invalidated" };

export interface CitationTextState {
  readonly startup: "ready" | "failed";
  readonly stopped: boolean;
}

export class CitationText extends Context.Service<
  CitationText,
  {
    readonly current: Effect.Effect<CitationTextState>;
    readonly changes: Stream.Stream<CitationTextState>;
    readonly events: Stream.Stream<CitationTextEvent>;
    peek(path: string): Effect.Effect<Held<DocumentCitations> | null>;
    read(path: string): Effect.Effect<DocumentCitations | null>;
  }
>()("zotlit/citation-text/CitationText") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    CitationText: CitationText;
  }
}

export const layerCitationText = (open?: OpenDocuments) =>
  Layer.effect(
    CitationText,
    Effect.gen(function* () {
      const metadata = yield* MetadataCache;
      const vault = yield* Vault;
      const workspace = yield* Workspace;
      const index = yield* CitationIndex;
      const lookup = yield* CitationLookup;
      const notes = yield* NoteIndex;
      const renders = yield* BibliographyRender;
      const profiles = yield* ProfileStyles;
      const queries = yield* QueryClients;
      const scope = yield* Scope.fork(yield* Scope.Scope);
      const bridge = yield* scopedBridge.pipe(Scope.provide(scope));
      const fileAt = (path: string) => vault.getFileByPath(path);
      const openPaths = Effect.suspend(() =>
        open
          ? Effect.sync(() => open.paths())
          : Effect.map(
              workspace.markdownViews,
              (views) =>
                new Set(views.flatMap(({ file }) => (file ? [file.path] : []))),
            ),
      );
      const pins = new Map<string, () => void>();
      let stopped = false;
      const state = yield* SubscriptionRef.make<CitationTextState>({
        startup: "ready",
        stopped: false,
      });
      const bus = yield* Effect.acquireRelease(
        PubSub.unbounded<CitationTextEvent>(),
        (pubsub) => PubSub.shutdown(pubsub),
      ).pipe(Scope.provide(scope));
      const emit = (event: CitationTextEvent) => {
        if (!stopped) PubSub.publishUnsafe(bus, event);
      };
      const log = (
        level: "debug" | "warn",
        message: string,
        fields: Record<string, unknown> = {},
      ) =>
        (level === "debug"
          ? Effect.logDebug(message)
          : Effect.logWarning(message)
        ).pipe(Effect.annotateLogs(fields), withLogCategory("citation-text"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stopped = true;
        }).pipe(
          Effect.andThen(
            Effect.sync(() =>
              queries.client.removeQueries({ queryKey: [CITATION_TEXT] }),
            ),
          ),
          Effect.andThen(
            SubscriptionRef.update(state, (value) => ({
              ...value,
              stopped: true,
            })),
          ),
        ),
      );

      const peek = Effect.fn("CitationText.peek")(function* (path: string) {
        if (stopped) return null;
        if ((yield* fileAt(path)) === null) {
          drop(path);
          return null;
        }
        yield* Effect.forkIn(
          queries.ask(documentKey(path), ({ signal }) =>
            bridge.runPromise(readPath(path), { signal }),
          ),
          scope,
          { startImmediately: true },
        );
        return yield* queries.peek<DocumentCitations>(documentKey(path));
      });

      const read = Effect.fn("CitationText.read")(function* (path: string) {
        if (stopped) return null;
        const text = yield* queries.read(documentKey(path), ({ signal }) =>
          bridge.runPromise(readPath(path), { signal }),
        );
        if (stopped) return null;
        if ((yield* fileAt(path)) !== null) return text;
        drop(path);
        return null;
      });

      const invalidate = Effect.fn("CitationText.invalidate")(function* (
        path?: string,
      ) {
        if (stopped) return;
        const queryKey =
          path === undefined ? [CITATION_TEXT] : documentKey(path);
        if (
          path !== undefined &&
          queries.client.getQueryState(queryKey) === undefined
        ) {
          return;
        }
        yield* queries.invalidate(queryKey);
        if (path === undefined) emit({ type: "invalidated" });
        else emit({ type: "changed", path });
      });

      function drop(path: string): void {
        pins.get(path)?.();
        pins.delete(path);
        queries.client.removeQueries({ queryKey: documentKey(path) });
      }

      const pinOpenDocuments = Effect.fn("CitationText.pinOpenDocuments")(
        function* () {
          if (stopped) return;
          const open = yield* openPaths;
          for (const [path, release] of pins) {
            if (open.has(path)) continue;
            release();
            pins.delete(path);
          }
          for (const path of open) {
            if (pins.has(path)) continue;
            const observer = new QueryObserver(queries.client, {
              queryKey: documentKey(path),
              enabled: false,
            });
            const unsubscribe = observer.subscribe(() => undefined);
            pins.set(path, () => {
              unsubscribe();
              observer.destroy();
            });
          }
        },
      );

      const readPath = Effect.fn("CitationText.readPath")(function* (
        path: string,
      ) {
        const file = yield* fileAt(path);
        if (file === null)
          return yield* new FileNotFound({ path, cause: undefined });
        return yield* readDocument(file).pipe(
          Effect.tapError((error) =>
            log("warn", "Cannot read the citations of a document", {
              path,
              error,
            }),
          ),
        );
      });

      const readDocument = Effect.fn("CitationText.readDocument")(function* (
        file: TFile,
      ) {
        yield* notes.whenIndexed;
        const { facts, set } = yield* index.getParsedDocument(file);
        const { source: body, record } = facts;
        const wikilinks = yield* wikilinkCitations(file, body, set);
        const literal = worksByCitekey(set.citations);
        if (set.database === "unreadable")
          return yield* new DbUnavailable({
            message: "The Zotero database cannot be read",
          });
        const works = new Map(
          set.citations.flatMap(({ indexedKey }) => {
            const source =
              indexedKey === null ? undefined : set.sources.get(indexedKey);
            return source && indexedKey !== null
              ? [
                  [
                    indexedKey,
                    { csl: source.csl, summary: source.citationSummary },
                  ] as const,
                ]
              : [];
          }),
        );

        const placed = [
          ...literalCitations({
            body,
            scanned: record.citations,
            occurrences: set.occurrences,
            works: literal,
          }),
          ...wikilinks,
        ];
        const citations = placed.flatMap((citation) => {
          const context = renderContextCitation(citation, works);
          return context === null ? [] : [context];
        });
        for (const { indexedKey, occurrences } of set.citations) {
          if (indexedKey === null || !works.has(indexedKey)) continue;
          for (const occurrence of occurrences) {
            if (occurrence.kind !== "annotation") continue;
            citations.push({
              identity: body.slice(
                occurrence.position.start.offset,
                occurrence.position.end.offset,
              ),
              start: occurrence.position.start.offset,
              renderSource: formatPandocCitation([
                {
                  citationKey: indexedKey,
                  prefix: null,
                  suffix: null,
                  suppressAuthor: false,
                  locator:
                    occurrence.pageLabel == null
                      ? null
                      : { label: "p.", value: occurrence.pageLabel },
                },
              ]),
              complete: true,
            });
          }
        }
        citations.sort((a, b) => a.start - b.start);
        const sources = citations.map(({ renderSource }) => renderSource);
        const items = [...works].map(([indexedKey, { csl }]) => ({
          ...csl,
          id: indexedKey,
        }));

        const cache = yield* metadata.fileCache(file);
        const loaded = yield* profiles.loaded;
        const resolved =
          loaded && cache?.frontmatter?.[FIELD_ZOTERO_NOTE_KEY] !== undefined
            ? yield* profiles.profileOf(file)
            : null;
        const presented = documentCitationPresentation(
          documentPresentation({ getFileCache: () => cache }, file, {
            loaded,
            profileOf: () => resolved!,
          }),
          (yield* renders.state).vaultPresentation,
          { citations: set.citations, works },
        );
        const presentation =
          presented.kind === "read" ? presented.presentation : null;
        const rendered =
          presentation === null
            ? null
            : yield* renders.readCitations(sources, items, { presentation });
        const entrySerials =
          rendered?.some(({ content }) => holdsNote(content)) ?? false;
        const serials =
          presented.kind === "read" && entrySerials
            ? yield* readSerials(presented.items, works, {
                presentation: presented.presentation,
              })
            : null;

        const formatted = new Map<string, FormattedOccurrence[]>();
        if (rendered?.length === citations.length) {
          rendered.forEach((text, index) => {
            const { identity, start, complete } = citations[index]!;
            if (!complete) return;
            const occurrence: FormattedOccurrence = {
              start,
              text,
              serials:
                serials === null
                  ? NO_SERIALS
                  : text.citations.map(({ id }) => serials.get(id)),
            };
            const occurrences = formatted.get(identity);
            if (occurrences === undefined)
              formatted.set(identity, [occurrence]);
            else occurrences.push(occurrence);
          });
        }
        yield* log("debug", "Document citations read", {
          path: file.path,
          citations: sources.length,
          wikilinks: wikilinks.length,
          items: items.length,
          entrySerials,
          formatted: [...formatted.values()].reduce(
            (count, occurrences) => count + occurrences.length,
            0,
          ),
        });
        return {
          ...(presented.kind === "unusable" && presented.property === "profile"
            ? { presentationFailure: presented }
            : {}),
          formatted,
          entrySerials,
          summaries: new Map(
            [...works].map(([indexedKey, { summary }]) => [
              indexedKey,
              summary,
            ]),
          ),
          literalWorks: literal,
          lookup: set.lookup,
        };
      });

      const readSerials = Effect.fn("CitationText.readSerials")(function* (
        items: readonly CslItemData[],
        works: ReadonlyMap<string, CitedItem>,
        { presentation }: { presentation: RenderPresentation },
      ) {
        const serials = new Map<string, number>();
        const rendered = yield* renders.readBibliography(items, {
          presentation,
        });
        if (rendered === null) {
          yield* log("debug", "Cannot number the cited entries");
          return serials;
        }
        const places = new Map(
          rendered.entries.map(({ id }, index) => [id, index + 1]),
        );
        for (const [indexedKey, { csl }] of works) {
          const serial = places.get(csl.id);
          if (serial !== undefined) serials.set(indexedKey, serial);
        }
        return serials;
      });

      const wikilinkCitations = Effect.fn("CitationText.wikilinkCitations")(
        function* (
          file: TFile,
          body: string,
          { occurrences, lookup, citations: grouped }: DocumentCitationSet,
        ) {
          const notes = new Map<
            string,
            { path: string; indexedKey: string; citationKey: string | null }
          >();
          for (const citation of grouped) {
            if (citation.indexedKey === null) continue;
            for (const occurrence of citation.occurrences) {
              if (occurrence.kind !== "wikilink") continue;
              const note = yield* metadata.firstLinkpathDest(
                occurrence.raw,
                file.path,
              );
              if (note)
                notes.set(occurrence.raw, {
                  path: note.path,
                  indexedKey: citation.indexedKey,
                  citationKey: lookup.citekeyOf(citation.indexedKey),
                });
            }
          }
          const context = {
            literatureNote: (linkpath: string) => notes.get(linkpath) ?? null,
            enabled: true,
          };

          const runs = citationRuns(
            occurrences.filter((occurrence) => occurrence.kind === "wikilink"),
            ({ raw, fragment }) =>
              wikilinkCitation(
                fragment === undefined ? raw : `${raw}#cite:${fragment}`,
                context,
              ),
            (previous, next) =>
              body.slice(
                previous.position.end.offset,
                next.position.start.offset,
              ),
          );

          const citations: PlacedCitation[] = [];
          for (const run of runs) {
            const citation = citationOfRun(run);
            citations.push({
              start: run[0]!.source.position.start.offset,
              ...citation,
              parsed: scanPandocCitations(citation.source)[0]!,
              identity: citationKey(citation),
            });
          }
          return citations;
        },
      );
      yield* Effect.gen(function* () {
        queries.client.setQueryDefaults([CITATION_TEXT], {
          gcTime: TEXT_GC_TIME,
          structuralSharing: (held, next) =>
            held !== undefined &&
            documentCitationsEqual(
              held as DocumentCitations,
              next as DocumentCitations,
            )
              ? held
              : next,
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const release of pins.values()) release();
            pins.clear();
          }),
        );
        const intake = yield* obsidianEvents<{ open: [] }>();
        yield* intake
          .consume(() => pinOpenDocuments())
          .pipe(Effect.forkScoped({ startImmediately: true }));
        yield* forkEach(metadata.changes, (event) => {
          if (event._tag === "changed") return invalidate(event.file.path);
          else if (event._tag === "deleted") drop(event.file.path);
        });
        const reopen = intake.callback("open");
        if (open) {
          yield* Effect.acquireDisposable(
            Effect.sync(() => open.subscribe(reopen)),
          );
        } else {
          yield* forkEach(
            filterTag(workspace.changes, "layout-change", "file-open"),
            () => reopen(),
          );
          yield* forkEach(filterTag(vault.changes, "rename"), () => reopen());
        }
        yield* forkEach(queries.changes, (change) => {
          if (change.key[0] !== CITATION_TEXT) return;
          const path = pathOf(change.key);
          if (change.changed) emit({ type: "changed", path });
          emit({
            type: "settled",
            path,
            held: change.held as Held<DocumentCitations> | null,
          });
        });
        yield* forkEach(index.events, (event) => {
          if (event.type === "membership-changed") return invalidate();
          else if (event.type === "changed") return invalidate(event.path);
        });
        yield* forkEach(notes.changes, (event) => {
          if (event.type === "changed" || event.type === "indexed")
            return invalidate();
        });
        let revision = (yield* lookup.current).revision;
        yield* forkEach(lookup.changes, (next) => {
          if (revision === next.revision) return;
          revision = next.revision;
          return invalidate();
        });
        yield* forkEach(renders.events, (event) => {
          if (event._tag === "invalidated") return invalidate();
        });
        yield* pinOpenDocuments();
      }).pipe(
        Scope.provide(scope),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.gen(function* () {
                yield* SubscriptionRef.set(state, {
                  startup: "failed" as const,
                  stopped: false,
                });
                yield* Effect.logError(
                  "Could not start citation text",
                  cause,
                ).pipe(withLogCategory("citation-text"));
              }),
        ),
      );
      return {
        current: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state).pipe(
          Stream.takeUntil((value) => value.stopped),
        ),
        events: Stream.fromPubSub(bus),
        peek,
        read,
      };
    }),
  );

function documentKey(path: string): [string, string] {
  return [CITATION_TEXT, path];
}

function pathOf(key: readonly unknown[]): string {
  return String(key[1]);
}

interface CitedItem {
  csl: CslItemData;
  summary: string;
}

interface PlacedCitation extends CitationSource {
  parsed: ScannedPandocCitation;
  start: number;
  works: (string | null)[];
  identity: string;
}

interface RenderContextCitation {
  identity: string;
  start: number;
  renderSource: string;
  complete: boolean;
}

function worksByCitekey(cited: readonly Citation[]): Map<string, string> {
  const works = new Map<string, string>();
  for (const { indexedKey, occurrences } of cited) {
    if (indexedKey === null) continue;
    for (const { kind, raw } of occurrences) {
      if (kind === "citekey" && !works.has(raw)) works.set(raw, indexedKey);
    }
  }
  return works;
}

function literalCitations({
  body,
  scanned,
  occurrences,
  works,
}: {
  body: string;
  scanned: NoteScanRecord["citations"];
  occurrences: readonly CitationOccurrence[];
  works: ReadonlyMap<string, string>;
}): PlacedCitation[] {
  const members = new Set(
    occurrences
      .filter((occurrence) => occurrence.kind === "citekey")
      .map((occurrence) => occurrence.position.start.offset),
  );
  return scanned
    .filter(({ keys }) => keys.every((key) => members.has(key.start)))
    .map((parsed) => {
      const { start, end, keys } = parsed;
      const source = body.slice(start, end);
      return {
        start,
        source,
        parsed,
        identity: citationKey({ source }),
        keys: keys.map((key) => ({
          citekey: key.citekey,
          start: key.start - start,
          end: key.end - start,
        })),
        works: keys.map((key) => works.get(key.citekey) ?? null),
      };
    });
}

function renderContextCitation(
  citation: PlacedCitation,
  works: ReadonlyMap<string, CitedItem>,
): RenderContextCitation | null {
  const ids = citation.works.map((indexedKey) =>
    indexedKey !== null && works.has(indexedKey) ? indexedKey : null,
  );
  if (ids.every((id) => id === null)) return null;

  return {
    identity: citation.identity,
    start: citation.start,
    renderSource: renderParsedCitation(citation.parsed, ids),
    complete: ids.every((id) => id !== null),
  };
}

function documentCitationsEqual(
  prev: DocumentCitations,
  next: DocumentCitations,
): boolean {
  return (
    prev.lookup.revision === next.lookup.revision &&
    prev.entrySerials === next.entrySerials &&
    profilePresentationFailuresEqual(
      prev.presentationFailure,
      next.presentationFailure,
    ) &&
    mapsEqual(prev.summaries, next.summaries, Object.is) &&
    mapsEqual(prev.literalWorks, next.literalWorks, Object.is) &&
    mapsEqual(prev.formatted, next.formatted, occurrencesEqual)
  );
}

function profilePresentationFailuresEqual(
  prev: DocumentCitations["presentationFailure"],
  next: DocumentCitations["presentationFailure"],
): boolean {
  if (prev === undefined || next === undefined) return prev === next;
  return (
    prev.target === next.target &&
    prev.diagnostic.code === next.diagnostic.code &&
    prev.diagnostic.hint === next.diagnostic.hint &&
    prev.diagnostic.recovery.action === next.diagnostic.recovery.action &&
    prev.diagnostic.stamp === next.diagnostic.stamp &&
    prev.diagnostic.path === next.diagnostic.path &&
    prev.diagnostic.indexedKey === next.diagnostic.indexedKey
  );
}

function occurrencesEqual(
  prev: readonly FormattedOccurrence[],
  next: readonly FormattedOccurrence[],
): boolean {
  return (
    prev.length === next.length &&
    prev.every(
      (occurrence, index) =>
        occurrence.start === next[index]!.start &&
        presentedCitationEqual(occurrence, next[index]!),
    )
  );
}
