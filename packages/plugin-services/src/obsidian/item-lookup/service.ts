import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  FiberHandle,
  FiberSet,
  Layer,
  Scope,
} from "effect";
import type { Fiber } from "effect";

import { hasChineseRun } from "@zotlit/item-lookup";
import { awaitOwned } from "@zotlit/plugin-kernel/effect-fiber.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { isScopeClosed } from "@zotlit/plugin-kernel/effect-scope.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { selectorKey } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { SearchHit as ReadsSearchHit } from "@zotlit/zotero-reads/contract/rpc.ts";

import { segmenterNeed } from "#obsidian/chinese-segmenter/need.ts";
import { LibraryScope, scopeChanges } from "#obsidian/library-scope/service.ts";
import { UseLedger } from "#obsidian/use-ledger/service.ts";

export const DEFAULT_LIMIT = 50;

export interface SearchOptions {
  limit?: number;
  libraries?: readonly AvailableLibrary[];
  cited?: readonly string[];
}

export interface SearchHit extends ReadsSearchHit {
  library: AvailableLibrary | null;
  cited: boolean;
}

export interface ItemLookupSession {
  search(query: string, opts?: SearchOptions): Effect.Effect<SearchHit[]>;
}

export class ItemLookup extends Context.Service<
  ItemLookup,
  {
    search(query: string, opts?: SearchOptions): Effect.Effect<SearchHit[]>;
    readonly openSession: Effect.Effect<ItemLookupSession, never, Scope.Scope>;
  }
>()("zotlit/item-lookup/ItemLookup") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    ItemLookup: ItemLookup;
  }
}

const logInterrupted = (query: string) =>
  Effect.logDebug("Search interrupted").pipe(
    Effect.annotateLogs({ queryLength: query.length }),
  );

const deferredStart = { startImmediately: false } as const;

const runSearch = (fork: Effect.Effect<Fiber.Fiber<SearchHit[]>>) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.flatMap(fork, (fiber) => awaitOwned(fiber, restore)),
  );

export const layerItemLookup = Layer.effect(
  ItemLookup,
  Effect.gen(function* () {
    const { reads } = yield* ZoteroReads;
    const libraryScope = yield* LibraryScope;
    const useLedger = yield* UseLedger;
    const needSegmenter = yield* segmenterNeed;
    const scope = yield* Scope.Scope;
    const oneShots = yield* FiberSet.make<SearchHit[]>();
    const prewarms = yield* FiberSet.make<void>();
    const sessions = new Set<FiberHandle.FiberHandle<SearchHit[]>>();

    const searchItems = (
      libraries: readonly AvailableLibrary[],
      query: string,
      { limit, cited }: { limit: number; cited?: readonly string[] },
    ): Effect.Effect<SearchHit[]> =>
      Effect.gen(function* () {
        const labels =
          libraries.length > 1
            ? new Map(libraries.map((library) => [library.libraryID, library]))
            : null;
        const citedKeys = new Set(cited);
        if (hasChineseRun(query)) yield* Effect.forkIn(needSegmenter, scope);
        const t0 = yield* Clock.currentTimeMillis;
        const hits = yield* reads.SearchItems({
          libraryIDs: libraries.map((library) => library.libraryID),
          query,
          limit,
          ...(query.trim() === ""
            ? { uses: yield* useLedger.uses, ...(cited ? { cited } : {}) }
            : {}),
        });
        yield* Effect.logDebug("Search completed").pipe(
          Effect.annotateLogs({
            libraries: libraries.length,
            queryLength: query.length,
            hits: hits.length,
            durationMs: (yield* Clock.currentTimeMillis) - t0,
          }),
        );
        return hits.map((hit): SearchHit => ({
          ...hit,
          library: labels?.get(hit.item.libraryID) ?? null,
          cited: citedKeys.has(hit.item.indexedKey),
        }));
      }).pipe(
        Effect.catchTag("DbUnavailable", (error) =>
          Effect.logDebug("Search answered empty; database unavailable").pipe(
            Effect.annotateLogs({ error }),
            Effect.as([]),
          ),
        ),
        Effect.catch((error) => logFailure(error)),
        Effect.catchDefect((defect) => logFailure(defect)),
        withLogCategory("item-lookup"),
      );

    const requestOf = (
      query: string,
      opts: SearchOptions | undefined,
    ): Effect.Effect<Effect.Effect<SearchHit[]> | undefined> =>
      Effect.map(libraryScope.current, (current) => {
        const limit = opts?.limit ?? DEFAULT_LIMIT;
        const libraries = opts?.libraries ?? current?.available ?? [];
        if (limit <= 0 || libraries.length === 0) return undefined;
        return searchItems(libraries, query, { limit, cited: opts?.cited });
      });

    const prewarm = (resolved: ResolvedLibraryScope | null) => {
      const libraries = resolved?.available ?? [];
      if (libraries.length === 0) return Effect.void;
      return FiberSet.run(
        prewarms,
        Effect.asVoid(searchItems(libraries, "", { limit: 1 })),
      ).pipe(Effect.asVoid);
    };

    const search = Effect.fn("ItemLookup.search")(function* (
      query: string,
      opts?: SearchOptions,
    ) {
      const request = yield* requestOf(query, opts);
      if (request === undefined) return [];
      const exit = yield* runSearch(
        FiberSet.run(oneShots, request, deferredStart),
      );
      if (Exit.isSuccess(exit)) return exit.value;
      yield* logInterrupted(query);
      return [];
    }, withLogCategory("item-lookup"));

    const openSession = Effect.gen(function* () {
      const sessionScope = yield* Scope.fork(scope);
      yield* Effect.addFinalizer(() => Scope.close(sessionScope, Exit.void));
      const handle = yield* FiberHandle.make<SearchHit[]>().pipe(
        Scope.provide(sessionScope),
      );
      sessions.add(handle);
      yield* Scope.addFinalizer(
        sessionScope,
        Effect.sync(() => sessions.delete(handle)),
      );
      let latest: Deferred.Deferred<SearchHit[]> | undefined;
      const session: ItemLookupSession = {
        search: Effect.fn("ItemLookup.session.search")(function* (
          query: string,
          opts?: SearchOptions,
        ) {
          if (isScopeClosed(sessionScope)) return [];
          const request = yield* requestOf(query, opts);
          const answer = yield* Deferred.make<SearchHit[]>();
          latest = answer;
          const settled = yield* Effect.gen(function* () {
            if (request === undefined) return [];
            const exit = yield* runSearch(
              FiberHandle.run(handle, request, deferredStart),
            );
            if (Exit.isSuccess(exit)) return exit.value;
            yield* logInterrupted(query);
            const newest = latest;
            return newest === answer || newest === undefined
              ? []
              : yield* Deferred.await(newest);
          }).pipe(Effect.onInterrupt(() => Deferred.succeed(answer, [])));
          yield* Deferred.succeed(answer, settled);
          return settled;
        }, withLogCategory("item-lookup")),
      };
      return session;
    }).pipe(Effect.withSpan("ItemLookup.openSession"));

    let scopeKey = scopeKeyOf(yield* libraryScope.current);
    yield* forkEach(scopeChanges(libraryScope.changes), ({ current }) =>
      Effect.gen(function* () {
        const next = scopeKeyOf(current);
        if (next !== scopeKey) {
          scopeKey = next;
          yield* Effect.forkIn(
            Effect.all(
              [
                FiberSet.clear(oneShots),
                ...[...sessions].map(FiberHandle.clear),
              ],
              { discard: true },
            ),
            scope,
            { startImmediately: true },
          );
        }
        yield* prewarm(current);
      }),
    );

    yield* Effect.logInfo("Item lookup ready");
    yield* prewarm(yield* libraryScope.current);
    return ItemLookup.of({ search, openSession });
  }).pipe(withLogCategory("item-lookup")),
);

function logFailure(error: unknown): Effect.Effect<SearchHit[]> {
  return Effect.logError("Search failed").pipe(
    Effect.annotateLogs({ error }),
    Effect.as([]),
  );
}

function scopeKeyOf(resolved: ResolvedLibraryScope | null): string {
  return (resolved?.available ?? [])
    .map((library) => `${selectorKey(library.selector)}@${library.libraryID}`)
    .join(",");
}
