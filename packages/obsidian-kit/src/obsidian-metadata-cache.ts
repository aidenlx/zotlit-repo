import type { ObsidianEventEmitter } from "#obsidian-event-source.ts";
import { Context, Effect, Layer } from "effect";
import type { Stream } from "effect";
import type {
  CachedMetadata,
  MetadataCache as ObsidianMetadataCache,
  TFile,
} from "obsidian";

import { ObsidianApp } from "#obsidian-app.ts";
import { obsidianEventSource } from "#obsidian-event-source.ts";

export type MetadataEvent =
  | {
      readonly _tag: "changed";
      readonly file: TFile;
      readonly data: string;
      readonly cache: CachedMetadata;
    }
  | {
      readonly _tag: "deleted";
      readonly file: TFile;
      readonly prevCache: CachedMetadata | null;
    }
  | { readonly _tag: "resolve"; readonly file: TFile }
  | { readonly _tag: "resolved" };

export type MetadataCacheSource = Pick<
  ObsidianMetadataCache,
  | "getFileCache"
  | "getCache"
  | "getFirstLinkpathDest"
  | "onCleanCache"
  | "resolvedLinks"
> &
  ObsidianEventEmitter;

export interface MetadataCacheShape {
  fileCache(file: TFile): Effect.Effect<CachedMetadata | null>;
  cache(path: string): Effect.Effect<CachedMetadata | null>;
  readonly resolvedLinks: Effect.Effect<
    Readonly<Record<string, Readonly<Record<string, number>>>>
  >;
  firstLinkpathDest(
    linkpath: string,
    sourcePath: string,
  ): Effect.Effect<TFile | null>;
  readonly changes: Stream.Stream<MetadataEvent>;
  readonly whenResolved: Effect.Effect<void>;
}

export class MetadataCache extends Context.Service<
  MetadataCache,
  MetadataCacheShape
>()("zotlit/obsidian/MetadataCache") {}

export const makeMetadataCache = Effect.fnUntraced(function* (
  source: MetadataCacheSource,
) {
  const events = yield* obsidianEventSource<MetadataEvent>();
  yield* events.listen(
    source,
    "changed",
    (file: TFile, data: string, cache: CachedMetadata) => ({
      _tag: "changed",
      file,
      data,
      cache,
    }),
  );
  yield* events.listen(
    source,
    "deleted",
    (file: TFile, prevCache: CachedMetadata | null) => ({
      _tag: "deleted",
      file,
      prevCache,
    }),
  );
  yield* events.listen(source, "resolve", (file: TFile) => ({
    _tag: "resolve",
    file,
  }));
  yield* events.listen(source, "resolved", () => ({ _tag: "resolved" }));
  return MetadataCache.of({
    fileCache: Effect.fnUntraced(function* (file) {
      return yield* Effect.sync(() => source.getFileCache(file));
    }),
    cache: Effect.fnUntraced(function* (path) {
      return yield* Effect.sync(() => source.getCache(path));
    }),
    resolvedLinks: Effect.sync(() => source.resolvedLinks).pipe(
      Effect.withSpan("MetadataCache.resolvedLinks"),
    ),
    firstLinkpathDest: Effect.fnUntraced(function* (linkpath, sourcePath) {
      return yield* Effect.sync(() =>
        source.getFirstLinkpathDest(linkpath, sourcePath),
      );
    }),
    changes: events.stream,
    whenResolved: whenResolved(source),
  });
});

function whenResolved(source: MetadataCacheSource): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    source.onCleanCache(() => resume(Effect.void));
  });
}

export const layerMetadataCacheFrom = (
  source: MetadataCacheSource,
): Layer.Layer<MetadataCache> =>
  Layer.effect(MetadataCache, makeMetadataCache(source));

export const layerMetadataCache: Layer.Layer<
  MetadataCache,
  never,
  ObsidianApp
> = Layer.effect(
  MetadataCache,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    return yield* makeMetadataCache(app.metadataCache);
  }),
);
