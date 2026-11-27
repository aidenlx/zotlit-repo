import type { ReadsConfig, WebApiReadsConfig } from "#contract/rpc.ts";
import type {
  WebSyncProblem,
  WebSyncStatus,
} from "#contract/web-worker-rpc.ts";
import type { Duration } from "effect";
import {
  Cause,
  Clock,
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Latch,
  Layer,
  Redacted,
  Scope,
  Semaphore,
} from "effect";

import type { ZoteroDatabase } from "@zotlit/db";
import { openWasmClient } from "@zotlit/db/client/wasm";
import type { WasmDatabaseClient } from "@zotlit/db/client/wasm";
import { checkDatabaseLayout } from "@zotlit/db/item-query";
import { createReplica, ensureSyncTables } from "@zotlit/db/replica";
import type { SqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import {
  monotonicMillis,
  toInstant,
} from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";
import {
  applyDownloadSteps,
  describeStorageFailure,
  downloadReplica,
  readSyncStatus,
  replicaLocale,
  storedAccountUserID,
  listKeyLibraries,
  makeRequestPause,
  verifyKey,
  ZOTERO_API_BASE_URL,
} from "@zotlit/web-library";
import type {
  AppliedLibrary as AppliedLibraryResult,
  ApplyStep,
  DownloadReport,
  RequestPause,
  WebApiFetch,
  WebLibrarySyncError,
} from "@zotlit/web-library";

import type { OpenClient } from "./connection.ts";
import {
  Connection,
  makeClientRef,
  makeDatabaseGenerations,
  webApiSourceIdentity,
} from "./connection.ts";
import { makeKeyPauses } from "./key-pauses.ts";
import { makeReadGate } from "./read-gate.ts";
import { plan, planAccount } from "./replica-plan.ts";
import type {
  SourceCommand,
  SourceEvent,
  SourceState,
} from "./web-api-machine.ts";
import {
  describe,
  errorOf,
  INITIAL,
  problemOfState,
  readState,
  transition,
  unconsentedOf,
} from "./web-api-machine.ts";

import { makeChangeFeed } from "#contract/change-feed.ts";
import { DbUnavailable } from "#contract/rpc.ts";
import { webApiSourceId } from "#contract/source-identity.ts";

export const REPLICA_FILE = "zotero-replica.sqlite";

export interface ApplySlicing {
  readonly pageSize: number;
  readonly sliceMillis: number;
  readonly dirtyBudgetBytes: number;
}

export const APPLY_SLICING: ApplySlicing = {
  pageSize: 50,
  sliceMillis: 8,
  dirtyBudgetBytes: 32 * 2 ** 20,
};

const UNBOUNDED_CACHE_KIB = 1_048_576;
const TRIM_CACHE_PAGES = 16;

export class WebLibrarySync extends Context.Service<
  WebLibrarySync,
  {
    readonly status: Effect.Effect<WebSyncStatus>;
    readonly removeReplica: Effect.Effect<void, DbUnavailable>;
  }
>()("zotlit/zotero-reads/WebLibrarySync") {}

export interface WebApiSourceOptions {
  readonly engine: Effect.Effect<SqliteWasm, DbUnavailable>;
  readonly fetch: WebApiFetch;
  readonly initial: WebApiReadsConfig;
  readonly file?: string;
  readonly holdBack?: Duration.Input;
  readonly slicing?: Partial<ApplySlicing>;
  readonly betweenSlices?: Effect.Effect<void>;
}

interface RunningSync {
  readonly done: Deferred.Deferred<void, DbUnavailable>;
  fiber?: Fiber.Fiber<void>;
  superseded?: boolean;
}

const logDebug = (message: string, annotations: Record<string, unknown> = {}) =>
  Effect.logDebug(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads", "web-api"),
  );

const logWarning = (
  message: string,
  annotations: Record<string, unknown> = {},
) =>
  Effect.logWarning(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads", "web-api"),
  );

function messageOf(cause: unknown): string {
  return Error.isError(cause) ? cause.message : String(cause);
}

export function problemOf(error: WebLibrarySyncError): WebSyncProblem {
  const { message } = error;
  switch (error._tag) {
    case "WebApiKeyInvalid":
      return { _tag: "key-invalid", message };
    case "WebApiNoAccess":
      return { _tag: "no-access", message };
    case "WebApiNetworkError":
      return { _tag: "network", message };
    case "WebApiRateLimited":
      return { _tag: "rate-limited", message };
    case "WebApiProtocolError":
      return { _tag: "protocol", message };
    case "ReplicaStorageError":
      return { _tag: "storage", reason: error.reason, message };
  }
}

function unavailableProblem(cause: DbUnavailable): WebSyncProblem {
  return { _tag: "storage", reason: "failed", message: cause.message };
}

function failedLibraries(report: DownloadReport): WebSyncProblem | null {
  for (const download of report.libraries) {
    if (
      download.outcome === "failed" &&
      download.error._tag === "ReplicaStorageError" &&
      download.error.reason === "full"
    )
      return problemOf(download.error);
  }
  const libraries = report.libraries.flatMap((download) =>
    download.outcome === "failed"
      ? [{ library: download.library, message: download.error.message }]
      : [],
  );
  if (libraries.length === 0) return null;
  return {
    _tag: "libraries-failed",
    message: libraries
      .map(
        ({ library, message }) => `${library.type} ${library.id}: ${message}`,
      )
      .join("; "),
    libraries,
  };
}

function synced(db: ZoteroDatabase): boolean {
  return readSyncStatus(db).some((library) => library.lastSync !== null);
}

function sameRemote(a: WebApiReadsConfig, b: WebApiReadsConfig): boolean {
  return (
    a.baseUrl === b.baseUrl &&
    Redacted.value(a.apiKey) === Redacted.value(b.apiKey)
  );
}

export function layerWebApiSource(
  options: WebApiSourceOptions,
): Layer.Layer<Connection | WebLibrarySync> {
  const file = options.file ?? REPLICA_FILE;
  return Layer.effectContext(
    Effect.gen(function* () {
      const lifetime = yield* Scope.Scope;
      const gate = yield* makeReadGate(options.holdBack);
      const lifecycle = yield* Semaphore.make(1);
      const settled = yield* Latch.make(false);
      const generations = makeDatabaseGenerations();
      let config = options.initial;
      let engine: SqliteWasm | null = null;
      const slicing = { ...APPLY_SLICING, ...options.slicing };
      const betweenSlices = options.betweenSlices ?? Effect.yieldNow;
      let handle: WasmDatabaseClient | null = null;
      let reader: WasmDatabaseClient | null = null;
      let writerExclusive = false;
      let lastLibraries: WebSyncStatus["libraries"] = [];
      let machine: SourceState = INITIAL;
      let running: RunningSync | null = null;
      let lastLocale: string | null = null;
      let rateWaitUntil = 0;
      const endpointPauses = new Map<string, RequestPause>();
      const keyPauses = makeKeyPauses();
      const kept = <K>(map: Map<K, RequestPause>, key: K) =>
        Effect.suspend(() => {
          const known = map.get(key);
          if (known) return Effect.succeed(known);
          return Effect.tap(makeRequestPause, (made) =>
            Effect.sync(() => map.set(key, made)),
          );
        });
      const pausesOf = (settings: WebApiReadsConfig) =>
        Effect.gen(function* () {
          const baseUrl = settings.baseUrl ?? ZOTERO_API_BASE_URL;
          return {
            endpoint: yield* kept(endpointPauses, baseUrl),
            credential: keyPauses.of(baseUrl, settings.apiKey),
          };
        });

      const { publish, changes } = yield* makeChangeFeed(() => [
        { _tag: "state", ...readState(machine) },
      ]);

      const run = (command: SourceCommand) => {
        switch (command._tag) {
          case "publish":
            return publish(command.event);
          case "admit":
            return command.open ? settled.open : settled.close;
          case "warn-sync-failed":
            return logWarning("Web Library sync failed", {
              problem: command.problem._tag,
            });
        }
      };
      const step = (event: SourceEvent) =>
        Effect.suspend(() => {
          const before = machine;
          const next = transition(before, event);
          machine = next.state;
          return Effect.andThen(
            event._tag === "progress"
              ? Effect.void
              : logDebug("Web Library source transition", {
                  machine: "web-api-source",
                  from: describe(before),
                  event: event._tag,
                  to: describe(next.state),
                }),
            Effect.forEach(next.commands, (command) => run(command), {
              discard: true,
            }),
          );
        });
      const progressTo = (progress: WebSyncStatus["progress"]) => {
        machine = transition(machine, { _tag: "progress", progress }).state;
      };

      const wrap = (db: ZoteroDatabase) =>
        Effect.gen(function* () {
          const open: OpenClient = { client: db, close: Effect.void };
          yield* generations.record(open, null);
          return open;
        });

      const current = Effect.suspend(() =>
        reader
          ? wrap(reader.db)
          : Effect.fail(
              errorOf(machine) ??
                new DbUnavailable({ message: "The replica is not open" }),
            ),
      );
      const clients = yield* makeClientRef(current);

      const openWriter = (loaded: SqliteWasm) => {
        const database = openWasmClient(loaded, { file, jit: true });
        try {
          database.exec(
            `pragma temp_store = memory; pragma cache_size = -${Math.floor(slicing.dirtyBudgetBytes / 1024)}`,
          );
          const empty =
            database.db.get("select 1 from sqlite_master limit 1") ===
            undefined;
          if (empty) createReplica(database.db);
          else ensureSyncTables(database.db);
          checkDatabaseLayout(database.db);
          return database;
        } catch (cause) {
          database.close();
          throw cause;
        }
      };

      const openHandle = Effect.gen(function* () {
        if (handle) return handle;
        engine ??= yield* Effect.mapError(options.engine, (cause) =>
          unavailableProblem(cause),
        );
        const loaded = engine;
        const kept = reader;
        const opened = yield* Effect.try({
          try: () => {
            const database = openWriter(loaded);
            let read: WasmDatabaseClient | undefined;
            try {
              read = kept ?? openWasmClient(loaded, { file, jit: true });
              if (!kept) read.exec("pragma temp_store = memory");
              return { writer: database, reader: read };
            } catch (cause) {
              if (!kept) read?.close();
              database.close();
              throw cause;
            }
          },
          catch: (cause): WebSyncProblem => ({
            _tag: "storage",
            ...describeStorageFailure("The replica could not open", cause),
          }),
        });
        handle = opened.writer;
        if (!kept) {
          reader = opened.reader;
          yield* clients.swap(
            yield* Effect.mapError(wrap(opened.reader.db), (cause) =>
              unavailableProblem(cause),
            ),
          );
        }
        return opened.writer;
      });

      const closeHandles = () => {
        lastLibraries = [];
        reader?.close();
        reader = null;
        handle?.close();
        handle = null;
      };

      const failOpen = (next: WebSyncProblem) =>
        Effect.as(
          step({ _tag: "open-failed", problem: next }),
          new DbUnavailable({ message: next.message }),
        );

      const storage = <A>(what: string, run: () => A) =>
        Effect.try({
          try: run,
          catch: (cause): WebSyncProblem => ({
            _tag: "storage",
            ...describeStorageFailure(what, cause),
          }),
        });

      const changedBy = (applied: readonly AppliedLibraryResult[]) =>
        applied.some((library) => library.changed);

      const applyStaged = (
        writer: WasmDatabaseClient,
        {
          building,
          locale,
          replacesLocale,
        }: {
          readonly building: boolean;
          readonly locale: string;
          readonly replacesLocale: boolean;
        },
      ) =>
        Effect.gen(function* () {
          const now = toInstant(yield* DateTime.now);
          const elapsed = monotonicMillis(yield* Clock.Clock);
          const budgetKiB = Math.floor(slicing.dirtyBudgetBytes / 1024);
          let open = false;
          let done: AppliedLibraryResult[] | null = null;
          const enterExclusive = storage(
            "The replica could not read its libraries",
            () => {
              if (reader) lastLibraries = readLibraries(reader.db);
              writerExclusive = true;
              writer.exec(`pragma cache_size = -${budgetKiB}`);
            },
          );
          const cleanUp = Effect.gen(function* () {
            progressTo(null);
            if (open) {
              open = false;
              const rolledBack = yield* Effect.result(
                storage("The replica could not roll back the apply", () => {
                  if (writer.inTransaction()) writer.exec("rollback");
                }),
              );
              if (rolledBack._tag === "Failure") {
                yield* Effect.sync(() => {
                  try {
                    writer.close();
                  } finally {
                    if (handle === writer) handle = null;
                    writerExclusive = false;
                  }
                });
                yield* logDebug(
                  "The replica closed its write connection after a failed rollback",
                  { problem: rolledBack.failure.message },
                );
                return yield* Effect.fail(rolledBack.failure);
              }
            }
            writerExclusive = false;
            yield* storage("The replica could not reset its write cache", () =>
              writer.exec(`pragma cache_size = -${budgetKiB}`),
            );
          });
          const slice = (steps: Iterator<ApplyStep, AppliedLibraryResult[]>) =>
            storage("The replica could not apply the download", () => {
              const start = elapsed();
              do {
                const next = steps.next();
                if (next.done) {
                  done = next.value;
                  return;
                }
                progressTo({
                  phase: "apply",
                  done: next.value.applied,
                  total: next.value.total,
                });
              } while (elapsed() - start < slicing.sliceMillis);
            });
          const overBudget = storage(
            "The replica could not measure the apply",
            () => {
              if (writer.cacheStatus().used <= slicing.dirtyBudgetBytes)
                return false;
              writer.exec(`pragma cache_size = ${TRIM_CACHE_PAGES}`);
              const dirty = writer.cacheStatus().used;
              writer.exec(`pragma cache_size = -${UNBOUNDED_CACHE_KIB}`);
              return dirty > slicing.dirtyBudgetBytes;
            },
          );
          const commit = Effect.gen(function* () {
            yield* storage("The replica could not commit the apply", () => {
              writer.exec("commit");
              open = false;
              writerExclusive = false;
            });
            const changed = building || changedBy(done!);
            if (changed) yield* swapReader;
            return changed;
          });
          const run = Effect.gen(function* () {
            if (building) yield* enterExclusive;
            const steps = yield* storage(
              "The replica could not begin the apply",
              () => {
                writer.exec(
                  `pragma cache_size = -${building ? budgetKiB : UNBOUNDED_CACHE_KIB}; begin immediate`,
                );
                open = true;
                return applyDownloadSteps(writer.db, {
                  now,
                  pageSize: slicing.pageSize,
                  locale,
                  replacesLocale,
                });
              },
            );
            const slices = (bounded: boolean) =>
              Effect.gen(function* () {
                while (done === null) {
                  yield* slice(steps);
                  if (done !== null) return false;
                  if (!bounded && (yield* overBudget)) return true;
                  yield* betweenSlices;
                }
                return false;
              });
            if (building)
              return yield* gate.exclusive(
                Effect.andThen(slices(true), commit),
              );
            const crossed = yield* slices(false);
            if (!crossed) return yield* gate.exclusive(commit);
            return yield* gate.exclusive(
              Effect.gen(function* () {
                yield* enterExclusive;
                yield* slices(true);
                return yield* commit;
              }),
            );
          });
          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const exit = yield* Effect.exit(restore(run));
              const cleaned = yield* Effect.exit(cleanUp);
              if (Exit.isSuccess(exit) && Exit.isFailure(cleaned))
                return yield* cleaned;
              return yield* exit;
            }),
          );
        });

      const swapReader = Effect.gen(function* () {
        const read = reader!;
        const renewed = yield* storage(
          "The replica could not renew its client",
          () => read.renew(),
        );
        const next = yield* Effect.mapError(wrap(renewed), (cause) =>
          unavailableProblem(cause),
        );
        yield* clients.swap(next);
        yield* step({ _tag: "committed" });
      }).pipe(Effect.uninterruptible);

      const settle = (
        event: SourceEvent & { readonly problem: WebSyncProblem },
      ) =>
        Effect.andThen(
          step(event),
          Effect.fail(new DbUnavailable({ message: event.problem.message })),
        );
      const refuse = (problem: WebSyncProblem) =>
        settle({ _tag: "refused", problem });

      const emptyReplica = Effect.gen(function* () {
        yield* step({ _tag: "emptied" });
        closeHandles();
        const loaded = engine;
        if (!loaded)
          return yield* Effect.fail<WebSyncProblem>({
            _tag: "storage",
            reason: "failed",
            message:
              "The replica could not be removed: the storage engine did not load",
          });
        yield* Effect.try({
          try: () => loaded.remove(file),
          catch: (cause): WebSyncProblem => ({
            _tag: "storage",
            ...describeStorageFailure(
              "The replica could not be removed",
              cause,
            ),
          }),
        });
        return yield* openHandle;
      });

      const failureOf = (cause: Cause.Cause<WebLibrarySyncError>) => {
        const failure = Cause.findErrorOption(cause);
        return failure._tag === "Some"
          ? problemOf(failure.value)
          : ({
              _tag: "storage",
              reason: "failed",
              message: messageOf(Cause.squash(cause)),
            } satisfies WebSyncProblem);
      };

      const syncOnce = Effect.gen(function* () {
        const settings = config;
        const zoteroLocale = settings.zoteroLocale ?? "en-US";
        const opened = yield* Effect.result(openHandle);
        if (opened._tag === "Failure")
          return yield* yield* failOpen(opened.failure);
        let database = opened.success;
        const facts = yield* Effect.result(
          storage("The replica could not read its libraries", () => ({
            storedUserID: storedAccountUserID(database.db),
            replicaLocale: replicaLocale(database.db),
            committed: synced(database.db),
          })),
        );
        if (facts._tag === "Failure") return yield* refuse(facts.failure);
        const verified = yield* Effect.exit(
          verifyKey({
            apiKey: settings.apiKey,
            fetch: options.fetch,
            baseUrl: settings.baseUrl,
            pauses: yield* pausesOf(settings),
            onWait: (until) => {
              rateWaitUntil = until;
            },
          }),
        );
        if (Exit.isFailure(verified)) {
          if (Cause.hasInterruptsOnly(verified.cause))
            return yield* Effect.interrupt;
          return yield* refuse(failureOf(verified.cause));
        }
        const account = {
          ...facts.success,
          keyUserID: verified.value.userID,
          consentedUserID: settings.consentedUserID,
        };
        const libraries =
          planAccount(account) === null
            ? yield* Effect.exit(listKeyLibraries(verified.value))
            : null;
        if (libraries !== null && Exit.isFailure(libraries)) {
          if (Cause.hasInterruptsOnly(libraries.cause))
            return yield* Effect.interrupt;
          return yield* refuse(failureOf(libraries.cause));
        }
        const decision = plan({
          ...account,
          readsLibraries: libraries === null || libraries.value.readsLibraries,
          zoteroLocale,
        });
        if (decision.kind === "await-consent") {
          yield* step({
            _tag: "awaiting-consent",
            keyUserID: decision.keyUserID,
            committed: facts.success.committed,
          });
          yield* logDebug("The Web Library sync waits for the account", {
            keyUserID: decision.keyUserID,
          });
          return;
        }
        if (decision.kind === "no-access")
          return yield* refuse({
            _tag: "no-access",
            message:
              "The API key cannot read the personal library or any group library",
          });
        if (decision.kind === "refuse")
          return yield* refuse({
            _tag: "account-changed",
            message: `The API key belongs to Zotero user ${decision.keyUserID}; the consented account is ${String(decision.consentedUserID)}, and the replica holds user ${String(decision.storedUserID)}`,
            consentedUserID: decision.consentedUserID,
            storedUserID: decision.storedUserID,
            keyUserID: decision.keyUserID,
          });
        if (decision.kind === "rebuild")
          yield* logDebug("The Web Library Replica downloads again", {
            reason: decision.reason,
            zoteroLocale,
          });
        if (decision.kind === "rebuild" && decision.reason === "account") {
          const emptied = yield* Effect.result(gate.exclusive(emptyReplica));
          if (emptied._tag === "Failure")
            return yield* yield* failOpen(emptied.failure);
          database = emptied.success;
        }
        const { db } = database;
        const replacing =
          decision.kind === "rebuild" && decision.reason === "language";
        const firstBuild =
          decision.kind === "first-build" ||
          (decision.kind === "rebuild" && !replacing);
        if (firstBuild) yield* step({ _tag: "build-started" });
        yield* logDebug("Web Library sync started", { firstBuild });
        const download = yield* Effect.exit(
          downloadReplica(db, {
            apiKey: settings.apiKey,
            fetch: options.fetch,
            baseUrl: settings.baseUrl,
            verified: libraries?.value ?? verified.value,
            rebuild: replacing,
            onProgress: (event) => {
              progressTo(event);
            },
          }),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              progressTo(null);
            }),
          ),
        );
        let next: WebSyncProblem | null;
        let changed = false;
        if (Exit.isFailure(download)) {
          if (Cause.hasInterruptsOnly(download.cause))
            return yield* Effect.interrupt;
          next = failureOf(download.cause);
        } else {
          const report = download.value;
          const building =
            firstBuild &&
            report.libraries.some((library) => library.outcome !== "failed");
          const replaces =
            replacing &&
            report.libraries.every((library) => library.outcome !== "failed");
          const work = building || (replacing ? replaces : report.needsApply);
          const applied = work
            ? yield* Effect.result(
                applyStaged(database, {
                  building,
                  locale: zoteroLocale,
                  replacesLocale: replaces,
                }),
              )
            : undefined;
          if (applied?._tag === "Failure") next = applied.failure;
          else {
            changed = applied?.success ?? false;
            next = failedLibraries(report);
          }
        }
        if (next)
          return yield* settle({
            _tag: "failed",
            problem: next,
            served: changed || !firstBuild,
          });
        yield* step({ _tag: "finished", changed });
        yield* logDebug("Web Library sync finished", { changed });
      }).pipe(lifecycle.withPermits(1));

      const startSync = Effect.uninterruptible(
        Effect.gen(function* () {
          if (running) return running;
          const done = Deferred.makeUnsafe<void, DbUnavailable>();
          const entry: RunningSync = { done };
          running = entry;
          yield* step({ _tag: "sync-started" });
          entry.fiber = yield* syncOnce.pipe(
            Effect.onExit((exit) =>
              Effect.gen(function* () {
                running = null;
                rateWaitUntil = 0;
                yield* step({ _tag: "sync-ended" });
                yield* Deferred.done(
                  done,
                  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                    ? Exit.fail(
                        new DbUnavailable({
                          message: "The sync stopped before it finished",
                        }),
                      )
                    : exit,
                );
              }),
            ),
            Effect.ignore,
            Effect.forkIn(lifetime),
          );
          return entry;
        }),
      );

      const refresh = Effect.gen(function* () {
        for (;;) {
          const entry = yield* startSync;
          const exit = yield* Effect.exit(Deferred.await(entry.done));
          if (Exit.isFailure(exit) && entry.superseded) continue;
          return yield* exit;
        }
      });

      const admit = Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          while (true) {
            yield* restore(settled.await);
            const { state } = readState(machine);
            if (state === "degraded")
              return yield* (
                errorOf(machine) ??
                new DbUnavailable({ message: "The replica is not available" })
              );
            if (state !== "ready") continue;
            const entry = yield* Scope.make();
            yield* restore(Scope.provide(gate.enter, entry)).pipe(
              Effect.onInterrupt(() => Scope.close(entry, Exit.void)),
            );
            if (readState(machine).state === "ready") {
              yield* Effect.addFinalizer(() => Scope.close(entry, Exit.void));
              return;
            }
            yield* Scope.close(entry, Exit.void);
          }
        }),
      );

      const borrow = Effect.andThen(admit, clients.borrow);

      const removeReplica = Effect.gen(function* () {
        const before = running;
        if (before?.fiber) yield* Fiber.interrupt(before.fiber);
        const removed = yield* Effect.exit(
          gate.exclusive(emptyReplica).pipe(
            lifecycle.withPermits(1),
            Effect.catch((next) =>
              Effect.flatMap(failOpen(next), (error) => Effect.fail(error)),
            ),
          ),
        );
        if (Exit.isFailure(removed)) return yield* removed;
        yield* logDebug("Web Library Replica removed");
      }).pipe(Effect.withSpan("WebLibrarySync.removeReplica"));

      const configure = (next: ReadsConfig) =>
        Effect.gen(function* () {
          if (next.source !== "web-api") {
            yield* logWarning(
              "Ignored a database file configuration on the Web API source",
            );
            return;
          }
          const before = config;
          config = next;
          if (
            sameRemote(before, next) &&
            before.zoteroLocale === next.zoteroLocale &&
            before.consentedUserID === next.consentedUserID
          )
            return;
          const stale = running;
          if (stale?.fiber) {
            stale.superseded = true;
            yield* Fiber.interrupt(stale.fiber);
          }
          yield* Effect.forkIn(Effect.ignore(refresh), lifetime);
        });

      const status = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (reader && !writerExclusive) {
          const { db } = reader;
          const read = yield* Effect.result(
            storage("The replica could not read its libraries", () =>
              readLibraries(db),
            ),
          );
          if (read._tag === "Success") lastLibraries = read.success;
          const built = yield* Effect.result(
            storage("The replica could not read its language", () =>
              replicaLocale(db),
            ),
          );
          if (built._tag === "Success") lastLocale = built.success;
        }
        return {
          state: readState(machine).state,
          syncing: machine.activity.kind === "syncing",
          waitingForReaders: gate.waiting(),
          problem: problemOfState(machine),
          progress:
            machine.activity.kind === "syncing"
              ? machine.activity.progress
              : null,
          zoteroLocale: lastLocale,
          unconsentedUserID: unconsentedOf(machine),
          ...(rateWaitUntil > now && {
            rateWaitUntil: toInstant(DateTime.makeUnsafe(rateWaitUntil)),
          }),
          libraries: lastLibraries,
        } satisfies WebSyncStatus;
      });

      const readLibraries = (db: ZoteroDatabase): WebSyncStatus["libraries"] =>
        readSyncStatus(db).flatMap((library) =>
          library.state === "remove"
            ? []
            : [
                {
                  library: library.library,
                  committedVersion: library.committedVersion,
                  lastSync: library.lastSync,
                  retained: library.retained,
                },
              ],
        );

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closeHandles();
          engine?.close();
          engine = null;
        }),
      );

      const opened = yield* Effect.result(openHandle);
      if (opened._tag === "Failure")
        yield* Effect.asVoid(failOpen(opened.failure));
      else
        yield* step({ _tag: "opened", committed: synced(opened.success.db) });
      yield* startSync;

      return Context.make(
        Connection,
        Connection.of({
          borrow,
          changes,
          refresh,
          notifyExternalChange: Effect.void,
          configure,
          databaseGeneration: generations.databaseGeneration,
          identity: webApiSourceIdentity,
          pendingIdentity: Effect.sync(() =>
            readState(machine).state === "loading"
              ? {
                  kind: "web-api" as const,
                  id: webApiSourceId(null),
                  userID: null,
                  username: null,
                }
              : null,
          ),
        }),
      ).pipe(
        Context.add(
          WebLibrarySync,
          WebLibrarySync.of({ status, removeReplica }),
        ),
      );
    }),
  );
}
