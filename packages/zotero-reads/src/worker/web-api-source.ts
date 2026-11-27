import type { ReadsConfig, WebApiReadsConfig } from "#contract/rpc.ts";
import type {
  WebSyncProblem,
  WebSyncProgress,
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
  Layer,
  PubSub,
  Redacted,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";

import type { ZoteroDatabase } from "@zotlit/db";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
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
  DownloadReport,
  RemoteLibrary,
  RequestPause,
  WebApiFetch,
  WebLibrarySyncError,
} from "@zotlit/web-library";

import { Connection, webApiSourceIdentity } from "./connection.ts";
import { makeKeyPauses } from "./key-pauses.ts";
import type { ReplicaDriver } from "./replica-driver.ts";
import { plan, planAccount } from "./replica-plan.ts";
import type { Readable, ReplicaObserver } from "./replica-store.ts";
import { APPLY_SLICE_MILLIS, makeReplicaStore } from "./replica-store.ts";
import type {
  SourceCommand,
  SourceEvent,
  SourceState,
} from "./web-api-machine.ts";
import {
  describe,
  INITIAL,
  problemOfState,
  readState,
  transition,
  unconsentedOf,
} from "./web-api-machine.ts";

import { makeChangeFeed } from "#contract/change-feed.ts";
import { DbUnavailable } from "#contract/rpc.ts";
import { webApiSourceId } from "#contract/source-identity.ts";
import { REPLICA_FILE } from "#contract/web-worker.ts";

export interface ApplySlicing {
  readonly pageSize: number;
  readonly sliceMillis: number;
}

export const APPLY_SLICING: ApplySlicing = {
  pageSize: 50,
  sliceMillis: APPLY_SLICE_MILLIS,
};

export class WebLibrarySync extends Context.Service<
  WebLibrarySync,
  {
    readonly status: Effect.Effect<WebSyncStatus>;
    readonly removeReplica: Effect.Effect<void, DbUnavailable>;
    readonly progress: Stream.Stream<WebSyncProgress | null>;
    stopSync(syncId: number): Effect.Effect<boolean>;
  }
>()("zotlit/zotero-reads/WebLibrarySync") {}

export interface WebApiSourceOptions {
  readonly driver: Effect.Effect<ReplicaDriver, DbUnavailable>;
  readonly fetch: WebApiFetch;
  readonly initial: WebApiReadsConfig;
  readonly file?: string;
  readonly holdBack?: Duration.Input;
  readonly slicing?: Partial<ApplySlicing>;
  readonly betweenSlices?: Effect.Effect<void>;
  readonly observer?: ReplicaObserver;
}

interface RunningSync {
  readonly id: number;
  readonly done: Deferred.Deferred<void, DbUnavailable>;
  fiber?: Fiber.Fiber<void>;
  superseded?: boolean;
  applying?: boolean;
  stopped?: boolean;
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

const libraryKey = ({ type, id }: RemoteLibrary): string => `${type}:${id}`;

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
      const lifecycle = yield* Semaphore.make(1);
      let config = options.initial;
      const slicing = { ...APPLY_SLICING, ...options.slicing };
      let machine: SourceState = INITIAL;
      let running: RunningSync | null = null;
      let lastSyncId = 0;
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

      const readable = yield* SubscriptionRef.make<Readable>(
        readState(machine),
      );
      const store = yield* makeReplicaStore({
        driver: options.driver,
        file,
        readable,
        onUnavailable: (problem) => step({ _tag: "open-failed", problem }),
        holdBack: options.holdBack,
        sliceMillis: slicing.sliceMillis,
        betweenSlices: options.betweenSlices,
        observer: options.observer,
      });

      const { publish, changes } = yield* makeChangeFeed(() => [
        { _tag: "state", ...readState(machine) },
      ]);

      const run = (command: SourceCommand) => {
        switch (command._tag) {
          case "publish":
            return publish(command.event);
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
            SubscriptionRef.set(readable, readState(machine)),
            Effect.andThen(
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
            ),
          );
        });
      const progressFeed = yield* PubSub.unbounded<WebSyncProgress | null>({
        replay: 1,
      });
      yield* Effect.addFinalizer(() => PubSub.shutdown(progressFeed));
      const progressTo = (progress: WebSyncProgress | null) => {
        machine = transition(machine, { _tag: "progress", progress }).state;
        PubSub.publishUnsafe(progressFeed, progress);
      };

      const unavailableError = (problem: WebSyncProblem) =>
        new DbUnavailable({ message: problem.message });

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

      const applyStaged = ({
        building,
        locale,
        replacesLocale,
      }: {
        readonly building: boolean;
        readonly locale: string;
        readonly replacesLocale: boolean;
      }) =>
        Effect.gen(function* () {
          if (running) running.applying = true;
          const now = toInstant(yield* DateTime.now);
          return yield* store.apply({
            steps: (db) =>
              applyDownloadSteps(db, {
                now,
                pageSize: slicing.pageSize,
                locale,
                replacesLocale,
              }),
            visible: (applied) => building || changedBy(applied),
            onProgress: (next) =>
              progressTo({
                phase: "apply",
                done: next.applied,
                total: next.total,
              }),
            onWaiting: () => progressTo({ phase: "waiting" }),
            onCommit: step({ _tag: "committed" }),
          });
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              progressTo(null);
            }),
          ),
        );

      const settle = (
        event: SourceEvent & { readonly problem: WebSyncProblem },
      ) =>
        Effect.andThen(
          store.report().state === "unavailable" ? Effect.void : step(event),
          Effect.fail(new DbUnavailable({ message: event.problem.message })),
        );
      const refuse = (problem: WebSyncProblem) =>
        settle({ _tag: "refused", problem });

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
        const opened = yield* Effect.result(store.open);
        if (opened._tag === "Failure")
          return yield* unavailableError(opened.failure);
        const facts = yield* Effect.result(
          storage("The replica could not read its libraries", () =>
            store.stage((db) => ({
              storedUserID: storedAccountUserID(db),
              replicaLocale: replicaLocale(db),
              committed: synced(db),
            })),
          ),
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
          const emptied = yield* Effect.result(
            store.empty(step({ _tag: "emptied" })),
          );
          if (emptied._tag === "Failure")
            return yield* unavailableError(emptied.failure);
        }
        const replacing =
          decision.kind === "rebuild" && decision.reason === "language";
        const firstBuild =
          decision.kind === "first-build" ||
          (decision.kind === "rebuild" && !replacing);
        if (firstBuild) yield* step({ _tag: "build-started" });
        yield* logDebug("Web Library sync started", { firstBuild });
        const counts = new Map<string, number>();
        const downloaded = new Map<string, Map<string, number>>();
        let planned: readonly string[] = [];
        const reportDownload = () => {
          let done = 0;
          for (const phases of downloaded.values())
            for (const count of phases.values()) done += count;
          let total = 0;
          for (const count of counts.values()) total += count;
          progressTo({
            phase: "download",
            done,
            total: planned.every((key) => counts.has(key)) ? total : null,
          });
        };
        const download = yield* Effect.exit(
          downloadReplica(store.stage, {
            apiKey: settings.apiKey,
            fetch: options.fetch,
            baseUrl: settings.baseUrl,
            verified: libraries?.value ?? verified.value,
            rebuild: replacing,
            onLibraries: (listed) => {
              planned = listed.map((library) => libraryKey(library));
            },
            onLibraryCount: (count) => {
              const key = libraryKey(count.library);
              downloaded.delete(key);
              if (count.count === "known") counts.set(key, count.total);
              else counts.delete(key);
              reportDownload();
            },
            onProgress: ({ library, phase, done }) => {
              const key = libraryKey(library);
              const phases = downloaded.get(key) ?? new Map<string, number>();
              phases.set(phase, done);
              downloaded.set(key, phases);
              reportDownload();
            },
          }),
        ).pipe(
          Effect.ensuring(
            Effect.andThen(
              Effect.sync(() => {
                progressTo(null);
              }),
              store.downloadEnded,
            ),
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
                applyStaged({
                  building,
                  locale: zoteroLocale,
                  replacesLocale: replaces,
                }),
              )
            : undefined;
          if (applied?._tag === "Failure") {
            next = applied.failure;
          } else {
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
        if (store.report().state === "unavailable")
          return yield* new DbUnavailable({
            message: "The replica is not available",
          });
        yield* step({ _tag: "finished", changed });
        yield* logDebug("Web Library sync finished", { changed });
      }).pipe(lifecycle.withPermits(1));

      const startSync = Effect.uninterruptible(
        Effect.gen(function* () {
          if (running) return running;
          const done = Deferred.makeUnsafe<void, DbUnavailable>();
          const entry: RunningSync = { id: ++lastSyncId, done };
          running = entry;
          yield* step({ _tag: "sync-started" });
          entry.fiber = yield* syncOnce.pipe(
            Effect.onExit((exit) =>
              Effect.gen(function* () {
                running = null;
                rateWaitUntil = 0;
                if (
                  entry.stopped &&
                  Exit.isFailure(exit) &&
                  Cause.hasInterruptsOnly(exit.cause)
                )
                  yield* step({ _tag: "stopped" });
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
            Effect.forkIn(lifetime, { startImmediately: true }),
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

      const removeReplica = Effect.gen(function* () {
        const before = running;
        if (before?.fiber) yield* Fiber.interrupt(before.fiber);
        const removed = yield* Effect.exit(
          store.remove(step({ _tag: "emptied" })).pipe(
            lifecycle.withPermits(1),
            Effect.mapError((problem) => unavailableError(problem)),
          ),
        );
        if (Exit.isFailure(removed)) return yield* removed;
        yield* logDebug("Web Library Replica removed");
      }).pipe(Effect.withSpan("WebLibrarySync.removeReplica"));

      const stopSync = (syncId: number) =>
        Effect.suspend(() => {
          const entry = running;
          if (
            entry?.id !== syncId ||
            !entry.fiber ||
            entry.applying ||
            entry.superseded
          )
            return Effect.as(
              logDebug("The Web Library sync did not stop: no download runs", {
                syncId,
                running: entry?.id ?? null,
                applying: entry?.applying ?? false,
              }),
              false,
            );
          entry.stopped = true;
          return Effect.as(
            Effect.andThen(
              Fiber.interrupt(entry.fiber),
              logDebug("The Web Library sync stopped on request"),
            ),
            true,
          );
        }).pipe(Effect.withSpan("WebLibrarySync.stopSync"));

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
        const read = yield* Effect.result(store.libraries);
        const { lastApply, fileProblem, waitingForReaders } = store.report();
        const committed =
          read._tag === "Success"
            ? read.success
            : { libraries: [], zoteroLocale: null };
        return {
          state: readState(machine).state,
          syncing: machine.activity.kind === "syncing",
          syncId: running?.id ?? null,
          waitingForReaders,
          problem:
            read._tag === "Failure" ? read.failure : problemOfState(machine),
          progress:
            machine.activity.kind === "syncing"
              ? machine.activity.progress
              : null,
          zoteroLocale: committed.zoteroLocale,
          unconsentedUserID: unconsentedOf(machine),
          ...(rateWaitUntil > now && {
            rateWaitUntil: toInstant(DateTime.makeUnsafe(rateWaitUntil)),
          }),
          libraries: committed.libraries,
          ...(lastApply && { lastApply }),
          ...(fileProblem && { fileProblem }),
        } satisfies WebSyncStatus;
      });

      const opened = yield* Effect.result(store.open);
      if (opened._tag === "Success")
        yield* step({
          _tag: "opened",
          committed: store.stage((db) => synced(db)),
        });
      yield* startSync;

      return Context.make(
        Connection,
        Connection.of({
          borrow: store.borrow,
          changes,
          refresh,
          notifyExternalChange: Effect.void,
          configure,
          databaseGeneration: store.databaseGeneration,
          identity: webApiSourceIdentity,
          pendingIdentity: Effect.sync(() => {
            if (readState(machine).state === "loading")
              return {
                kind: "web-api" as const,
                id: webApiSourceId(null),
                userID: null,
                username: null,
              };
            const { state, committed } = store.report();
            return state === "applying" || state === "publishing"
              ? committed.identity
              : null;
          }),
        }),
      ).pipe(
        Context.add(
          WebLibrarySync,
          WebLibrarySync.of({
            status,
            removeReplica,
            progress: Stream.unwrap(
              Effect.map(PubSub.subscribe(progressFeed), (subscription) =>
                Stream.fromSubscription(subscription),
              ),
            ),
            stopSync,
          }),
        ),
      );
    }),
  );
}
