// A Query View test registry over in-memory host services and controlled query reads.
import { Effect, Layer, Queue, Stream } from "effect";
import type { QueryHandle } from "@/services/item-query/handle.ts";
import type { ResolvedLibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { ZoteroReadsEvents, ZoteroReadLease } from "@zotlit/zotero-reads/client/service.ts";

import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { layerUnreadViewServices } from "@/services/__fixtures__/view-atoms.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { MetadataEvent } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { makeViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { QueryService } from "@/services/item-query/service.ts";
import { DEFAULT_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsEvent } from "@zotlit/zotero-reads/client/service.ts";
import { layerAnnotServices } from "@zotlit/annotations/__fixtures__/annot-view/host.ts";
import type { AnnotHostOptions } from "@zotlit/annotations/__fixtures__/annot-view/host.ts";
import type { QueryViewDeps } from "@/views/query-view/view.tsx";

export interface QueryHostDeps extends Pick<QueryViewDeps, "app"> {
  query: Pick<QueryHandle, "run" | "on" | "customFieldNames">;
  reads: { acquireRead(): Promise<ZoteroReadLease> } &
    Pick<
      {
        readonly [K in keyof ZoteroReadsEvents]: Stream.Stream<
          Parameters<ZoteroReadsEvents[K]> extends [infer A] ? A : void
        >;
      } & { acquireRead: { acquireRead(): Promise<ZoteroReadLease> }["acquireRead"] },
      | "changed"
      | "degraded"
      | "refresh-failed"
      | "refreshing"
      | "db-file-missing"
      | "refresh-requested"
      | "acquireRead"
    >;
  libraryScope: {
    readonly changed: Stream.Stream<ResolvedLibraryScope | null>;
    readonly "libraries-changed": Stream.Stream<void>;
    readonly current: ResolvedLibraryScope | null;
  };
}

export async function makeQueryHost<R = never>(
  deps: QueryHostDeps,
  options: AnnotHostOptions<R> = {},
) {
  const stack = new AsyncDisposableStack();
  let libraryRevision = 0;
  let querySubscribers = 0;
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(options.sources),
      layerAnnotServices(options),
      Layer.mock(Vault, {
        changes: Stream.empty,
        getFileByPath: (path) =>
          Effect.sync(() => deps.app.vault.getFileByPath(path)),
      }),
      Layer.mock(MetadataCache, {
        fileCache: (file) =>
          Effect.sync(() => deps.app.metadataCache.getFileCache(file)),
        changes: Stream.callback<MetadataEvent>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() =>
              deps.app.metadataCache.on("changed", (file, data, cache) => {
                Queue.offerUnsafe(queue, {
                  _tag: "changed",
                  file,
                  data,
                  cache,
                });
              }),
            ),
            (ref) => Effect.sync(() => deps.app.metadataCache.offref(ref)),
          ),
        ),
      }),
      Layer.mock(QueryService, {
        run: (request) =>
          Effect.promise((signal) => deps.query.run(request, signal)),
        customFieldNames: Effect.promise((signal) =>
          deps.query.customFieldNames(signal),
        ),
        changed: Stream.callback<void>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              querySubscribers += 1;
              return deps.query.on("changed", () => {
                Queue.offerUnsafe(queue, undefined);
              });
            }),
            (off) =>
              Effect.sync(() => {
                querySubscribers -= 1;
                off();
              }),
          ),
        ),
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReads["Service"]["reads"]>(
          "ZoteroReadsApi",
          {},
        ),
        current: Effect.succeed({
          state: "ready" as const,
          error: null,
          moved: false,
          dbFileMissing: false,
          activeReadMode: null,
        }),
        changes: Stream.succeed({
          state: "ready" as const,
          error: null,
          moved: false,
          dbFileMissing: false,
          activeReadMode: null,
        }),
        snapshot: Effect.acquireDisposable(
          Effect.promise(() => deps.reads.acquireRead()),
        ).pipe(Effect.map((lease) => lease.reads)),
        events: Stream.mergeAll(
          [
            Stream.map(deps.reads.changed, (): ZoteroReadsEvent => ({
              _tag: "changed",
            })),
            Stream.map(deps.reads.degraded, (error): ZoteroReadsEvent => ({
              _tag: "degraded",
              error,
            })),
            Stream.map(deps.reads["db-file-missing"], (): ZoteroReadsEvent => ({
              _tag: "db-file-missing",
            })),
          ],
          { concurrency: "unbounded" },
        ),
        ...options.reads,
      }),
      Layer.mock(LibraryScope, {
        current: Effect.sync(() => deps.libraryScope.current),
        changes: Stream.concat(
          Stream.make(null),
          deps.libraryScope["libraries-changed"].pipe(
            Stream.tap(() =>
              Effect.sync(() => {
                libraryRevision += 1;
              }),
            ),
          ),
        ).pipe(
          Stream.map(() => ({
            current: deps.libraryScope.current,
            all: deps.libraryScope.current
              ? {
                  ...deps.libraryScope.current,
                  available: deps.libraryScope.current.available.map(
                    (library) => ({
                      ...library,
                      name:
                        libraryRevision === 0
                          ? library.name
                          : `${library.name ?? "Library"} ${libraryRevision}`,
                    }),
                  ),
                }
              : null,
            invalid: false,
            effective: DEFAULT_LIBRARY_SCOPE,
            libraryRows: null,
          })),
        ),
      }),
      options.services ?? Layer.empty,
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry,
    querySubscribers: () => querySubscribers,
    async [Symbol.asyncDispose]() {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
