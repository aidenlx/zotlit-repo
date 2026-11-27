import type {} from "#core/database/settings.ts";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  PubSub,
  Queue,
  Redacted,
  Ref,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { RpcClient, RpcClientError } from "effect/rpc";
import type { SecretStorage } from "obsidian";

import { sameSegmenterBinary } from "@zotlit/item-lookup";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { PackBinaryRefusal } from "@zotlit/resource-pack/status.ts";
import {
  settledOnStop,
  stoppedErrors,
} from "@zotlit/zotero-reads/client/settle-on-stop.ts";
import type { WebApiReadsConfig } from "@zotlit/zotero-reads/contract/rpc.ts";
import {
  DbUnavailable,
  ZOTERO_WEB_API_URL,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import type {
  WebSyncProgress,
  WebSyncStatus,
} from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";
import { ZoteroReadsWeb } from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";
import { ZOTERO_SCHEMA_VERSION } from "@zotlit/zotero-types/vocabulary";

import { makeConsent } from "./consent.ts";
import { effectiveZoteroLanguage } from "./language.ts";
import { makeReadsFacade, unavailable } from "./reads-facade.ts";
import { runSyncSchedule } from "./schedule.ts";
import type { LibrarySourceView, OnlineLibraryStatus } from "./status.ts";
import { formatSyncTime, runningSyncOf, statusText, viewOf } from "./status.ts";
import type {
  OtherDataRefused,
  ReplicaFolderRefused,
} from "./stored-replica.ts";
import { makeSyncRuns, refreshOutcome } from "./sync-run.ts";
import type {
  LibrarySourceKind,
  OtherDataView,
  OtherStoredReplicas,
  ZoteroLanguage,
} from "./tag.ts";
import { LibrarySource } from "./tag.ts";

import { segmenterBinaryOf } from "#obsidian/chinese-segmenter/service.ts";
import { ResourcePackPlatform } from "#obsidian/managed-binary/pack-platform.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

export { LibrarySource } from "./tag.ts";
export type {
  LibrarySourceKind,
  OtherDataScope,
  OtherDataView,
  OtherStoredReplicas,
} from "./tag.ts";
export type { LibrarySourceView } from "./status.ts";

export const LIBRARY_SOURCE_KEY = "zotlit-library-source";
export const PROGRESS_INTERVAL = "250 millis";
export const WEB_API_KEY_SECRET_KEY = "zotlit-zotero-web-api-key-secret";

export type WebReadsClient = RpcClient.FromGroup<
  typeof ZoteroReadsWeb,
  RpcClientError.RpcClientError
>;

export type WebStart =
  | { readonly kind: "ready"; readonly client: WebReadsClient }
  | PackBinaryRefusal
  | { readonly kind: "code-unreadable" };

export interface LibrarySourcePorts {
  startWeb(
    config: WebApiReadsConfig,
  ): Effect.Effect<WebStart, never, Scope.Scope>;
  readonly poolDirectory: Effect.Effect<string>;
  readonly systemLanguage: Effect.Effect<string | null>;
  readonly focused: Stream.Stream<boolean>;
  readonly secrets: Pick<SecretStorage, "getSecret">;
  readonly webApiUrlOverride?: Effect.Effect<unknown>;
  readonly serverSchemaVersion?: (
    baseUrl: string,
  ) => Effect.Effect<number | null, unknown>;
  readonly removesReplicaFolder: boolean;
  removeStoredReplica(
    poolDirectory: string,
  ): Effect.Effect<void, DbUnavailable | ReplicaFolderRefused>;
  readonly otherStoredReplicas: Effect.Effect<
    OtherStoredReplicas,
    DbUnavailable
  >;
  removeOtherStoredReplica(
    id: string,
  ): Effect.Effect<void, DbUnavailable | OtherDataRefused>;
  readonly reload: Effect.Effect<void>;
}

type WebConfig = WebApiReadsConfig & {
  readonly zoteroLocale: string;
  readonly baseUrl: string;
};

interface Running {
  readonly scope: Scope.Closeable;
  readonly client: WebReadsClient;
  readonly worker: WebReadsClient;
  readonly stopReads: Effect.Effect<void>;
  config: WebConfig;
  account: string | null;
  checked: { readonly key: string; readonly sync: WebSyncStatus } | null;
}

const keyOf = (now: Running) => Redacted.value(now.config.apiKey);

const replaceTargetOf = (now: Running | null): number | null => {
  const checked = now?.checked;
  const problem = checked?.sync.problem;
  return now &&
    checked?.key === keyOf(now) &&
    problem?._tag === "account-changed"
    ? problem.keyUserID
    : null;
};

const KEY_PROBLEMS = new Set(["key-invalid", "no-access", "account-changed"]);

const textOf = (status: OnlineLibraryStatus) =>
  statusText(status, formatSyncTime);

const typedExit = <A, E>(
  exit: Exit.Exit<A, E>,
  stopped: () => DbUnavailable,
): Exit.Exit<A, E | DbUnavailable> => {
  if (Exit.isSuccess(exit)) return exit;
  const failure = Cause.findErrorOption(exit.cause);
  return failure._tag === "Some"
    ? Exit.fail(failure.value)
    : Exit.fail(stopped());
};

const asUnavailable = <A, R>(
  effect: Effect.Effect<A, DbUnavailable | RpcClientError.RpcClientError, R>,
): Effect.Effect<A, DbUnavailable, R> =>
  Effect.mapError(effect, (error) =>
    error instanceof DbUnavailable
      ? error
      : new DbUnavailable({ message: error.message }),
  );

function sameConfig(a: WebApiReadsConfig, b: WebApiReadsConfig): boolean {
  return (
    Redacted.value(a.apiKey) === Redacted.value(b.apiKey) &&
    a.baseUrl === b.baseUrl &&
    a.poolDirectory === b.poolDirectory &&
    a.zoteroLocale === b.zoteroLocale &&
    a.locale === b.locale &&
    a.logLevel === b.logLevel &&
    a.consentedUserID === b.consentedUserID &&
    sameSegmenterBinary(a.chineseSegmenter, b.chineseSegmenter)
  );
}

export const layerLibrarySource = (
  ports: LibrarySourcePorts,
): Layer.Layer<
  LibrarySource,
  never,
  DeviceStorage | PluginSettings | ResourcePackPlatform | ObsidianEnv
> =>
  Layer.effect(
    LibrarySource,
    Effect.gen(function* () {
      const storage = yield* DeviceStorage;
      const settings = yield* PluginSettings;
      const pack = yield* ResourcePackPlatform;
      const env = yield* ObsidianEnv;
      const lifetime = yield* Scope.Scope;

      const load = (key: string) =>
        storage
          .load(key)
          .pipe(
            Effect.catch((error) =>
              Effect.as(
                Effect.logWarning(
                  "A device record of the library source is unreadable",
                ).pipe(Effect.annotateLogs({ key, error: error.message })),
                null,
              ),
            ),
          );
      const strictSave = (key: string, value: unknown) =>
        storage
          .save(key, value)
          .pipe(
            Effect.mapError(() =>
              unavailable(m.settings_online_record_unsaved()),
            ),
          );
      const consent = makeConsent(storage);
      const kindOf = (raw: unknown): LibrarySourceKind =>
        raw === "web-api" ? "web-api" : "file";

      const active = kindOf(yield* load(LIBRARY_SOURCE_KEY));
      let selected = active;
      let running: Running | null = null;
      let shown: OnlineLibraryStatus =
        active === "file" ? { kind: "file-source" } : { kind: "starting" };
      let removalsRequested = 0;
      let removalActive = yield* Effect.orElseSucceed(
        consent.removalPending,
        () => false,
      );
      const runs = makeSyncRuns<WebReadsClient>({
        stopped: () => stopped(),
        changed: Effect.suspend(() => showView),
      });
      const viewNow = () =>
        viewOf({
          selected,
          status: shown,
          replace: replaceTargetOf(running),
          removal: removalActive || removalsRequested > 0,
          stop: runs.view(running?.client ?? null, runningSyncOf(shown)),
        });
      const view = yield* SubscriptionRef.make<LibrarySourceView>(viewNow());
      yield* Effect.addFinalizer(() => PubSub.shutdown(view.pubsub));
      const showView: Effect.Effect<void> = Effect.suspend(() =>
        SubscriptionRef.set(view, viewNow()),
      );
      const status = {
        get: Effect.sync(() => shown),
        set: (next: OnlineLibraryStatus) =>
          Effect.suspend(() => {
            shown = next;
            return showView;
          }),
        update: (
          change: (before: OnlineLibraryStatus) => OnlineLibraryStatus,
        ) =>
          Effect.suspend(() => {
            shown = change(shown);
            return showView;
          }),
      };
      const facade =
        active === "web-api"
          ? yield* makeReadsFacade(unavailable(textOf({ kind: "starting" })))
          : null;
      let serverSchemaVersion: number | null = null;

      interface Operation {
        readonly run: Effect.Effect<unknown, DbUnavailable>;
        readonly done: Deferred.Deferred<unknown, DbUnavailable>;
        readonly bound: Running | null | undefined;
      }
      const operations = yield* Queue.unbounded<Operation>();
      const queued = new Set<Operation>();
      const stopped = () => unavailable(textOf({ kind: "stopped" }));

      let closed = false;
      const enqueue = <A>(
        run: Effect.Effect<A, DbUnavailable>,
        bound?: Running | null,
      ): Effect.Effect<A, DbUnavailable> =>
        Effect.suspend(() => {
          if (closed) return Effect.fail(stopped());
          const done = Deferred.makeUnsafe<A, DbUnavailable>();
          const operation: Operation = {
            run,
            done: done as Deferred.Deferred<unknown, DbUnavailable>,
            bound,
          };
          queued.add(operation);
          return Effect.andThen(
            Queue.offer(operations, operation),
            Deferred.await(done),
          );
        });

      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            const operation = yield* Queue.take(operations);
            const superseded =
              operation.bound !== undefined && operation.bound !== running;
            const exit = superseded
              ? Exit.fail(stopped())
              : yield* Effect.exit(operation.run);
            queued.delete(operation);
            yield* Deferred.done(operation.done, typedExit(exit, stopped));
          }),
        ),
        { startImmediately: true },
      );
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          closed = true;
          for (const operation of queued)
            yield* Deferred.fail(operation.done, stopped());
          queued.clear();
          yield* Queue.shutdown(operations);
        }),
      );

      const keySecret = Effect.map(load(WEB_API_KEY_SECRET_KEY), (name) =>
        typeof name === "string" && name ? name : null,
      );
      const readKey = Effect.gen(function* () {
        const name = yield* keySecret;
        if (!name) return null;
        return yield* Effect.try(
          () => ports.secrets.getSecret(name)?.trim() || null,
        ).pipe(
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("Obsidian's keychain refused to answer").pipe(
                Effect.annotateLogs({ error: String(error.cause) }),
              ),
              null,
            ),
          ),
        );
      });

      const language = Effect.gen(function* () {
        const setting = (yield* settings.current)["zotero.language"];
        const automatic = effectiveZoteroLanguage(
          "auto",
          yield* ports.systemLanguage,
        );
        return {
          setting,
          automatic,
          effective: setting === "auto" ? automatic : setting,
        } satisfies ZoteroLanguage;
      }).pipe(Effect.withSpan("LibrarySource.language"));

      const baseUrl =
        __DEV__ && ports.webApiUrlOverride
          ? Effect.gen(function* () {
              const url = yield* ports.webApiUrlOverride!;
              if (typeof url !== "string" || !url) return ZOTERO_WEB_API_URL;
              yield* Effect.logWarning(
                "A development build sends the online library requests to another address",
              ).pipe(Effect.annotateLogs({ baseUrl: url }));
              return url;
            })
          : Effect.succeed(ZOTERO_WEB_API_URL);

      const configOf = Effect.fn("LibrarySource.configOf")(function* (
        apiKey: Redacted.Redacted<string>,
        url: string,
      ) {
        const current = yield* settings.current;
        const consented = yield* consent.current;
        return {
          ...(consented === null ? {} : { consentedUserID: consented }),
          source: "web-api",
          apiKey,
          baseUrl: url,
          poolDirectory: yield* ports.poolDirectory,
          zoteroLocale: (yield* language).effective,
          locale: env.language,
          chineseSegmenter: yield* segmenterBinaryOf(pack),
          logLevel: current["log.level"],
        } satisfies WebConfig;
      });

      const stop = Effect.suspend(() => {
        const before = running;
        running = null;
        if (before) runs.detach(before.client);
        return before
          ? Effect.andThen(Scope.close(before.scope, Exit.void), showView)
          : Effect.void;
      });

      const halt = (next: OnlineLibraryStatus) =>
        Effect.gen(function* () {
          const quiet = running === null;
          if (!facade || (quiet && textOf(shown) === textOf(next))) {
            yield* stop;
            return false;
          }
          yield* status.set(next);
          yield* facade.absent(unavailable(textOf(next)));
          yield* stop;
          return true;
        });
      const noKey = halt({ kind: "no-key" });
      const deviceRecord = (cause: Cause.Cause<DbUnavailable>) => {
        const failure = Cause.findErrorOption(cause);
        return failure._tag === "Some"
          ? Effect.asVoid(
              halt({ kind: "device-record", message: failure.value.message }),
            )
          : Effect.void;
      };

      const showAccount = Effect.suspend(() => {
        const now = running;
        return now
          ? status.update((before) =>
              before.kind === "running"
                ? { ...before, account: now.account }
                : before,
            )
          : Effect.void;
      });

      const poll = (client: WebReadsClient) =>
        Effect.gen(function* () {
          const poke = yield* Queue.sliding<void>(1);
          yield* Stream.runForEach(client.Changes(), () =>
            Queue.offer(poke, undefined),
          ).pipe(Effect.ignore, Effect.forkScoped({ startImmediately: true }));
          const pushed = yield* Ref.make<WebSyncProgress | null | undefined>(
            undefined,
          );
          const latest = yield* Queue.sliding<WebSyncProgress | null>(1);
          yield* Stream.runForEach(client.SyncProgress(), (progress) =>
            Queue.offer(latest, progress),
          ).pipe(Effect.ignore, Effect.forkScoped({ startImmediately: true }));
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.gen(function* () {
                const progress = yield* Queue.take(latest);
                yield* Ref.set(pushed, progress);
                yield* status.update((before) =>
                  before.kind === "running" && running?.client === client
                    ? { ...before, sync: { ...before.sync, progress } }
                    : before,
                );
                yield* Effect.sleep(PROGRESS_INTERVAL);
              }),
            ),
            { startImmediately: true },
          );
          for (;;) {
            const polled = Exit.getSuccess(
              yield* Effect.exit(client.SyncStatus()),
            );
            const progress = yield* Ref.get(pushed);
            const sync =
              polled._tag === "Some" &&
              polled.value.syncing &&
              progress !== undefined
                ? Option.some({ ...polled.value, progress })
                : polled;
            const now = running;
            if (sync._tag === "Some" && now?.client === client) {
              const { problem } = sync.value;
              if (problem && KEY_PROBLEMS.has(problem._tag)) now.account = null;
              const target = replaceTargetOf(now);
              if (
                target !== null &&
                !sync.value.syncing &&
                !(
                  problem?._tag === "account-changed" &&
                  problem.keyUserID === target
                )
              )
                now.checked = null;
              yield* status.set({
                kind: "running",
                sync: sync.value,
                account: now.account,
                serverSchemaVersion,
              });
            }
            if (sync._tag === "Some" && sync.value.syncing)
              yield* Effect.timeoutOption(Queue.take(poke), "1 second");
            else yield* Queue.take(poke);
          }
        });

      const verified = (now: Running) =>
        Effect.gen(function* () {
          const identity = yield* Effect.option(now.client.SourceIdentity({}));
          if (identity._tag === "Some" && running === now) {
            now.account =
              identity.value.kind === "web-api"
                ? identity.value.username
                : null;
            yield* showAccount;
          }
        });

      const configureNow = (now: Running) =>
        Effect.gen(function* () {
          const next = yield* configOf(now.config.apiKey, now.config.baseUrl);
          if (sameConfig(next, now.config)) return;
          now.config = next;
          yield* now.client.Configure(next).pipe(Effect.ignore);
        });

      const checkSchema = (now: Running) =>
        ports.serverSchemaVersion
          ? Effect.gen(function* () {
              const version = yield* ports.serverSchemaVersion!(
                now.config.baseUrl,
              );
              const newer =
                version !== null && version > ZOTERO_SCHEMA_VERSION
                  ? version
                  : null;
              serverSchemaVersion = newer;
              yield* status.update((before) =>
                before.kind === "running"
                  ? { ...before, serverSchemaVersion: newer }
                  : before,
              );
              if (newer !== null)
                yield* Effect.logWarning(
                  "The Zotero server uses a newer schema than this ZotLit",
                ).pipe(
                  Effect.annotateLogs({
                    serverSchemaVersion: newer,
                    vendoredSchemaVersion: ZOTERO_SCHEMA_VERSION,
                  }),
                );
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.logDebug("The Zotero schema version is unknown", cause),
              ),
            )
          : Effect.void;

      const grantFirst = (now: Running, key: string, keyUserID: number) =>
        Effect.suspend(() =>
          keyOf(now) === key
            ? Effect.andThen(
                consent.grantFirst(keyUserID),
                configureNow(now),
              ).pipe(Effect.tapCause((cause) => deviceRecord(cause)))
            : Effect.void,
        );

      const refreshOnce = (now: Running, key: string) =>
        Effect.gen(function* () {
          const refreshed = yield* Effect.exit(
            asUnavailable(now.client.Refresh()),
          );
          const checked = yield* Effect.exit(
            asUnavailable(now.client.SyncStatus()),
          );
          if (Exit.isSuccess(checked) && keyOf(now) === key) {
            now.checked = { key, sync: checked.value };
            yield* showView;
          }
          return yield* refreshOutcome(refreshed, checked);
        });

      const beginSync = (now: Running) =>
        Effect.suspend(() => {
          const key = keyOf(now);
          return runs.begin({
            worker: now.client,
            key,
            scope: now.scope,
            refresh: Effect.gen(function* () {
              yield* Effect.forkIn(checkSchema(now), now.scope, {
                startImmediately: true,
              });
              const sync = yield* refreshOnce(now, key);
              if (sync.unconsentedUserID !== null) {
                yield* enqueue(
                  grantFirst(now, key, sync.unconsentedUserID),
                  now,
                );
                yield* refreshOnce(now, key);
              }
              yield* verified(now);
            }),
          });
        });

      const removeStored = Effect.gen(function* () {
        const now = running;
        if (now) yield* now.stopReads;
        const removed = now
          ? yield* Effect.exit(asUnavailable(now.worker.RemoveReplica()))
          : null;
        if (removed && Exit.isSuccess(removed) && !ports.removesReplicaFolder)
          return;
        yield* stop;
        yield* ports.removeStoredReplica(yield* ports.poolDirectory);
      });

      const removeAll = consent.remove({
        forgetKey: strictSave(WEB_API_KEY_SECRET_KEY, null),
        deleteReplica: Effect.andThen(removeStored, noKey),
      });
      const removal = Effect.gen(function* () {
        removalActive = true;
        yield* showView;
        const exit = yield* Effect.exit(removeAll);
        removalActive = Exit.isFailure(exit)
          ? yield* Effect.orElseSucceed(consent.removalPending, () => true)
          : false;
        yield* showView;
        return yield* exit;
      });

      const lost = (
        client: WebReadsClient,
        gone: Deferred.Deferred<DbUnavailable>,
      ) =>
        Effect.andThen(
          Deferred.succeed(gone, stopped()),
          Effect.forkIn(
            Effect.ignore(
              enqueue(
                Effect.suspend(() =>
                  running?.client === client
                    ? Effect.andThen(
                        Effect.logError(
                          "The online library Worker stopped answering",
                        ),
                        halt({ kind: "stopped" }),
                      )
                    : Effect.void,
                ),
              ),
            ),
            lifetime,
          ),
        );

      const launch = (
        reads: NonNullable<typeof facade>,
        scope: Scope.Closeable,
        config: WebConfig,
      ) =>
        Effect.gen(function* () {
          const started = yield* ports
            .startWeb(config)
            .pipe(Scope.provide(scope));
          if (started.kind !== "ready") {
            yield* Scope.close(scope, Exit.void);
            const changed = yield* halt(
              started.kind === "code-unreadable"
                ? { kind: "code-unreadable" }
                : { kind: "pack", refusal: started },
            );
            if (changed)
              yield* Effect.logWarning("The online library did not start").pipe(
                Effect.annotateLogs({
                  reason: started.kind,
                  ...(started.kind === "failed" && { detail: started.detail }),
                }),
              );
            return false;
          }
          const gone = yield* Deferred.make<DbUnavailable>();
          yield* Scope.addFinalizer(scope, Deferred.succeed(gone, stopped()));
          const client = settledOnStop(ZoteroReadsWeb, started.client, {
            stopped: gone,
            onStop: stoppedErrors(ZoteroReadsWeb),
            scope,
          });
          running = {
            scope,
            client,
            worker: started.client,
            stopReads: Effect.asVoid(Deferred.succeed(gone, stopped())),
            config,
            account: null,
            checked: null,
          };
          yield* status.set({ kind: "starting" });
          yield* reads
            .attach(
              { ...client, Changes: started.client.Changes },
              stopped(),
              Effect.asVoid(lost(client, gone)),
            )
            .pipe(Scope.provide(scope));
          yield* Effect.forkIn(poll(client).pipe(Effect.scoped), scope, {
            startImmediately: true,
          });
          yield* Effect.logInfo("The online library started");
          return true;
        });

      const start: Effect.Effect<boolean> = Effect.suspend(() => {
        const reads = facade;
        if (!reads || running) return Effect.succeed(false);
        return Effect.gen(function* () {
          const recorded = yield* Effect.exit(
            Effect.all([consent.removalPending, consent.current]),
          );
          if (Exit.isFailure(recorded))
            return yield* Effect.as(deviceRecord(recorded.cause), false);
          if (recorded.value[0]) {
            const removed = yield* Effect.exit(removal);
            if (Exit.isFailure(removed))
              return yield* Effect.as(halt({ kind: "stopped" }), false);
          }
          const key = yield* readKey;
          if (!key) return yield* Effect.as(noKey, false);
          const config = yield* configOf(Redacted.make(key), yield* baseUrl);
          const scope = yield* Scope.fork(lifetime);
          return yield* launch(reads, scope, config).pipe(
            Effect.onError((cause) =>
              Scope.close(scope, Exit.failCause(cause)),
            ),
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.as(
                  Effect.andThen(
                    Effect.logError("The online library did not start", cause),
                    halt({ kind: "stopped" }),
                  ),
                  false,
                ),
          ),
        );
      });

      const followKey: Effect.Effect<boolean> = Effect.gen(function* () {
        const pending = yield* Effect.exit(consent.removalPending);
        if (Exit.isFailure(pending))
          return yield* Effect.as(deviceRecord(pending.cause), false);
        if (pending.value) return yield* Effect.andThen(stop, start);
        const key = yield* readKey;
        if (!key) return yield* Effect.as(noKey, false);
        const now = running;
        if (!now) return yield* start;
        if (Redacted.value(now.config.apiKey) === key) return false;
        const configured = yield* Effect.exit(
          configOf(Redacted.make(key), now.config.baseUrl),
        );
        if (Exit.isFailure(configured))
          return yield* Effect.as(deviceRecord(configured.cause), false);
        const next = configured.value;
        now.config = next;
        now.account = null;
        now.checked = null;
        runs.supersede(now.client);
        yield* showAccount;
        yield* now.client.Configure(next).pipe(Effect.ignore);
        yield* Effect.logInfo("The Zotero API key changed");
        yield* beginSync(now);
        return false;
      });

      const firstSync = (started: boolean) =>
        Effect.suspend(() => {
          const now = running;
          return started && now ? Effect.asVoid(beginSync(now)) : Effect.void;
        });

      const syncStep = (scheduled: boolean) =>
        Effect.gen(function* () {
          if (!facade) return;
          const joined = runs.current(running?.client ?? null);
          if (joined) return yield* Deferred.await(joined.done);
          const entry = yield* enqueue(
            Effect.gen(function* () {
              const refusal = (yield* status.get).kind;
              const waitsForEvent =
                running === null &&
                (refusal === "pack" || refusal === "code-unreadable");
              if (!(scheduled && waitsForEvent)) yield* followKey;
              const now = running;
              if (!now) return yield* unavailable(textOf(yield* status.get));
              return yield* beginSync(now);
            }),
          );
          yield* Deferred.await(entry.done);
        });

      const reconfigure = Effect.gen(function* () {
        const now = running;
        if (!now) {
          const before = yield* status.get;
          if (
            before.kind === "pack" ||
            before.kind === "code-unreadable" ||
            before.kind === "stopped"
          )
            yield* firstSync(yield* start);
          return;
        }
        yield* configureNow(now);
      });

      if (yield* Effect.orElseSucceed(consent.removalPending, () => false))
        yield* Effect.ignore(
          removal.pipe(
            Effect.tapError((error) =>
              Effect.logWarning(
                "The online library data could not be removed; ZotLit tries again at the next start",
              ).pipe(Effect.annotateLogs({ error: error.message })),
            ),
          ),
        );

      if (facade) {
        const focused = yield* SubscriptionRef.make(false);
        yield* Stream.runForEach(ports.focused, (on) =>
          SubscriptionRef.set(focused, on),
        ).pipe(Effect.forkScoped({ startImmediately: true }));
        yield* Stream.mergeAll(
          [
            Stream.as(Stream.drop(settings.changes, 1), undefined),
            pack.changes,
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Stream.runForEach(() => Effect.ignore(enqueue(reconfigure))),
          Effect.forkScoped({ startImmediately: true }),
        );
        yield* Effect.forkScoped(
          runSyncSchedule(syncStep(true), SubscriptionRef.changes(focused)),
          { startImmediately: true },
        );
      }
      yield* Effect.addFinalizer(() =>
        Effect.andThen(
          facade && running === null ? facade.absent(stopped()) : Effect.void,
          stop,
        ),
      );

      const selectKeySecret = Effect.fn("LibrarySource.selectKeySecret")(
        function* (name: string | null) {
          yield* enqueue(
            Effect.gen(function* () {
              yield* strictSave(WEB_API_KEY_SECRET_KEY, name || null);
              if (facade) yield* firstSync(yield* followKey);
            }),
          ).pipe(
            Effect.catch((error) =>
              Effect.logWarning(
                "A device record of the library source was not saved",
              ).pipe(Effect.annotateLogs({ error: error.message })),
            ),
          );
        },
      );

      const syncNow = syncStep(false).pipe(
        Effect.withSpan("LibrarySource.syncNow"),
      );

      const syncStatus = Effect.suspend(() => {
        const now = running;
        if (now) return asUnavailable(now.client.SyncStatus());
        return Effect.flatMap(status.get, (shown) =>
          Effect.fail(unavailable(textOf(shown))),
        );
      }).pipe(Effect.withSpan("LibrarySource.syncStatus"));

      const stopSync = Effect.suspend(() => {
        const now = running;
        const syncId = runningSyncOf(shown);
        if (!now || syncId === null) return Effect.void;
        return runs.stop(now.client, syncId);
      }).pipe(Effect.withSpan("LibrarySource.stopSync"));

      const removeData = Effect.suspend(() => {
        removalsRequested++;
        return Effect.andThen(
          showView,
          enqueue(
            removal.pipe(
              Effect.tapError(() =>
                Effect.flatMap(
                  Effect.orElseSucceed(consent.removalPending, () => true),
                  (recorded) =>
                    recorded
                      ? halt({ kind: "stopped" })
                      : Effect.succeed(false),
                ),
              ),
            ),
          ),
        ).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              removalsRequested--;
              return showView;
            }),
          ),
        );
      }).pipe(Effect.withSpan("LibrarySource.removeData"));

      const replaceData = Effect.fn("LibrarySource.replaceData")(function* (
        keyUserID: number,
      ) {
        const now = running;
        if (!now) return yield* unavailable(textOf(yield* status.get));
        return yield* enqueue(
          Effect.gen(function* () {
            if (replaceTargetOf(now) !== keyUserID)
              return yield* unavailable(m.settings_online_replace_stale());
            yield* consent.replaceWith(keyUserID);
            yield* configureNow(now);
            yield* beginSync(now);
          }),
          now,
        );
      });

      const otherData = yield* SubscriptionRef.make<OtherDataView>({
        kind: "unread",
      });
      yield* Effect.addFinalizer(() => PubSub.shutdown(otherData.pubsub));
      const readOtherData = ports.otherStoredReplicas.pipe(
        Effect.map((listed): OtherDataView => ({ kind: "listed", ...listed })),
        Effect.catch((error) =>
          Effect.succeed<OtherDataView>({
            kind: "unreadable",
            message: error.message,
          }),
        ),
        Effect.flatMap((next) => SubscriptionRef.set(otherData, next)),
        Effect.withSpan("LibrarySource.readOtherData"),
      );
      const removeOtherData = Effect.fn("LibrarySource.removeOtherData")(
        function* (id: string) {
          yield* ports
            .removeOtherStoredReplica(id)
            .pipe(Effect.ensuring(readOtherData));
        },
      );

      return LibrarySource.of({
        active,
        view: SubscriptionRef.get(view),
        viewChanges: SubscriptionRef.changes(view),
        select: Effect.fn("LibrarySource.select")(function* (kind) {
          yield* storage.save(
            LIBRARY_SOURCE_KEY,
            kind === "web-api" ? kind : null,
          );
          selected = kind;
          yield* showView;
        }),
        reload: ports.reload,
        keySecret,
        selectKeySecret,
        syncNow,
        stopSync,
        removeData,
        replaceData,
        otherData: SubscriptionRef.get(otherData),
        otherDataChanges: SubscriptionRef.changes(otherData),
        readOtherData,
        removeOtherData,
        language,
        syncStatus,
        reads: facade?.client ?? null,
      });
    }).pipe(withLogCategory("library-source")),
  );
