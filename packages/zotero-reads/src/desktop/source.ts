import type { EffectiveReadMode } from "#contract/rpc.ts";
import type { ReadsConfig } from "#contract/rpc.ts";
import type { OpenClient } from "#worker/connection.ts";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Queue,
  Ref,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { dirname, join } from "node:path";

import { getSchemaVersions, SUPPORTED_SCHEMA_VERSIONS } from "@zotlit/db";
import type { ZoteroDatabase, ZoteroSchemaVersions } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import {
  ZOTERO_DB_FILENAME,
  ZOTERO_WAL_FILENAME,
} from "@zotlit/plugin-kernel/constants.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";

import { closeClient, nodeClient } from "./node-client.ts";
import { readParentBeside } from "./read-parent.ts";
import {
  buildSqliteUri,
  prepareRead,
  snapshotSource,
  sourceFingerprintsEqual,
  walGenerationSize,
} from "./read-source.ts";
import type {
  PreparedRead,
  ReadFallbackReason,
  SourceFingerprint,
} from "./read-source.ts";
import { reapReadClones } from "./reap-temps.ts";

import { makeStateFeed } from "#contract/change-feed.ts";
import { DbUnavailable } from "#contract/rpc.ts";
import {
  Connection,
  makeClientRef,
  makeDatabaseGenerations,
  toDbUnavailable,
  validateClient,
} from "#worker/connection.ts";

const WATCH_DEBOUNCE_MS = 1200;
const IMMUTABLE_WATCH_DEBOUNCE_MS = 300;

const logDebug = (message: string, annotations: Record<string, unknown> = {}) =>
  Effect.logDebug(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads"),
  );

const logInfo = (message: string, annotations: Record<string, unknown> = {}) =>
  Effect.logInfo(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads"),
  );

const logWarning = (
  message: string,
  annotations: Record<string, unknown> = {},
) =>
  Effect.logWarning(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads"),
  );

const logWarningCause = (
  message: string,
  error: unknown,
  annotations: Record<string, unknown> = {},
) =>
  Effect.logWarning(message, Cause.fail(error)).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads"),
  );

export interface SourcePorts {
  prepareRead: (
    mode: ReadsConfig["readMode"],
    path: string,
  ) => Effect.Effect<
    PreparedRead,
    DbUnavailable,
    Scope.Scope | FileSystem.FileSystem
  >;
  snapshotSource: (
    path: string,
  ) => Effect.Effect<SourceFingerprint, DbUnavailable>;
  createClient: (uri: string) => NodeDatabaseClient;
  reapReadClones: (options: {
    parent: string;
  }) => Effect.Effect<unknown, DbUnavailable, FileSystem.FileSystem>;
}

const defaultPorts: SourcePorts = {
  prepareRead,
  snapshotSource,
  createClient: (uri) => createClient(uri, { jit: true }),
  reapReadClones,
};

export interface SourceOptions {
  ports?: Partial<SourcePorts>;
  initial?: ReadsConfig | null;
  deferOpen?: boolean;
}

interface WatchSignal {
  trusted: boolean;
  filename?: string;
}

interface RefreshRequest {
  skipUnchanged: boolean;
  done: Deferred.Deferred<void, DbUnavailable>;
}

export function layerSource(
  options?: SourceOptions,
): Layer.Layer<Connection, never, FileSystem.FileSystem> {
  const ports: SourcePorts = { ...defaultPorts, ...options?.ports };

  return Layer.effect(Connection)(
    Effect.gen(function* () {
      const lifetime = yield* Scope.Scope;
      const fs = yield* FileSystem.FileSystem;
      const state = yield* Ref.make<{
        config: ReadsConfig | null;
        state: "loading" | "ready" | "degraded";
        lastError: DbUnavailable | null;
        hasClient: boolean;
        sourcePath: string | null;
        moved: boolean;
        readMode: EffectiveReadMode | null;
        fingerprint: SourceFingerprint | null;
        schemaVersions: ZoteroSchemaVersions | null;
        sweptReadParent: string | null;
        missingDbSignalled: boolean;
      }>({
        config: null,
        state: "loading",
        lastError: null,
        hasClient: false,
        sourcePath: null,
        moved: false,
        readMode: null,
        fingerprint: null,
        schemaVersions: null,
        sweptReadParent: null,
        missingDbSignalled: false,
      });
      const loggedFallbacks = yield* Ref.make(new Set<ReadFallbackReason>());
      const mainWatcherScope = yield* Ref.make<Scope.Closeable | null>(null);
      const walWatcherScope = yield* Ref.make<Scope.Closeable | null>(null);
      const watchBinds = yield* Semaphore.make(1);
      const watchSignals = yield* Queue.unbounded<WatchSignal>();
      const watchTimer = yield* Ref.make<Fiber.Fiber<void> | null>(null);
      const watchTrusted = yield* Ref.make(false);
      const refreshRequests = yield* Queue.unbounded<RefreshRequest>();
      const firstSettled = yield* Deferred.make<void>();
      const held = yield* Ref.make(
        Boolean(options?.initial && options.deferOpen),
      );

      const closeWatcherScopes = Effect.gen(function* () {
        const main = yield* Ref.getAndSet(mainWatcherScope, null);
        const wal = yield* Ref.getAndSet(walWatcherScope, null);
        yield* Effect.all(
          [
            main ? Scope.close(main, Exit.void) : Effect.void,
            wal ? Scope.close(wal, Exit.void) : Effect.void,
          ],
          { concurrency: "unbounded" },
        );
      });
      const cancelWatchTimer = Effect.gen(function* () {
        const timer = yield* Ref.getAndSet(watchTimer, null);
        yield* Ref.set(watchTrusted, false);
        if (timer) yield* Fiber.interrupt(timer);
      });
      yield* Effect.addFinalizer(() =>
        Effect.andThen(closeWatcherScopes, cancelWatchTimer),
      );
      const { publish, changes } = yield* makeStateFeed(() => {
        const current = Ref.getUnsafe(state);
        return {
          state: current.state,
          error: current.lastError,
          readMode: current.readMode,
          moved: current.moved,
          missing: current.missingDbSignalled,
        };
      });
      const databaseGenerations = makeDatabaseGenerations();
      const clients = yield* makeClientRef(
        Effect.failSync(
          () =>
            Ref.getUnsafe(state).lastError ??
            new DbUnavailable({ message: "No database source is open" }),
        ),
      );

      const reapReadParent = Effect.fnUntraced(function* (path: string) {
        const parent = readParentBeside(path);
        const fresh = yield* Ref.modify(state, (current) =>
          current.sweptReadParent === parent
            ? [false, current]
            : [true, { ...current, sweptReadParent: parent }],
        );
        if (!fresh) return;
        yield* logDebug("Sweeping read snapshots beside the database", {
          parent,
        });
        yield* ports.reapReadClones({ parent }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.catch((error) =>
            logDebug("Read snapshot sweep failed", { error }),
          ),
          Effect.forkIn(lifetime),
        );
      });

      const trySnapshotSource = (
        path: string,
      ): Effect.Effect<SourceFingerprint | null> =>
        ports.snapshotSource(path).pipe(
          Effect.catch((error) =>
            logDebug("Failed to fingerprint the Zotero database", {
              error,
            }).pipe(Effect.as(null)),
          ),
        );

      const reportSchemaVersions = Effect.fnUntraced(function* (
        client: ZoteroDatabase,
      ) {
        const versions = yield* Effect.try(() =>
          getSchemaVersions(client),
        ).pipe(
          Effect.catch((error) =>
            logDebug("Zotero schema version unreadable", {
              error: error.cause,
            }).pipe(Effect.as(null)),
          ),
        );
        if (versions === null) return;
        const previous = yield* Ref.modify(state, (current) => [
          current.schemaVersions,
          { ...current, schemaVersions: versions },
        ]);
        if (
          previous?.userdata === versions.userdata &&
          previous.compatibility === versions.compatibility
        )
          return;
        const fields = {
          ...versions,
          supportedRange: SUPPORTED_SCHEMA_VERSIONS,
        };
        if (versions.supported)
          yield* logInfo(
            "Zotero schema version is within the supported range",
            fields,
          );
        else
          yield* logWarning(
            "Zotero schema version is outside the range ZotLit is verified against",
            fields,
          );
      });

      const logReadFallback = Effect.fnUntraced(function* (
        prepared: PreparedRead,
      ) {
        if (!prepared.fallbackReason) return;
        const fresh = yield* Ref.modify(loggedFallbacks, (logged) => {
          if (logged.has(prepared.fallbackReason!)) return [false, logged];
          const next = new Set(logged);
          next.add(prepared.fallbackReason!);
          return [true, next];
        });
        if (fresh)
          yield* logWarning("Database read mode fell back", {
            fallbackReason: prepared.fallbackReason,
            effectiveMode: prepared.effectiveMode,
          });
      });

      const openClient = Effect.fnUntraced(function* (
        readScope: Scope.Closeable,
        prepared: PreparedRead,
        file: string,
      ): Effect.fn.Return<
        OpenClient & { readonly readMode: EffectiveReadMode },
        DbUnavailable
      > {
        const clientScope = yield* Scope.make();
        return yield* Effect.onError(
          Effect.gen(function* () {
            const client = yield* Effect.acquireRelease(
              Effect.try({
                try: () =>
                  ports.createClient(
                    buildSqliteUri(prepared.path, prepared.uriOptions),
                  ),
                catch: toDbUnavailable,
              }),
              (client) => closeClient(client),
            ).pipe(Scope.provide(clientScope));
            const { client: validated } = yield* validateClient(
              nodeClient(client),
            ).pipe(Effect.mapError((cause) => toDbUnavailable(cause)));
            yield* databaseGenerations.record(nodeClient(client), file);
            yield* logReadFallback(prepared);
            yield* reportSchemaVersions(validated);
            return {
              client: validated,
              readMode: prepared.effectiveMode,
              close: Scope.close(clientScope, Exit.void).pipe(
                Effect.ensuring(Scope.close(readScope, Exit.void)),
              ),
            };
          }),
          () =>
            Scope.close(clientScope, Exit.void).pipe(
              Effect.ensuring(Scope.close(readScope, Exit.void)),
            ),
        );
      });

      const maybeSignalMissingDatabase = Effect.fnUntraced(function* (
        path: string,
      ) {
        const current = yield* Ref.get(state);
        const exists = yield* fileExists(path);
        if (current.missingDbSignalled || exists) return;
        yield* Ref.update(state, (previous) => ({
          ...previous,
          missingDbSignalled: true,
        }));
        yield* logInfo("Zotero database not found on this device", {
          dbPath: path,
        });
        yield* publish({ _tag: "db-file-missing" });
      });

      const refreshOnce = Effect.fnUntraced(
        function* (
          skipUnchanged: boolean,
        ): Effect.fn.Return<DbUnavailable | null> {
          const before = yield* Ref.get(state);
          const current = before.config;
          if (!current) return null;
          const { databasePath, readMode: configuredMode } = current;
          yield* reapReadParent(databasePath);
          const nextFingerprint = yield* trySnapshotSource(databasePath);
          if (
            skipUnchanged &&
            (yield* Queue.size(refreshRequests)) === 0 &&
            (yield* Ref.get(state)).config === current &&
            before.state === "ready" &&
            before.lastError === null &&
            before.readMode !== "immutable" &&
            before.sourcePath === databasePath &&
            before.fingerprint &&
            nextFingerprint &&
            sourceFingerprintsEqual(before.fingerprint, nextFingerprint)
          ) {
            yield* logDebug(
              "External change ignored, database unchanged since last read",
            );
            return null;
          }
          const result = yield* Effect.result(
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const readScope = yield* Scope.make();
                const opened = yield* Effect.onError(
                  Effect.gen(function* () {
                    const prepared = yield* restore(
                      ports
                        .prepareRead(configuredMode, databasePath)
                        .pipe(
                          Scope.provide(readScope),
                          Effect.provideService(FileSystem.FileSystem, fs),
                        ),
                    );
                    return yield* openClient(readScope, prepared, databasePath);
                  }),
                  () => Scope.close(readScope, Exit.void),
                );
                yield* clients.swap(opened);
                yield* Ref.update(state, (previous) => ({
                  ...previous,
                  hasClient: true,
                  sourcePath: databasePath,
                  readMode: opened.readMode,
                  fingerprint: nextFingerprint,
                  state: "ready" as const,
                  lastError: null,
                  moved: false,
                  missingDbSignalled: false,
                }));
              }),
            ),
          );
          if (result._tag === "Failure") {
            const error = result.failure;
            const currentState = yield* Ref.get(state);
            const moved =
              currentState.hasClient &&
              currentState.sourcePath !== databasePath;
            yield* publish({ _tag: "refresh-failed", error, moved });
            yield* logWarningCause("Failed to refresh Zotero database", error);
            yield* maybeSignalMissingDatabase(databasePath);
            const after = yield* Ref.modify(state, (previous) => [
              { hasClient: previous.hasClient },
              {
                ...previous,
                lastError: error,
                ...(!previous.hasClient && {
                  state: "degraded" as const,
                }),
              },
            ]);
            if (!after.hasClient) {
              yield* closeWatcherScopes;
              yield* publish({ _tag: "degraded", error });
            }
            return error;
          }
          yield* rebindWatchers();
          const currentState = yield* Ref.get(state);
          yield* publish({
            _tag: "changed",
            ...(currentState.readMode && {
              readMode: currentState.readMode,
            }),
          });
          yield* logInfo("Opened Zotero database", {
            sourcePath: databasePath,
            readMode: currentState.readMode,
          });
          return null;
        },
        Effect.ensuring(Deferred.succeed(firstSettled, undefined)),
      );

      const runRefreshes = (
        callers: ReadonlyArray<RefreshRequest>,
        skipUnchanged: boolean,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const failure = yield* refreshOnce(skipUnchanged);
          if ((yield* Queue.size(refreshRequests)) > 0) {
            yield* logDebug("Trailing request queued, rerunning refresh");
            const trailing = yield* Queue.takeAll(refreshRequests);
            return yield* runRefreshes([...callers, ...trailing], false);
          }
          const outcome = failure ? Exit.fail(failure) : Exit.void;
          yield* Effect.forEach(
            callers,
            ({ done }) => Deferred.done(done, outcome),
            { discard: true },
          );
        });

      yield* Queue.takeAll(refreshRequests).pipe(
        Effect.flatMap((requests) =>
          Effect.andThen(
            publish({ _tag: "refreshing", active: true }),
            runRefreshes(
              requests,
              requests.every(({ skipUnchanged }) => skipUnchanged),
            ),
          ).pipe(
            Effect.ensuring(publish({ _tag: "refreshing", active: false })),
          ),
        ),
        Effect.forever,
        Effect.forkIn(lifetime, { startImmediately: true }),
      );

      const enqueueRefresh = ({
        skipUnchanged = false,
      }: { skipUnchanged?: boolean } = {}): Effect.Effect<
        Deferred.Deferred<void, DbUnavailable>
      > =>
        Effect.gen(function* () {
          const done = yield* Deferred.make<void, DbUnavailable>();
          yield* Ref.set(held, false);
          yield* Queue.offer(refreshRequests, { skipUnchanged, done });
          return done;
        });

      const closeWalWatcher = Effect.gen(function* () {
        const scope = yield* Ref.getAndSet(walWatcherScope, null);
        if (scope) yield* Scope.close(scope, Exit.void);
      });

      const sourceMoved = Effect.gen(function* () {
        const before = yield* Ref.get(state);
        const previous = before.fingerprint;
        const path = before.config?.databasePath;
        const currentFingerprint = path ? yield* trySnapshotSource(path) : null;
        const moved =
          !previous ||
          !currentFingerprint ||
          !sourceFingerprintsEqual(previous, currentFingerprint);
        yield* logDebug("Watcher source fingerprint checked", {
          verdict: moved ? "changed" : "unchanged",
          readMode: (yield* Ref.get(state)).readMode,
          previousWalSize: walGenerationSize(previous?.wal),
          currentWalSize: walGenerationSize(currentFingerprint?.wal),
        });
        return moved;
      });

      const refreshIfSourceMoved = Effect.fnUntraced(function* ({
        trusted,
      }: WatchSignal) {
        if (!trusted) {
          const moved = yield* sourceMoved;
          const current = yield* Ref.get(state);
          if (current.readMode !== "immutable" && !moved) {
            yield* logDebug(
              "Watcher tick ignored, database unchanged since last read",
            );
            return;
          }
        }
        if (!trusted && !(yield* Ref.get(state)).config?.autoRefresh) {
          yield* logDebug("Watcher tick ignored, auto-refresh switched off");
          return;
        }
        yield* enqueueRefresh({ skipUnchanged: trusted });
      });

      const scheduleWatchedRefresh = Effect.fnUntraced(function* ({
        trusted,
        filename,
      }: WatchSignal) {
        if (filename === ZOTERO_WAL_FILENAME) yield* syncWalWatcher();
        if (trusted) yield* Ref.set(watchTrusted, true);
        const readMode = (yield* Ref.get(state)).readMode;
        const debounceMs =
          readMode === "immutable"
            ? IMMUTABLE_WATCH_DEBOUNCE_MS
            : WATCH_DEBOUNCE_MS;
        const timer = yield* Effect.andThen(
          Effect.sleep(Duration.millis(debounceMs)),
          Ref.getAndSet(watchTrusted, false).pipe(
            Effect.flatMap((wasTrusted) =>
              refreshIfSourceMoved({ trusted: wasTrusted }),
            ),
          ),
        ).pipe(Effect.forkIn(lifetime));
        const previous = yield* Ref.getAndSet(watchTimer, timer);
        if (previous) yield* Fiber.interrupt(previous);
      });

      const watchedFilename = (name: string | undefined): boolean => {
        if (name === ZOTERO_DB_FILENAME) return true;
        return (
          Ref.getUnsafe(state).readMode !== "immutable" &&
          name === ZOTERO_WAL_FILENAME
        );
      };

      const fileExists = (path: string) =>
        fs.exists(path).pipe(Effect.orElseSucceed(() => false));

      const watchPath = Effect.fnUntraced(function* (
        path: string,
        onEvent: (event: FileSystem.WatchEvent) => void,
      ) {
        const ready = yield* Deferred.make<void, unknown>();
        yield* fs
          .watch(path, {
            onReady: () => Deferred.doneUnsafe(ready, Exit.void),
          })
          .pipe(
            Stream.runForEach((event) => Effect.sync(() => onEvent(event))),
            recover(
              (cause) =>
                Effect.flatMap(
                  Deferred.fail(ready, Cause.squash(cause)),
                  (starting) =>
                    starting
                      ? Effect.void
                      : Effect.logWarning(
                          "A Zotero database watch failed",
                          cause,
                        ).pipe(
                          Effect.annotateLogs({ path }),
                          withLogCategory("zotero-reads"),
                        ),
                ),
              Effect.void,
            ),
            Effect.forkScoped,
          );
        yield* Deferred.await(ready);
      });

      const bindWatches = (
        holder: Ref.Ref<Scope.Closeable | null>,
        watches: Effect.Effect<void, unknown, Scope.Scope>,
        failure: { message: string; annotations?: Record<string, unknown> },
      ) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const scope = yield* Scope.make();
            const result = yield* Effect.result(
              restore(watches.pipe(Scope.provide(scope))).pipe(
                Effect.onInterrupt(() => Scope.close(scope, Exit.void)),
              ),
            );
            if (result._tag === "Failure") {
              yield* Scope.close(scope, Exit.void);
              yield* logWarningCause(
                failure.message,
                result.failure,
                failure.annotations,
              );
              return;
            }
            yield* Ref.set(holder, scope);
          }),
        );

      const syncWalWatcherHeld = Effect.fnUntraced(function* () {
        const current = yield* Ref.get(state);
        if (!current.sourcePath || current.readMode === "immutable") {
          yield* closeWalWatcher;
          return;
        }
        const walPath = join(dirname(current.sourcePath), ZOTERO_WAL_FILENAME);
        if (!(yield* fileExists(walPath))) {
          yield* closeWalWatcher;
          return;
        }
        if (yield* Ref.get(walWatcherScope)) return;
        yield* bindWatches(
          walWatcherScope,
          watchPath(walPath, () => enqueueWatchSignal({ trusted: false })),
          { message: "Failed to watch Zotero WAL", annotations: { walPath } },
        );
      });
      const syncWalWatcher = () =>
        syncWalWatcherHeld().pipe(Semaphore.withPermit(watchBinds));

      const enqueueWatchSignal = (signal: WatchSignal): void => {
        Queue.offerUnsafe(watchSignals, signal);
      };

      const bindMainWatchers = (current: {
        sourcePath: string;
        readMode: EffectiveReadMode;
      }) =>
        bindWatches(
          mainWatcherScope,
          Effect.gen(function* () {
            yield* watchPath(dirname(current.sourcePath), (event) => {
              const name = event.path;
              if (!watchedFilename(name)) return;
              enqueueWatchSignal({
                trusted: false,
                ...(name === ZOTERO_WAL_FILENAME && { filename: name }),
              });
            });
            yield* watchPath(current.sourcePath, () =>
              enqueueWatchSignal({ trusted: false }),
            );
          }),
          { message: "Failed to watch the Zotero database" },
        );

      const rebindWatchers = Effect.fnUntraced(function* () {
        yield* closeWatcherScopes;
        const current = yield* Ref.get(state);
        if (!current.config?.autoRefresh) {
          if (!(yield* Ref.get(watchTrusted))) yield* cancelWatchTimer;
          return;
        }
        if (!current.sourcePath || !current.readMode) return;
        yield* bindMainWatchers({
          sourcePath: current.sourcePath,
          readMode: current.readMode,
        });
        yield* syncWalWatcherHeld();
      }, Semaphore.withPermit(watchBinds));

      yield* Stream.fromQueue(watchSignals).pipe(
        Stream.runForEach((signal) => scheduleWatchedRefresh(signal)),
        Effect.forkIn(lifetime, { startImmediately: true }),
      );

      const configure = Effect.fnUntraced(function* (next: ReadsConfig) {
        const previous = yield* Ref.modify(state, (current) => [
          current.config,
          { ...current, config: next },
        ]);
        if (yield* Ref.get(held)) return;
        if (!previous) {
          yield* enqueueRefresh();
          return;
        }
        if (next.autoRefresh !== previous.autoRefresh) {
          yield* logDebug("Auto-refresh setting changed", {
            next: next.autoRefresh,
          });
          yield* rebindWatchers();
        }
        if (
          next.databasePath !== previous.databasePath ||
          next.readMode !== previous.readMode
        ) {
          yield* logDebug("Database source changed", {
            databasePath: next.databasePath,
            readMode: next.readMode,
          });
          yield* enqueueRefresh();
        }
      });

      if (options?.initial) yield* configure(options.initial);

      return Connection.of({
        borrow: Effect.andThen(Deferred.await(firstSettled), clients.borrow),
        changes,
        refresh: Effect.flatMap(enqueueRefresh(), (deferred) =>
          Deferred.await(deferred),
        ),
        notifyExternalChange: Effect.gen(function* () {
          yield* logDebug("External change signalled, scheduling refresh");
          yield* scheduleWatchedRefresh({ trusted: true });
        }),
        configure,
        databaseGeneration: databaseGenerations.databaseGeneration,
        databaseFile: databaseGenerations.databaseFile,
      });
    }),
  );
}
