import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";

import { createLanguageLookup } from "@zotlit/db";
import type {
  IndexedItem,
  IndexSignature,
  Item,
  LanguageNameLookup,
} from "@zotlit/db";
import { withLogCategory } from "@zotlit/shared/logging";

import type { EngineIndex, SearchMatches, SearchOptions } from "./engine.ts";
import { makeEngineIndexBuilder, searchEngineIndex } from "./engine.ts";
import type { SegmenterBinary, SegmenterStatus } from "./segmenter-switch.ts";
import {
  makeSegmenterSwitch,
  SegmenterBinaryReader,
} from "./segmenter-switch.ts";
import { layerSegmenterNone, Segmenter } from "./segmenter.ts";

export class SourceUnavailable extends Schema.TaggedError<
  SourceUnavailable,
  { readonly brand: unique symbol }
>()("SourceUnavailable", { message: Schema.String }) {}

export interface PinnedItemSource {
  readonly generation: number;
  readonly items: (
    libraryID: number,
  ) => Stream.Stream<readonly IndexedItem[], SourceUnavailable>;
  readonly signature: (
    libraryID: number,
  ) => Effect.Effect<IndexSignature, SourceUnavailable>;
  readonly itemsByIndexedKey: (
    indexedKeys: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, Item>, SourceUnavailable>;
}

export class ItemSource extends Context.Service<
  ItemSource,
  {
    readonly generation: Stream.Stream<void>;
    readonly pinned: Effect.Effect<
      PinnedItemSource,
      SourceUnavailable,
      Scope.Scope
    >;
  }
>()("zotlit/item-lookup/ItemSource") {}

export interface IndexSettings {
  readonly locale: string | null;
  readonly segmenterBinary: SegmenterBinary | null;
}

export interface SearchHit {
  readonly item: Item;
  readonly matches: SearchMatches;
}

export class ItemIndex extends Context.Service<
  ItemIndex,
  {
    readonly search: (
      libraries: readonly number[],
      query: string,
      options: SearchOptions,
    ) => Effect.Effect<readonly SearchHit[], SourceUnavailable>;
    readonly configure: (settings: IndexSettings) => Effect.Effect<void>;
    readonly checkSegmenter: (
      binary: SegmenterBinary | null,
    ) => Effect.Effect<SegmenterStatus>;
  }
>()("zotlit/item-lookup/ItemIndex") {}

const log = (message: string, properties?: Readonly<Record<string, unknown>>) =>
  Effect.logDebug(message).pipe(
    Effect.annotateLogs(properties ?? {}),
    withLogCategory("zotlit", "item-lookup", "item-index"),
  );

interface BuiltIndex {
  readonly engine: EngineIndex;
  readonly generation: number;
  readonly signatures: readonly IndexSignature[];
  readonly config: number;
  readonly binding: Binding;
}

interface Binding {
  readonly source: PinnedItemSource;
  readonly scope: Scope.Closeable;
  users: number;
  retired: boolean;
}

const retire = (binding: Binding | undefined): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (!binding || binding.retired) return Effect.void;
    binding.retired = true;
    return binding.users === 0
      ? Scope.close(binding.scope, Exit.void)
      : Effect.void;
  });

interface Lane {
  fiber: Fiber.Fiber<void, SourceUnavailable> | null;
  readonly done: Deferred.Deferred<void, SourceUnavailable>;
}

interface Entry {
  readonly libraries: readonly number[];
  built: BuiltIndex | null;
  lane: Lane | null;
  rerun: boolean;
  asked: boolean;
  waiters: number;
}

export const layerItemIndex = (
  initial: IndexSettings,
): Layer.Layer<ItemIndex, never, ItemSource | SegmenterBinaryReader> =>
  Layer.effect(ItemIndex)(makeItemIndex(initial));

function makeItemIndex(initial: IndexSettings) {
  return Effect.gen(function* () {
    const source = yield* Effect.service(ItemSource);
    const segmenterSwitch = makeSegmenterSwitch(
      yield* Effect.service(SegmenterBinaryReader),
    );
    let settings = initial;
    let segmenter =
      (yield* segmenterSwitch.resolve(initial.segmenterBinary)) ??
      (yield* Effect.provide(Effect.service(Segmenter), layerSegmenterNone));
    const configuring = yield* Semaphore.make(1);
    const entries = new Map<string, Entry>();
    let latest: Entry | null = null;
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        entries.values(),
        (entry) =>
          entry.built
            ? Scope.close(entry.built.binding.scope, Exit.void)
            : Effect.void,
        { discard: true },
      ),
    );
    const fork = yield* FiberSet.makeRuntime<never, void, SourceUnavailable>();
    let configVersion = 0;
    let languageLookup: {
      locale: string | null;
      lookup: LanguageNameLookup;
    } | null = null;

    const lookupFor = (locale: string | null): LanguageNameLookup => {
      if (languageLookup?.locale !== locale) {
        languageLookup = { locale, lookup: createLanguageLookup(locale) };
      }
      return languageLookup.lookup;
    };

    const hold = (entry: Entry, built: BuiltIndex) =>
      Effect.suspend(() => {
        const replaced = entry.built?.binding;
        entry.built = built;
        return retire(replaced);
      });

    const drop = (entry: Entry) =>
      Effect.suspend(() => {
        const replaced = entry.built?.binding;
        entry.built = null;
        return retire(replaced);
      });

    const rebuildOnce = (entry: Entry) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const scope = yield* Scope.make();
          let held = false;
          const holdOnce = (built: BuiltIndex) =>
            Effect.suspend(() => {
              held = true;
              return hold(entry, built);
            }).pipe(Effect.uninterruptible);
          return yield* restore(checkAndBuild(entry, scope, holdOnce)).pipe(
            Effect.onExit(() =>
              held ? Effect.void : Scope.close(scope, Exit.void),
            ),
          );
        }),
      ).pipe(
        Effect.tapError((error) =>
          Effect.andThen(
            drop(entry),
            log("Item index dropped; source unavailable", {
              libraries: entry.libraries,
              error,
            }),
          ),
        ),
      );

    const checkAndBuild = (
      entry: Entry,
      scope: Scope.Closeable,
      holdOnce: (built: BuiltIndex) => Effect.Effect<void>,
    ) =>
      Effect.gen(function* () {
        const version = configVersion;
        const pinned = yield* Scope.provide(source.pinned, scope);
        const binding: Binding = {
          source: pinned,
          scope,
          users: 0,
          retired: false,
        };
        const signatures = yield* Effect.forEach(
          entry.libraries,
          pinned.signature,
        );
        const held = entry.built;
        if (
          held !== null &&
          held.generation === pinned.generation &&
          held.config === version &&
          signaturesEqual(held.signatures, signatures)
        ) {
          yield* log("Item index up to date; skipping rebuild", {
            libraries: entry.libraries,
            generation: pinned.generation,
          });
          yield* holdOnce({ ...held, binding });
          return;
        }
        yield* log("Item index build started", {
          libraries: entry.libraries,
          generation: pinned.generation,
          reason:
            held === null
              ? "no index"
              : held.generation !== pinned.generation
                ? "generation"
                : held.config !== version
                  ? "configuration"
                  : "signature",
        });
        const startedAt = performance.now();
        const builder = yield* makeEngineIndexBuilder({
          libraries: entry.libraries,
          languageLookup: lookupFor(settings.locale),
        }).pipe(Effect.provideService(Segmenter, segmenter));
        for (const libraryID of entry.libraries) {
          yield* Stream.runForEach(pinned.items(libraryID), (slice) =>
            builder.add(slice),
          );
        }
        const engine = yield* builder.build;
        yield* holdOnce({
          engine,
          generation: pinned.generation,
          signatures,
          config: version,
          binding,
        });
        yield* log("Item index built", {
          libraries: entry.libraries,
          count: engine.size,
          durationMs: performance.now() - startedAt,
        });
      });

    const startLane = (entry: Entry): Lane => {
      const done = Deferred.makeUnsafe<void, SourceUnavailable>();
      const lane: Lane = { fiber: null, done };
      const loop: Effect.Effect<void, SourceUnavailable> = Effect.suspend(
        () => {
          entry.rerun = false;
          return rebuildOnce(entry);
        },
      ).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (entry.rerun) return loop;
            if (entry.lane === lane) entry.lane = null;
            return Effect.void;
          }),
        ),
      );
      const run = loop.pipe(
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            if (entry.lane === lane) entry.lane = null;
            return Deferred.done(
              done,
              Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                ? Exit.void
                : exit,
            );
          }),
        ),
      );
      entry.lane = lane;
      lane.fiber = fork(run);
      return lane;
    };

    const ensureLane = (entry: Entry): Lane => entry.lane ?? startLane(entry);

    const requestRebuild = (entry: Entry): Effect.Effect<void> => {
      if (entry.lane) {
        entry.rerun = true;
        return log("Item index rebuild coalesced; trailing rerun scheduled", {
          libraries: entry.libraries,
        });
      }
      startLane(entry);
      return Effect.void;
    };

    const onGeneration = Effect.suspend(() => {
      const work: Effect.Effect<void>[] = [];
      for (const [key, entry] of entries) {
        if (!entry.asked && entry.waiters === 0 && entry !== latest) {
          entries.delete(key);
          work.push(
            log("Item index evicted; no search since the last change", {
              libraries: entry.libraries,
            }),
          );
          const fiber = entry.lane?.fiber;
          if (fiber) work.push(Fiber.interrupt(fiber));
          work.push(drop(entry));
          continue;
        }
        entry.asked = false;
        work.push(requestRebuild(entry));
      }
      return Effect.all(work, { discard: true });
    });

    const onConfig = Effect.gen(function* () {
      configVersion++;
      yield* log("Item index configuration changed; rebuilding", {
        lists: entries.size,
      });
      yield* Effect.forEach(entries.values(), requestRebuild, {
        discard: true,
      });
    });

    yield* Stream.runForEach(source.generation, () => onGeneration).pipe(
      Effect.forkScoped({ startImmediately: true }),
    );

    const configure = (next: IndexSettings): Effect.Effect<void> =>
      Effect.gen(function* () {
        const switched = yield* segmenterSwitch.resolve(next.segmenterBinary);
        const changed =
          switched !== undefined || next.locale !== settings.locale;
        settings = next;
        if (switched) segmenter = switched;
        if (changed) yield* onConfig;
      }).pipe(configuring.withPermits(1));

    const checkSegmenter = (
      binary: SegmenterBinary | null,
    ): Effect.Effect<SegmenterStatus> =>
      Effect.gen(function* () {
        const switched = yield* segmenterSwitch.resolve(binary, {
          reread: true,
        });
        settings = { ...settings, segmenterBinary: binary };
        if (switched) {
          segmenter = switched;
          yield* onConfig;
        }
        return yield* segmenterSwitch.status;
      }).pipe(configuring.withPermits(1));

    const indexFor = (
      libraries: readonly number[],
    ): Effect.Effect<Entry, SourceUnavailable> =>
      Effect.gen(function* () {
        const entry = getEntry(libraries);
        entry.asked = true;
        latest = entry;
        if (entry.built === null) {
          const lane = ensureLane(entry);
          yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              entry.waiters++;
            }),
            () => Deferred.await(lane.done),
            () =>
              Effect.sync(() => {
                entry.waiters--;
              }),
          );
        }
        if (entry.built) return entry;
        return yield* Effect.interrupt;
      });

    const getEntry = (libraries: readonly number[]): Entry => {
      const key = libraries.join(",");
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = {
          libraries: [...libraries],
          built: null,
          lane: null,
          rerun: false,
          asked: false,
          waiters: 0,
        };
        entries.set(key, entry);
      }
      return entry;
    };

    const holdIndex = (entry: Entry) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const built = entry.built;
          if (built) built.binding.users++;
          return built;
        }),
        (built) =>
          Effect.suspend(() => {
            if (!built) return Effect.void;
            const binding = built.binding;
            binding.users--;
            return binding.retired && binding.users === 0
              ? Scope.close(binding.scope, Exit.void)
              : Effect.void;
          }),
      );

    const search = (
      libraries: readonly number[],
      query: string,
      options: SearchOptions,
    ): Effect.Effect<readonly SearchHit[], SourceUnavailable> =>
      Effect.scoped(
        Effect.gen(function* () {
          const built = yield* holdIndex(yield* indexFor(libraries));
          if (!built) return yield* search(libraries, query, options);
          const hits = yield* searchEngineIndex(built.engine, query, options);
          const items = yield* built.binding.source.itemsByIndexedKey(
            hits.map((hit) => hit.indexedKey),
          );
          return hits.flatMap((hit): SearchHit[] => {
            const item = items.get(hit.indexedKey);
            return item ? [{ item, matches: hit.matches }] : [];
          });
        }),
      );

    return { search, configure, checkSegmenter };
  });
}

function signaturesEqual(
  a: readonly IndexSignature[],
  b: readonly IndexSignature[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (signature, index) =>
        signature.count === b[index]!.count &&
        signature.checksum === b[index]!.checksum,
    )
  );
}
