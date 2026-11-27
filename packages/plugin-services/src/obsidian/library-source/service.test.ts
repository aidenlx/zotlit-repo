import type { Settings } from "#core/settings/schema.ts";
import { expect, it } from "@effect/vitest";
import {
  Cause,
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
  Stream,
  SubscriptionRef,
} from "effect";
import { TestClock } from "effect/testing";

import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { UserCancelled } from "@zotlit/plugin-kernel/user-cancel.ts";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  ChangeEvent,
  WebApiReadsConfig,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import {
  DbUnavailable,
  ZOTERO_WEB_API_URL,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import type {
  WebSyncProgress,
  WebSyncStatus,
} from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";
import { plan } from "@zotlit/zotero-reads/worker/replica-plan.ts";

import { CONSENTED_ACCOUNT_KEY, PENDING_REMOVAL_KEY } from "./consent.ts";
import type { WebReadsClient, WebStart } from "./service.ts";
import {
  layerLibrarySource,
  LIBRARY_SOURCE_KEY,
  LibrarySource,
  WEB_API_KEY_SECRET_KEY,
} from "./service.ts";
import { formatSyncTime, statusText } from "./status.ts";
import type { StoredReplicaFolder } from "./stored-replica.ts";
import { ReplicaFolderRefused } from "./stored-replica.ts";

import { platformDefaults } from "#__fixtures__/platform-settings.ts";
import { ResourcePackPlatform } from "#obsidian/managed-binary/pack-platform.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

const KEY = "invented0key0for0tests00";
const OTHER_KEY = "another0invented0key000";
const THIRD_KEY = "third0invented0key00000";
const ACCOUNTS: Readonly<Record<string, number>> = {
  [KEY]: 42,
  [OTHER_KEY]: 99,
  [THIRD_KEY]: 7,
};

interface Replica {
  account: number | undefined;
  locale: string | null;
  committed: boolean;
}

const replicaOf = (account = 42, locale = "en-US"): Replica => ({
  account,
  locale,
  committed: true,
});
const WEB_API_URL_KEY = "zotlit-zotero-web-api-url";
const SECRET_NAME = "zotero-reading-key";

const SYNCED: WebSyncStatus = {
  state: "ready",
  syncing: false,
  syncId: null,
  waitingForReaders: false,
  problem: null,
  progress: null,
  zoteroLocale: "en-US",
  unconsentedUserID: null,
  libraries: [
    {
      library: { type: "user", id: 42 },
      committedVersion: 7,
      lastSync: toInstant(DateTime.makeUnsafe("2026-11-20T09:30:00Z")),
      retained: { deferred: 0, skipped: 0 },
    },
  ],
};

interface Worker {
  readonly calls: string[];
  readonly configs: WebApiReadsConfig[];
  stopped: boolean;
  readonly breakChanges: Effect.Effect<void>;
  readonly push: (progress: WebSyncProgress | null) => Effect.Effect<void>;
  readonly refreshing: Effect.Effect<void>;
}

interface Behaviour {
  refresh: Effect.Effect<void, DbUnavailable>;
  remove: Effect.Effect<void, DbUnavailable>;
  status: WebSyncStatus;
  die: boolean;
  configure: Effect.Effect<void>;
  stop: Effect.Effect<boolean>;
  readonly revoked: Set<string>;
}

class FailingDeviceStorage extends MemoryDeviceStorage {
  readonly refused = new Set<string>();
  readonly unreadable = new Set<string>();
  override loadLocalStorage(key: string): unknown {
    if (this.unreadable.has(key)) throw new Error("the disk cannot be read");
    return super.loadLocalStorage(key);
  }
  readonly writes: string[] = [];
  override saveLocalStorage(key: string, data: unknown): void {
    if (this.refused.has(key)) throw new Error("disk full");
    this.writes.push(`${key}=${JSON.stringify(data)}`);
    super.saveLocalStorage(key, data);
  }
}

const setup = Effect.fn("setup")(function* (
  options: {
    readonly source?: "web-api";
    readonly key?: string;
    readonly consented?: number | null;
    readonly replica?: Replica;
    readonly device?: FailingDeviceStorage;
    readonly system?: string;
    readonly systemLanguage?: Effect.Effect<string | null>;
    readonly start?: WebStart["kind"];
    readonly urlOverride?: boolean;
    readonly die?: boolean;
    readonly removalPending?: boolean;
    readonly removal?: Effect.Effect<
      void,
      DbUnavailable | ReplicaFolderRefused
    >;
    readonly unconsented?: number;
    readonly schema?: Effect.Effect<number | null>;
    readonly language?: string;
    readonly lifetime?: Scope.Scope;
    readonly others?: readonly StoredReplicaFolder[];
    readonly othersUnreadable?: DbUnavailable;
    readonly folderRoot?: boolean;
  } = {},
) {
  const device = options.device ?? new FailingDeviceStorage();
  const replica = options.replica ?? replicaOf();
  const forget = () => {
    if (replica.account !== undefined || replica.committed)
      device.writes.push(`delete:${replica.account}`);
    replica.account = undefined;
    replica.locale = null;
    replica.committed = false;
  };
  if (options.source) device.saveLocalStorage(LIBRARY_SOURCE_KEY, "web-api");
  const consented = options.consented === undefined ? 42 : options.consented;
  if (consented !== null && !options.device)
    device.saveLocalStorage(CONSENTED_ACCOUNT_KEY, consented);
  if (options.removalPending)
    device.saveLocalStorage(PENDING_REMOVAL_KEY, true);
  if (!options.device)
    device.saveLocalStorage(WEB_API_URL_KEY, "http://127.0.0.1:9");
  const secrets = new Map<string, string>();
  if (options.key) {
    secrets.set(SECRET_NAME, options.key);
    if (!options.device)
      device.saveLocalStorage(WEB_API_KEY_SECRET_KEY, SECRET_NAME);
  }
  const settings = yield* SubscriptionRef.make<Readonly<Settings>>(
    options.language
      ? { ...platformDefaults, "zotero.language": options.language }
      : platformDefaults,
  );
  const packChanges = yield* PubSub.unbounded<void>();
  const focus = yield* SubscriptionRef.make(true);
  let answer: WebStart["kind"] = options.start ?? "ready";
  const behaviour: Behaviour = {
    refresh: Effect.void,
    remove: Effect.void,
    status: { ...SYNCED, unconsentedUserID: options.unconsented ?? null },
    die: options.die ?? false,
    configure: Effect.void,
    stop: Effect.succeed(false),
    revoked: new Set(),
  };
  const workers: Worker[] = [];
  const removed: string[] = [];
  const runningAtRemoval: number[] = [];
  let others = options.others ?? [];
  const otherRemovals: string[] = [];
  let starts = 0;
  let removal: Effect.Effect<void, DbUnavailable | ReplicaFolderRefused> =
    options.removal ?? Effect.void;
  const startWeb = (config: WebApiReadsConfig) =>
    Effect.gen(function* () {
      starts++;
      device.writes.push("startWeb");
      if (behaviour.die) return yield* Effect.die("the Worker module failed");
      if (answer === "code-unreadable") return { kind: answer } as const;
      if (answer !== "ready")
        return answer === "failed"
          ? ({ kind: answer, detail: "unreadable" } as const)
          : ({ kind: answer } as const);
      const broken = yield* Deferred.make<void, DbUnavailable>();
      const progress = yield* PubSub.unbounded<WebSyncProgress | null>();
      const worker: Worker = {
        push: (next) => Effect.asVoid(PubSub.publish(progress, next)),
        refreshing: Effect.suspend(() =>
          Effect.asVoid(
            PubSub.publish(events, { _tag: "refreshing", active: true }),
          ),
        ),
        calls: [],
        configs: [config],
        stopped: false,
        breakChanges: Effect.asVoid(
          Deferred.fail(
            broken,
            new DbUnavailable({ message: "the Worker port closed" }),
          ),
        ),
      };
      workers.push(worker);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          worker.stopped = true;
        }),
      );
      const events = yield* PubSub.unbounded<ChangeEvent>();
      let snapshots = 0;
      let released = yield* Deferred.make<void>();
      yield* Deferred.succeed(released, undefined);
      const call = (name: string) =>
        Effect.sync(() => {
          worker.calls.push(name);
        });
      let problem: WebSyncStatus["problem"] = null;
      let unconsented: number | null = null;
      const syncModel = Effect.sync(() => {
        const current = worker.configs.at(-1)!;
        const zoteroLocale = current.zoteroLocale ?? "en-US";
        const keyUserID = behaviour.revoked.has(Redacted.value(current.apiKey))
          ? undefined
          : ACCOUNTS[Redacted.value(current.apiKey)];
        if (keyUserID === undefined) {
          unconsented = null;
          problem = { _tag: "key-invalid", message: "an unknown key" };
          return;
        }
        const decision = plan({
          keyUserID,
          readsLibraries: true,
          consentedUserID: current.consentedUserID,
          storedUserID: replica.account,
          replicaLocale: replica.locale,
          committed: replica.committed,
          zoteroLocale,
        });
        unconsented =
          decision.kind === "await-consent" ? decision.keyUserID : null;
        problem =
          decision.kind === "refuse"
            ? {
                _tag: "account-changed",
                message: "another account",
                consentedUserID: decision.consentedUserID,
                storedUserID: decision.storedUserID,
                keyUserID: decision.keyUserID,
              }
            : null;
        if (decision.kind === "rebuild" && decision.reason === "account")
          forget();
        if (decision.kind === "rebuild" && decision.reason === "language")
          replica.locale = zoteroLocale;
        if (
          decision.kind === "rebuild" ||
          decision.kind === "first-build" ||
          decision.kind === "incremental"
        ) {
          replica.account = keyUserID;
          replica.locale ??= zoteroLocale;
          replica.committed = true;
          device.writes.push(`download:${keyUserID}:${replica.locale}`);
        }
      });
      const client = {
        Changes: () =>
          Stream.concat(
            Stream.succeed<ChangeEvent>({
              _tag: "state",
              state: "ready",
              error: null,
            }),
            Stream.merge(
              Stream.fromPubSub(events),
              Stream.fromEffect(Deferred.await(broken)).pipe(Stream.drain),
            ),
          ),
        Refresh: () =>
          Effect.andThen(
            Effect.andThen(call("Refresh"), behaviour.refresh),
            Effect.andThen(
              syncModel,
              Effect.suspend(() => {
                const refused = problem ?? behaviour.status.problem;
                return refused
                  ? Effect.fail(new DbUnavailable({ message: refused.message }))
                  : Effect.void;
              }),
            ),
          ).pipe(
            Effect.ensuring(
              PubSub.publish(events, { _tag: "refreshing", active: false }),
            ),
          ),
        Configure: (next: WebApiReadsConfig) =>
          Effect.andThen(
            behaviour.configure,
            Effect.sync(() => {
              worker.configs.push(next);
              worker.calls.push(
                `Configure:${[next.zoteroLocale, next.consentedUserID]
                  .filter((part) => part !== undefined)
                  .join(":")}`,
              );
            }),
          ),
        RemoveReplica: () =>
          Effect.andThen(
            Effect.suspend(() => Deferred.await(released)),
            Effect.andThen(
              Effect.sync(() => {
                worker.calls.push("RemoveReplica");
                device.writes.push("RemoveReplica");
              }),
              Effect.andThen(behaviour.remove, Effect.sync(forget)),
            ),
          ),
        SyncProgress: () => Stream.fromPubSub(progress),
        StopSync: ({ syncId }: { readonly syncId: number }) =>
          Effect.andThen(
            call(`StopSync:${syncId}`),
            Effect.suspend(() => behaviour.stop),
          ),
        SyncStatus: () =>
          Effect.sync((): WebSyncStatus => ({
            ...behaviour.status,
            problem: problem ?? behaviour.status.problem,
            unconsentedUserID: unconsented,
            zoteroLocale: replica.locale,
          })),
        SourceIdentity: () =>
          Effect.succeed({
            kind: "web-api",
            id: "web-api:42",
            userID: 42,
            username: "ada",
          }),
        Snapshot: () =>
          Stream.unwrap(
            Effect.gen(function* () {
              if (snapshots++ === 0) released = yield* Deferred.make<void>();
              return Stream.never.pipe(
                Stream.ensuring(
                  Effect.suspend(() =>
                    --snapshots === 0
                      ? Deferred.succeed(released, undefined)
                      : Effect.void,
                  ),
                ),
              );
            }),
          ),
      } as unknown as WebReadsClient;
      return { kind: "ready", client } as const;
    });
  const build = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
    options.lifetime
      ? Layer.buildWithScope(layer, options.lifetime)
      : Layer.build(layer);
  const context = yield* build(
    layerLibrarySource({
      startWeb,
      poolDirectory: Effect.succeed("/zotlit/test-vault"),
      systemLanguage:
        options.systemLanguage ?? Effect.succeed(options.system ?? "en-US"),
      focused: SubscriptionRef.changes(focus),
      secrets: { getSecret: (id) => secrets.get(id) ?? null },
      reload: Effect.void,
      otherStoredReplicas: Effect.suspend(() =>
        options.othersUnreadable
          ? Effect.fail(options.othersUnreadable)
          : Effect.succeed({ scope: "gone-vaults" as const, folders: others }),
      ),
      removeOtherStoredReplica: (id) =>
        Effect.sync(() => {
          otherRemovals.push(id);
          others = others.filter((folder) => folder.id !== id);
        }),
      removesReplicaFolder: options.folderRoot ?? false,
      removeStoredReplica: (directory) =>
        Effect.andThen(
          Effect.sync(() => {
            removed.push(directory);
            runningAtRemoval.push(
              workers.filter((worker) => !worker.stopped).length,
            );
            device.writes.push("removeStoredReplica");
          }),
          Effect.andThen(
            Effect.suspend(() => removal),
            Effect.sync(forget),
          ),
        ),
      ...(options.schema ? { serverSchemaVersion: () => options.schema! } : {}),
      ...(options.urlOverride === false
        ? {}
        : {
            webApiUrlOverride: Effect.sync(() =>
              device.loadLocalStorage(WEB_API_URL_KEY),
            ),
          }),
    }).pipe(
      Layer.provide([
        layerDeviceStorageFrom(device),
        Layer.mock(PluginSettings)({
          current: SubscriptionRef.get(settings),
          changes: SubscriptionRef.changes(settings),
        }),
        Layer.mock(ResourcePackPlatform)({
          locate: Effect.succeed(null),
          changes: Stream.fromPubSub(packChanges),
        }),
        Layer.succeed(
          ObsidianEnv,
          stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
            language: "en",
          }),
        ),
      ]),
    ),
  );
  yield* TestClock.adjust("0 millis");
  return {
    context,
    device,
    secrets,
    settings,
    workers,
    removed,
    runningAtRemoval,
    otherRemovals,
    behaviour,
    replica,
    starts: () => starts,
    failRemoval: (error: DbUnavailable | ReplicaFolderRefused) => {
      removal = Effect.fail(error);
    },
    setAnswer: (next: WebStart["kind"]) => {
      answer = next;
    },
    packChanged: PubSub.publish(packChanges, undefined),
  };
});

const serviceOf = (built: Effect.Success<ReturnType<typeof setup>>) =>
  Effect.succeed(Context.get(built.context, LibrarySource));

const settle = Effect.repeat(TestClock.adjust("0 millis"), { times: 12 });

it.effect(
  "reads the Zotero database file when the device has no choice, and starts no Worker",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ key: KEY });
      const source = yield* serviceOf(built);
      expect(source.active).toBe("file");
      expect(source.reads).toBeNull();
      expect((yield* source.view).status).toEqual({ kind: "file-source" });
      expect(built.workers).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "answers the sync status of the running Worker, and fails with the shown reason when no Worker runs",
  () =>
    Effect.gen(function* () {
      const waiting = yield* serviceOf(yield* setup({ source: "web-api" }));
      expect((yield* Effect.flip(waiting.syncStatus)).message).toBe(
        statusText({ kind: "no-key" }, formatSyncTime),
      );
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* source.viewChanges.pipe(
        Stream.filter((view) => view.status.kind === "running"),
        Stream.runHead,
      );
      built.behaviour.status = { ...SYNCED, syncing: true };
      expect(yield* source.syncStatus).toMatchObject({
        syncing: true,
        libraries: SYNCED.libraries,
      });
    }).pipe(Effect.scoped),
);

it.effect(
  "stores the choice on this device and keeps the running source until a reload",
  () =>
    Effect.gen(function* () {
      const built = yield* setup();
      const source = yield* serviceOf(built);
      yield* source.select("web-api");
      expect(built.device.loadLocalStorage(LIBRARY_SOURCE_KEY)).toBe("web-api");
      expect((yield* source.view).selected).toBe("web-api");
      expect(source.active).toBe("file");
      yield* source.select("file");
      expect(built.device.loadLocalStorage(LIBRARY_SOURCE_KEY)).toBeNull();
    }).pipe(Effect.scoped),
);

it.effect(
  "waits for a key, then starts the Worker with it and syncs at once",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api" });
      const source = yield* serviceOf(built);
      expect((yield* source.view).status).toEqual({ kind: "no-key" });
      expect(built.workers).toEqual([]);
      expect(yield* Effect.flip(source.reads!.Libraries({}))).toMatchObject({
        _tag: "DbUnavailable",
      });

      yield* source.selectKeySecret("missing-secret");
      expect((yield* source.view).status).toEqual({ kind: "no-key" });
      expect(built.workers).toEqual([]);

      built.secrets.set(SECRET_NAME, ` ${KEY} `);
      yield* source.selectKeySecret(SECRET_NAME);
      yield* settle;
      expect(yield* source.keySecret).toBe(SECRET_NAME);
      expect(built.device.loadLocalStorage(WEB_API_KEY_SECRET_KEY)).toBe(
        SECRET_NAME,
      );
      expect([...built.device.values.values()].join("\n")).not.toContain(KEY);
      expect(
        JSON.stringify(yield* SubscriptionRef.get(built.settings)),
      ).not.toContain(KEY);
      const [worker] = built.workers;
      const config = worker!.configs[0]!;
      expect(Redacted.value(config.apiKey)).toBe(KEY);
      expect(config).toMatchObject({
        baseUrl: "http://127.0.0.1:9",
        poolDirectory: "/zotlit/test-vault",
        zoteroLocale: "en-US",
        locale: "en",
      });
      expect(worker!.calls).toEqual(["Refresh"]);
      expect((yield* source.view).status).toEqual({
        kind: "running",
        sync: SYNCED,
        account: "ada",
        serverSchemaVersion: null,
      });
      expect(JSON.stringify((yield* source.view).status)).not.toContain(KEY);
    }).pipe(Effect.scoped),
);

it.effect(
  "syncs each 5 minutes while the window has focus, and on Sync now",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      const worker = built.workers[0]!;
      expect(worker.calls).toEqual(["Refresh"]);
      yield* TestClock.adjust("5 minutes");
      expect(worker.calls).toEqual(["Refresh", "Refresh"]);
      yield* source.syncNow;
      expect(worker.calls).toEqual(["Refresh", "Refresh", "Refresh"]);
    }).pipe(Effect.scoped),
);

it.effect(
  "gives the running Worker a key changed in the keychain at the next sync, and the key of another selected secret at once",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      const worker = built.workers[0]!;
      built.secrets.set(SECRET_NAME, "another0invented0key000");
      expect(worker.configs).toHaveLength(1);
      yield* TestClock.adjust("5 minutes");
      expect(Redacted.value(worker.configs.at(-1)!.apiKey)).toBe(
        "another0invented0key000",
      );

      built.secrets.set("second-key", "third0invented0key00000");
      yield* source.selectKeySecret("second-key");
      expect(built.workers).toHaveLength(1);
      expect(Redacted.value(worker.configs.at(-1)!.apiKey)).toBe(
        "third0invented0key00000",
      );

      built.secrets.set("second-key", "");
      yield* Effect.flip(source.syncNow);
      expect(worker.stopped).toBe(true);
      expect((yield* source.view).status).toEqual({ kind: "no-key" });
    }).pipe(Effect.scoped),
);

it.effect(
  "removes the replica with no sync, stops the Worker and forgets the key",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        consented: 42,
      });
      const source = yield* serviceOf(built);
      yield* source.removeData;
      const worker = built.workers[0]!;
      expect(worker.calls).toEqual(["Refresh", "RemoveReplica"]);
      expect(worker.stopped).toBe(true);
      expect(built.secrets.get(SECRET_NAME)).toBe(KEY);
      expect(yield* source.keySecret).toBeNull();
      expect(built.removed).toEqual([]);
      expect(built.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY)).toBeNull();
      expect(built.device.loadLocalStorage(PENDING_REMOVAL_KEY)).toBeNull();
      expect((yield* source.view).status).toEqual({ kind: "no-key" });
      yield* TestClock.adjust("10 minutes");
      expect(worker.calls).toEqual(["Refresh", "RemoveReplica"]);
    }).pipe(Effect.scoped),
);

it.effect(
  "removes the folder of this vault on the desktop root after the Worker removed its replica and stopped, so no replica file stays",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        consented: 42,
        folderRoot: true,
      });
      const source = yield* serviceOf(built);
      yield* source.removeData;
      const worker = built.workers[0]!;
      expect(worker.calls).toEqual(["Refresh", "RemoveReplica"]);
      expect(worker.stopped).toBe(true);
      expect(built.removed).toEqual(["/zotlit/test-vault"]);
      expect(built.runningAtRemoval).toEqual([0]);
      expect((yield* source.view).status).toEqual({ kind: "no-key" });
    }).pipe(Effect.scoped),
);

it.effect(
  "names a missing Resource Pack, and starts once the pack is installed",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        start: "pack-absent",
      });
      const source = yield* serviceOf(built);
      expect((yield* source.view).status).toEqual({
        kind: "pack",
        refusal: { kind: "pack-absent" },
      });
      expect(yield* Effect.flip(source.reads!.Libraries({}))).toMatchObject({
        _tag: "DbUnavailable",
      });
      built.setAnswer("ready");
      yield* built.packChanged;
      yield* settle;
      expect(built.workers).toHaveLength(1);
      yield* source.reads!.Refresh();
      yield* settle;
      expect(built.workers[0]!.calls).toEqual(["Refresh", "Refresh"]);
      expect((yield* source.view).status.kind).toBe("running");
    }).pipe(Effect.scoped),
);

it.effect(
  "stops the Worker when a scheduled sync finds the secret empty, and starts again on a new secret",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      built.secrets.set(SECRET_NAME, "");
      yield* TestClock.adjust("5 minutes");
      expect(built.workers[0]!.stopped).toBe(true);
      expect((yield* source.view).status).toEqual({ kind: "no-key" });
      built.secrets.set("second-key", KEY);
      yield* source.selectKeySecret("second-key");
      yield* settle;
      expect(built.workers).toHaveLength(2);
      expect((yield* source.view).status.kind).toBe("running");
    }).pipe(Effect.scoped),
);

it.effect(
  "removes the stored online library when no Worker runs, and forgets the secret",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        start: "pack-absent",
      });
      const source = yield* serviceOf(built);
      yield* source.removeData;
      expect(built.removed).toEqual(["/zotlit/test-vault"]);
      expect(yield* source.keySecret).toBeNull();
      expect(built.secrets.get(SECRET_NAME)).toBe(KEY);
      expect((yield* source.view).status).toEqual({ kind: "no-key" });
    }).pipe(Effect.scoped),
);

it.effect("names a Worker whose code does not load", () =>
  Effect.gen(function* () {
    const built = yield* setup({
      source: "web-api",
      key: KEY,
      start: "code-unreadable",
    });
    const source = yield* serviceOf(built);
    expect((yield* source.view).status).toEqual({ kind: "code-unreadable" });
  }).pipe(Effect.scoped),
);

const ACCOUNT_CHANGED: WebSyncStatus = {
  ...SYNCED,
  problem: {
    _tag: "account-changed",
    message: "another account",
    consentedUserID: 42,
    storedUserID: 42,
    keyUserID: 99,
  },
};

const failed = (message: string) => Effect.fail(new DbUnavailable({ message }));

it.effect(
  "removes the stored online library while the file source is still active, and reports a removal that fails",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ key: KEY });
      const source = yield* serviceOf(built);
      yield* source.select("web-api");
      yield* source.removeData;
      expect(built.removed).toEqual(["/zotlit/test-vault"]);
      expect(yield* source.keySecret).toBeNull();
      expect((yield* source.view).status).toEqual({ kind: "file-source" });

      built.failRemoval(new DbUnavailable({ message: "the folder is locked" }));
      expect(yield* Effect.flip(source.removeData)).toMatchObject({
        _tag: "DbUnavailable",
      });
    }).pipe(Effect.scoped),
);

it.effect(
  "names a refused removal of this vault's folder with its own text, and does not try it again at the next start",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ key: KEY });
      const source = yield* serviceOf(built);
      yield* source.select("web-api");
      const refusal = m.settings_online_data_this_remove_refused({
        id: "0123456789abcdef",
      });
      built.failRemoval(new ReplicaFolderRefused({ message: refusal }));
      expect(yield* Effect.flip(source.removeData)).toMatchObject({
        message: refusal,
      });
      expect(built.device.loadLocalStorage(PENDING_REMOVAL_KEY)).toBeNull();
      expect(yield* source.keySecret).toBeNull();
    }).pipe(Effect.scoped),
);

it.effect(
  "names a start that dies, fails reads with the status text, and starts again on Sync now",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY, die: true });
      const source = yield* serviceOf(built);
      const status = (yield* source.view).status;
      expect(status).toEqual({ kind: "stopped" });
      const error = yield* Effect.flip(source.reads!.Libraries({}));
      expect(error).toMatchObject({
        _tag: "DbUnavailable",
        message: statusText(status, formatSyncTime),
      });
      built.behaviour.die = false;
      yield* source.syncNow;
      expect(built.workers).toHaveLength(1);
      expect((yield* source.view).status.kind).toBe("running");
    }).pipe(Effect.scoped),
);

it.effect(
  "names a Worker whose change stream fails, and starts a new Worker on Sync now",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* built.workers[0]!.breakChanges;
      yield* settle;
      expect((yield* source.view).status).toEqual({ kind: "stopped" });
      expect(built.workers[0]!.stopped).toBe(true);
      expect(yield* Effect.flip(source.reads!.Libraries({}))).toMatchObject({
        _tag: "DbUnavailable",
      });
      yield* source.syncNow;
      expect(built.workers).toHaveLength(2);
      expect((yield* source.view).status.kind).toBe("running");
    }).pipe(Effect.scoped),
);

it.effect("fails Sync now with the reason when no Worker can run", () =>
  Effect.gen(function* () {
    const built = yield* setup({ source: "web-api" });
    const source = yield* serviceOf(built);
    const error = yield* Effect.flip(source.syncNow);
    expect(error.message).toBe(statusText({ kind: "no-key" }, formatSyncTime));
  }).pipe(Effect.scoped),
);

it.effect(
  "shows no accepted account while the key belongs to another account, and none for a new key until it syncs",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      expect((yield* source.view).status).toMatchObject({ account: "ada" });
      built.behaviour.status = ACCOUNT_CHANGED;
      built.behaviour.refresh = failed("another account");
      yield* Effect.ignore(source.syncNow);
      yield* settle;
      expect((yield* source.view).status).toMatchObject({
        kind: "running",
        account: null,
      });

      built.behaviour.status = SYNCED;
      built.behaviour.refresh = Effect.void;
      yield* source.syncNow;
      yield* settle;
      expect((yield* source.view).status).toMatchObject({ account: "ada" });
      built.secrets.set("second-key", "another0invented0key000");
      yield* source.selectKeySecret("second-key");
      yield* settle;
      expect((yield* source.view).status).toMatchObject({ account: null });
    }).pipe(Effect.scoped),
);

it.effect("asks for the Worker once at load when its start is refused", () =>
  Effect.gen(function* () {
    const built = yield* setup({
      source: "web-api",
      key: KEY,
      start: "pack-absent",
    });
    yield* serviceOf(built);
    yield* settle;
    expect(built.starts()).toBe(1);
  }).pipe(Effect.scoped),
);

it.effect(
  "uses zotero.org when the build gives no address override, whatever the device record holds",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        urlOverride: false,
      });
      yield* serviceOf(built);
      expect(built.workers[0]!.configs[0]!.baseUrl).toBe(ZOTERO_WEB_API_URL);
    }).pipe(Effect.scoped),
);

it.effect(
  "follows the focus of the app through one subscription for the whole session",
  () =>
    Effect.gen(function* () {
      let subscriptions = 0;
      const focus = yield* SubscriptionRef.make(true);
      const counted = Stream.unwrap(
        Effect.sync(() => {
          subscriptions++;
          return SubscriptionRef.changes(focus);
        }),
      );
      const device = new MemoryDeviceStorage();
      device.saveLocalStorage(LIBRARY_SOURCE_KEY, "web-api");
      device.saveLocalStorage(WEB_API_KEY_SECRET_KEY, SECRET_NAME);
      const settings =
        yield* SubscriptionRef.make<Readonly<Settings>>(platformDefaults);
      let refreshes = 0;
      yield* Layer.build(
        layerLibrarySource({
          startWeb: () =>
            Effect.succeed({
              kind: "ready",
              client: {
                Changes: () => Stream.never,
                Refresh: () =>
                  Effect.sync(() => {
                    refreshes++;
                  }),
                SyncStatus: () => Effect.succeed(SYNCED),
                SourceIdentity: () =>
                  Effect.succeed({
                    kind: "web-api",
                    id: "web-api:42",
                    userID: 42,
                    username: "ada",
                  }),
              } as unknown as WebReadsClient,
            }),
          poolDirectory: Effect.succeed("/zotlit/test-vault"),
          systemLanguage: Effect.succeed("en-US"),
          focused: counted,
          secrets: { getSecret: () => KEY },
          reload: Effect.void,
          removesReplicaFolder: false,
          removeStoredReplica: () => Effect.void,
          otherStoredReplicas: Effect.succeed({
            scope: "gone-vaults",
            folders: [],
          }),
          removeOtherStoredReplica: () => Effect.void,
        }).pipe(
          Layer.provide([
            layerDeviceStorageFrom(device),
            Layer.mock(PluginSettings)({
              current: SubscriptionRef.get(settings),
              changes: SubscriptionRef.changes(settings),
            }),
            Layer.mock(ResourcePackPlatform)({
              locate: Effect.succeed(null),
              changes: Stream.never,
            }),
            Layer.succeed(
              ObsidianEnv,
              stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
                language: "en",
              }),
            ),
          ]),
        ),
      );
      yield* TestClock.adjust("15 minutes");
      expect(refreshes).toBe(4);
      expect(subscriptions).toBe(1);
    }).pipe(Effect.scoped),
);

it.effect(
  "starts again after a refusal of the pack only on a pack change or Sync now, and retries a crashed start on the schedule",
  () =>
    Effect.gen(function* () {
      const refused = yield* setup({
        source: "web-api",
        key: KEY,
        start: "pack-absent",
      });
      const source = yield* serviceOf(refused);
      expect(refused.starts()).toBe(1);
      yield* TestClock.adjust("15 minutes");
      expect(refused.starts()).toBe(1);
      yield* Effect.flip(source.syncNow);
      expect(refused.starts()).toBe(2);
      yield* refused.packChanged;
      yield* settle;
      expect(refused.starts()).toBe(3);

      const crashed = yield* setup({ source: "web-api", key: KEY, die: true });
      yield* serviceOf(crashed);
      expect(crashed.starts()).toBe(1);
      crashed.behaviour.die = false;
      yield* TestClock.adjust("5 minutes");
      expect(crashed.starts()).toBe(2);
      expect(crashed.workers).toHaveLength(1);
    }).pipe(Effect.scoped),
);

it.effect(
  "records a newer schema of the Zotero server from the renderer's request, once for each sync, and stays silent when the request fails",
  () =>
    Effect.gen(function* () {
      let answer: Effect.Effect<number | null> = Effect.succeed(99);
      let asked = 0;
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        schema: Effect.suspend(() => {
          asked++;
          return answer;
        }),
      });
      const source = yield* serviceOf(built);
      yield* settle;
      expect(asked).toBe(1);
      expect((yield* source.view).status).toMatchObject({
        serverSchemaVersion: 99,
      });
      answer = Effect.succeed(1);
      yield* source.syncNow;
      yield* settle;
      expect(asked).toBe(2);
      expect((yield* source.view).status).toMatchObject({
        serverSchemaVersion: null,
      });
      answer = Effect.die("offline");
      yield* source.syncNow;
      expect(asked).toBe(3);
    }).pipe(Effect.scoped),
);

const emptyReplica = (): Replica => ({
  account: undefined,
  locale: null,
  committed: false,
});

it.effect(
  "records the account of the key on this device before the first download, and only when no account is recorded",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        consented: null,
        replica: emptyReplica(),
      });
      yield* settle;
      const log = built.device.writes;
      expect(log.indexOf(`${CONSENTED_ACCOUNT_KEY}=42`)).toBeGreaterThan(-1);
      expect(log.indexOf(`${CONSENTED_ACCOUNT_KEY}=42`)).toBeLessThan(
        log.indexOf("download:42:en-US"),
      );
      expect(built.workers[0]!.configs.at(-1)).toMatchObject({
        consentedUserID: 42,
      });

      const kept = yield* setup({
        source: "web-api",
        key: OTHER_KEY,
        replica: replicaOf(42),
      });
      yield* settle;
      expect(kept.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY)).toBe(42);
      expect(
        kept.device.writes.filter((entry) => entry.startsWith("download")),
      ).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "sends a change of the Zotero language to the Worker and removes no data itself",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* SubscriptionRef.update(built.settings, (current) => ({
        ...current,
        "zotero.language": "en-GB",
      }));
      yield* settle;
      yield* source.syncNow;
      const worker = built.workers[0]!;
      expect(worker.calls).toContain("Configure:en-GB:42");
      expect(worker.calls.some((call) => call.startsWith("Remove"))).toBe(
        false,
      );
      expect(built.replica).toEqual(replicaOf(42, "en-GB"));
    }).pipe(Effect.scoped),
);

it.effect(
  "names the new account on this device for Replace data before the Worker deletes anything",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: OTHER_KEY });
      const source = yield* serviceOf(built);
      expect(yield* Effect.flip(source.syncNow)).toMatchObject({
        message: "another account",
      });
      yield* settle;
      expect((yield* source.view).status).toMatchObject({
        sync: { problem: { _tag: "account-changed", keyUserID: 99 } },
      });
      expect(built.replica.account).toBe(42);
      yield* source.replaceData(99);
      yield* settle;
      const log = built.device.writes;
      const named = log.indexOf(`${CONSENTED_ACCOUNT_KEY}=99`);
      expect(named).toBeGreaterThan(-1);
      expect(named).toBeLessThan(log.indexOf("delete:42"));
      expect(log.indexOf("delete:42")).toBeLessThan(
        log.indexOf("download:99:en-US"),
      );
      expect(
        built.workers[0]!.calls.some((call) => call.startsWith("Remove")),
      ).toBe(false);
    }).pipe(Effect.scoped),
);

it.effect(
  "removes the data as one sequence: the removal record, the key name, the account, the replica, and the record again",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      built.device.writes.length = 0;
      yield* source.removeData;
      expect(built.device.writes).toEqual([
        `${PENDING_REMOVAL_KEY}=true`,
        `${WEB_API_KEY_SECRET_KEY}=null`,
        `${CONSENTED_ACCOUNT_KEY}=null`,
        "RemoveReplica",
        "delete:42",
        `${PENDING_REMOVAL_KEY}=null`,
      ]);
    }).pipe(Effect.scoped),
);

it.effect(
  "stops the Worker when a step of the removal fails, keeps the record, and finishes the removal at the next start before any Worker",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      built.device.refused.add(WEB_API_KEY_SECRET_KEY);
      expect(yield* Effect.flip(source.removeData)).toMatchObject({
        _tag: "DbUnavailable",
      });
      expect(built.workers[0]!.stopped).toBe(true);
      expect(built.device.loadLocalStorage(PENDING_REMOVAL_KEY)).toBe(true);
      expect(built.replica.account).toBe(42);

      built.device.refused.clear();
      built.device.writes.length = 0;
      const restarted = yield* setup({
        source: "web-api",
        key: KEY,
        device: built.device,
        replica: built.replica,
      });
      yield* settle;
      expect(restarted.device.writes).not.toContain("startWeb");
      expect(restarted.workers).toEqual([]);
      expect(restarted.replica).toEqual(emptyReplica());
      expect(restarted.device.loadLocalStorage(PENDING_REMOVAL_KEY)).toBeNull();
      expect(
        restarted.device.loadLocalStorage(WEB_API_KEY_SECRET_KEY),
      ).toBeNull();

      const blocked = yield* setup({
        source: "web-api",
        key: KEY,
        removalPending: true,
        removal: failed("the folder is locked"),
      });
      const blockedSource = yield* serviceOf(blocked);
      expect(blocked.device.writes).not.toContain("startWeb");
      expect((yield* blockedSource.view).status).toEqual({ kind: "stopped" });
      expect(blocked.device.loadLocalStorage(PENDING_REMOVAL_KEY)).toBe(true);
    }).pipe(Effect.scoped),
);

it.effect(
  "lets Sync now join the sync that runs, with one refresh and one schema request",
  () =>
    Effect.gen(function* () {
      let asked = 0;
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        schema: Effect.sync(() => {
          asked++;
          return null;
        }),
      });
      const source = yield* serviceOf(built);
      yield* settle;
      const refreshes = () =>
        built.workers[0]!.calls.filter((call) => call === "Refresh").length;
      const before = { refreshes: refreshes(), asked };
      const gate = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(gate);
      const first = yield* Effect.forkChild(source.syncNow, {
        startImmediately: true,
      });
      yield* settle;
      const second = yield* Effect.forkChild(source.syncNow, {
        startImmediately: true,
      });
      yield* settle;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(refreshes() - before.refreshes).toBe(1);
      expect(asked - before.asked).toBe(1);
    }).pipe(Effect.scoped),
);

it.effect(
  "starts a new sync for a new Worker instead of joining the sync of the Worker before it",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      const gate = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(gate);
      const stale = yield* Effect.forkChild(Effect.exit(source.syncNow), {
        startImmediately: true,
      });
      yield* settle;
      yield* source.selectKeySecret(null);
      built.behaviour.refresh = Effect.void;
      yield* source.selectKeySecret(SECRET_NAME);
      yield* settle;
      yield* source.syncNow;
      expect(built.workers).toHaveLength(2);
      expect(
        built.workers[1]!.calls.filter((call) => call === "Refresh").length,
      ).toBeGreaterThan(0);
      expect(Exit.isFailure(yield* Fiber.join(stale))).toBe(true);
    }).pipe(Effect.scoped),
);

it.effect(
  "records the account and downloads after the user picks a working key in place of a refused one, with no Sync now",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: "refused0invented0key0000",
        consented: null,
        replica: emptyReplica(),
      });
      built.behaviour.refresh = failed(
        "The Zotero Web API does not accept this API key",
      );
      const source = yield* serviceOf(built);
      yield* settle;
      expect(
        built.device.writes.some((entry) => entry.startsWith("download")),
      ).toBe(false);
      built.behaviour.refresh = Effect.void;
      built.secrets.set("working-key", KEY);
      yield* source.selectKeySecret("working-key");
      yield* settle;
      const log = built.device.writes;
      expect(log.indexOf(`${CONSENTED_ACCOUNT_KEY}=42`)).toBeGreaterThan(-1);
      expect(log.indexOf(`${CONSENTED_ACCOUNT_KEY}=42`)).toBeLessThan(
        log.indexOf("download:42:en-US"),
      );
    }).pipe(Effect.scoped),
);

it.effect(
  "refuses Replace data for an account that is not the result of the check of the current key",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: OTHER_KEY });
      const source = yield* serviceOf(built);
      expect(yield* Effect.flip(source.syncNow)).toMatchObject({
        message: "another account",
      });
      yield* settle;
      const gate = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(gate);
      built.secrets.set("third-key", THIRD_KEY);
      yield* source.selectKeySecret("third-key");
      yield* settle;
      expect(yield* Effect.flip(source.replaceData(99))).toMatchObject({
        message: m.settings_online_replace_stale(),
      });
      expect(built.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY)).toBe(42);
      yield* Deferred.succeed(gate, undefined);
      yield* settle;
      expect(yield* Effect.flip(source.replaceData(99))).toMatchObject({
        message: m.settings_online_replace_stale(),
      });
      yield* source.replaceData(7);
      expect(built.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY)).toBe(7);
    }).pipe(Effect.scoped),
);

it.effect(
  "stops with the text of the device when the account record cannot be read, and records no account",
  () =>
    Effect.gen(function* () {
      const device = new FailingDeviceStorage();
      device.saveLocalStorage(LIBRARY_SOURCE_KEY, "web-api");
      device.saveLocalStorage(WEB_API_KEY_SECRET_KEY, SECRET_NAME);
      device.unreadable.add(CONSENTED_ACCOUNT_KEY);
      device.writes.length = 0;
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        device,
        replica: emptyReplica(),
      });
      const source = yield* serviceOf(built);
      yield* settle;
      expect((yield* source.view).status).toEqual({
        kind: "device-record",
        message: m.settings_online_record_unreadable(),
      });
      expect(built.device.writes).not.toContain("startWeb");
      expect(
        built.device.writes.filter((entry) =>
          entry.startsWith(CONSENTED_ACCOUNT_KEY),
        ),
      ).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "says the removal did not start, and keeps the Worker, when the device refuses the first record",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      built.device.refused.add(PENDING_REMOVAL_KEY);
      expect(yield* Effect.flip(source.removeData)).toMatchObject({
        message: m.settings_online_remove_not_started(),
      });
      expect(built.workers[0]!.stopped).toBe(false);
      expect(yield* source.keySecret).toBe(SECRET_NAME);
    }).pipe(Effect.scoped),
);

it.effect(
  "answers a Sync now that a new key overtook with the check of the new key, and records its account",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: "refused0invented0key0000",
        consented: null,
        replica: emptyReplica(),
      });
      const source = yield* serviceOf(built);
      yield* settle;
      const gate = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(gate);
      const waiting = yield* Effect.forkChild(Effect.exit(source.syncNow), {
        startImmediately: true,
      });
      yield* settle;
      built.secrets.set("second-key", OTHER_KEY);
      yield* source.selectKeySecret("second-key");
      yield* settle;
      yield* Deferred.succeed(gate, undefined);
      yield* settle;
      expect(Exit.isSuccess(yield* Fiber.join(waiting))).toBe(true);
      expect(built.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY)).toBe(99);
      expect(built.device.writes).toContain("download:99:en-US");
    }).pipe(Effect.scoped),
);

it.effect("starts again from a stopped start when a setting changes", () =>
  Effect.gen(function* () {
    const built = yield* setup({ source: "web-api", key: KEY, die: true });
    const source = yield* serviceOf(built);
    expect((yield* source.view).status).toEqual({ kind: "stopped" });
    built.behaviour.die = false;
    yield* SubscriptionRef.update(built.settings, (current) => ({
      ...current,
      "zotero.language": "en-GB",
    }));
    yield* settle;
    expect(built.workers).toHaveLength(1);
    expect((yield* source.view).status.kind).toBe("running");
  }).pipe(Effect.scoped),
);

it.effect(
  "grants no account for the check of a key that changed while the grant waited",
  () =>
    Effect.gen(function* () {
      const language = yield* Deferred.make<void>();
      let holdLanguage = false;
      const built = yield* setup({
        source: "web-api",
        key: "refused0invented0key0000",
        consented: null,
        replica: emptyReplica(),
        systemLanguage: Effect.suspend(() =>
          holdLanguage
            ? Effect.as(Deferred.await(language), "en-US")
            : Effect.succeed("en-US"),
        ),
      });
      const source = yield* serviceOf(built);
      yield* settle;
      built.secrets.set(SECRET_NAME, KEY);
      const gate = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(gate);
      yield* Effect.forkChild(Effect.exit(source.syncNow), {
        startImmediately: true,
      });
      yield* settle;
      holdLanguage = true;
      built.secrets.set("second-key", OTHER_KEY);
      const selecting = yield* Effect.forkChild(
        source.selectKeySecret("second-key"),
        { startImmediately: true },
      );
      yield* settle;
      built.behaviour.refresh = Effect.void;
      yield* Deferred.succeed(gate, undefined);
      yield* settle;
      holdLanguage = false;
      yield* Deferred.succeed(language, undefined);
      yield* Fiber.join(selecting);
      yield* settle;
      expect(built.device.writes).not.toContain(`${CONSENTED_ACCOUNT_KEY}=42`);
    }).pipe(Effect.scoped),
);

const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SEQUENCES = 150;
const STEPS = 14;

it.effect(
  "gives each caller exactly one typed answer before the unload over generated sequences of keys, syncs, removals, replacements, starts, refreshes and lost Workers, then the known outcomes of a sync, a replacement and a cleared key",
  () =>
    Effect.gen(function* () {
      const problems: string[] = [];
      for (let sequence = 0; sequence < SEQUENCES; sequence++) {
        const next = random(sequence + 1);
        const pick = <A>(items: readonly A[]) =>
          items[Math.floor(next() * items.length)]!;
        const lifetime = yield* Scope.make();
        const built = yield* setup({
          source: "web-api",
          key: pick([KEY, OTHER_KEY, undefined]),
          consented: pick([42, null]),
          replica: pick([replicaOf(42), emptyReplica()]),
        }).pipe(Scope.provide(lifetime));
        const source = yield* serviceOf(built);
        const calls: {
          readonly name: string;
          readonly fiber: Fiber.Fiber<
            Exit.Exit<void, DbUnavailable | UserCancelled>
          >;
        }[] = [];
        const call = (
          name: string,
          effect: Effect.Effect<void, DbUnavailable | UserCancelled>,
        ) =>
          Effect.map(
            Effect.forkChild(Effect.exit(effect), { startImmediately: true }),
            (fiber) => {
              calls.push({ name, fiber });
            },
          );
        const trace: string[] = [];
        for (let index = 0; index < STEPS; index++) {
          const step = pick([
            "key",
            "clear-key",
            "sync",
            "tick",
            "remove",
            "replace",
            "pack",
            "start-ok",
            "start-refused",
            "start-dies",
            "refresh-ok",
            "refresh-fails",
            "refresh-dies",
            "lost",
          ] as const);
          trace.push(step);
          switch (step) {
            case "key": {
              const name = pick(["first", "second", "third"]);
              built.secrets.set(name, pick([KEY, OTHER_KEY, THIRD_KEY]));
              yield* call(step, source.selectKeySecret(name));
              break;
            }
            case "clear-key":
              yield* call(step, source.selectKeySecret(null));
              break;
            case "sync":
              yield* call(step, source.syncNow);
              break;
            case "tick":
              yield* TestClock.adjust("5 minutes");
              break;
            case "remove":
              yield* call(step, source.removeData);
              break;
            case "replace":
              yield* call(step, source.replaceData(pick([7, 99])));
              break;
            case "pack":
              yield* built.packChanged;
              break;
            case "start-ok":
              built.behaviour.die = false;
              built.setAnswer("ready");
              break;
            case "start-refused":
              built.behaviour.die = false;
              built.setAnswer("pack-absent");
              break;
            case "start-dies":
              built.behaviour.die = true;
              break;
            case "refresh-ok":
              built.behaviour.refresh = Effect.void;
              break;
            case "refresh-fails":
              built.behaviour.refresh = failed("offline");
              break;
            case "refresh-dies":
              built.behaviour.refresh = Effect.die("the request broke");
              break;
            case "lost": {
              const worker = built.workers.at(-1);
              if (worker) yield* worker.breakChanges;
              break;
            }
          }
          if (next() < 0.5) yield* settle;
        }
        built.behaviour.die = false;
        built.behaviour.refresh = Effect.void;
        built.setAnswer("ready");
        yield* settle;
        const at = `${sequence} ${trace.join(" ")}`;
        const check = (when: string) => {
          for (const { name, fiber } of calls.splice(0)) {
            const exit = fiber.pollUnsafe();
            const answer =
              exit && Exit.isSuccess(exit) ? exit.value : undefined;
            if (answer === undefined)
              problems.push(`${at}: ${name} has no answer ${when}`);
            else if (
              Exit.isFailure(answer) &&
              !(Cause.squash(answer.cause) instanceof DbUnavailable)
            )
              problems.push(`${at}: ${name} is not typed`);
          }
        };
        check("before the unload");
        const outcome = ({
          what,
          answer,
          ok,
          message,
        }: {
          readonly what: string;
          readonly answer: Exit.Exit<void, DbUnavailable | UserCancelled>;
          readonly ok: boolean;
          readonly message?: string;
        }) => {
          if (Exit.isSuccess(answer) !== ok)
            problems.push(`${at}: ${what} ${ok ? "failed" : "succeeded"}`);
          else if (
            message !== undefined &&
            Exit.isFailure(answer) &&
            Cause.squash(answer.cause) instanceof DbUnavailable &&
            (Cause.squash(answer.cause) as DbUnavailable).message !== message
          )
            problems.push(`${at}: ${what} answered another reason`);
        };
        const consented = built.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY);
        const own =
          typeof consented === "number"
            ? consented
            : (built.replica.account ?? 42);
        const keyOf = (account: number) =>
          Object.entries(ACCOUNTS).find(([, id]) => id === account)![0];
        const answerOf = (
          effect: Effect.Effect<void, DbUnavailable | UserCancelled>,
        ) => Effect.andThen(settle, Effect.exit(effect));
        built.secrets.set("probe", keyOf(own));
        yield* source.selectKeySecret("probe");
        outcome({
          what: "Sync now with the key of the account",
          answer: yield* answerOf(source.syncNow),
          ok: true,
        });
        const other = own === 99 ? 42 : 99;
        built.secrets.set("probe", keyOf(other));
        yield* source.selectKeySecret("probe");
        yield* Effect.ignore(answerOf(source.syncNow));
        outcome({
          what: "Replace data for the checked other account",
          answer: yield* answerOf(source.replaceData(other)),
          ok: true,
        });
        yield* settle;
        if (built.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY) !== other)
          problems.push(`${at}: Replace data did not move the consent`);
        yield* source.selectKeySecret(null);
        outcome({
          what: "Sync now with no key",
          answer: yield* answerOf(source.syncNow),
          ok: false,
          message: statusText({ kind: "no-key" }, formatSyncTime),
        });
        yield* Scope.close(lifetime, Exit.void);
        yield* settle;
        check("after the unload");
      }
      expect(problems).toEqual([]);
    }),
);
it.effect(
  "fails the reads that wait for the first start with DbUnavailable when the plugin unloads",
  () =>
    Effect.gen(function* () {
      const device = new MemoryDeviceStorage();
      device.saveLocalStorage(LIBRARY_SOURCE_KEY, "web-api");
      device.saveLocalStorage(WEB_API_KEY_SECRET_KEY, SECRET_NAME);
      const settings =
        yield* SubscriptionRef.make<Readonly<Settings>>(platformDefaults);
      const lifetime = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        layerLibrarySource({
          startWeb: () => Effect.never,
          poolDirectory: Effect.succeed("/zotlit/test-vault"),
          systemLanguage: Effect.succeed("en-US"),
          focused: Stream.never,
          secrets: { getSecret: () => KEY },
          reload: Effect.void,
          removesReplicaFolder: false,
          removeStoredReplica: () => Effect.void,
          otherStoredReplicas: Effect.succeed({
            scope: "gone-vaults",
            folders: [],
          }),
          removeOtherStoredReplica: () => Effect.void,
        }).pipe(
          Layer.provide([
            layerDeviceStorageFrom(device),
            Layer.mock(PluginSettings)({
              current: SubscriptionRef.get(settings),
              changes: SubscriptionRef.changes(settings),
            }),
            Layer.mock(ResourcePackPlatform)({
              locate: Effect.succeed(null),
              changes: Stream.never,
            }),
            Layer.succeed(
              ObsidianEnv,
              stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
                language: "en",
              }),
            ),
          ]),
        ),
        lifetime,
      );
      const source = Context.get(context, LibrarySource);
      yield* settle;
      expect((yield* source.view).status).toEqual({ kind: "starting" });
      const held = yield* Effect.forkChild(
        Effect.exit(source.reads!.Libraries({})),
        {
          startImmediately: true,
        },
      );
      yield* settle;
      expect(held.pollUnsafe()).toBeUndefined();
      yield* Scope.close(lifetime, Exit.void);
      const exit = yield* Fiber.join(held);
      expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(true);
      expect(
        Exit.isFailure(exit) ? Cause.squash(exit.cause) : null,
      ).toBeInstanceOf(DbUnavailable);
    }).pipe(Effect.scoped),
);

it.effect("publishes one degraded event when the Worker stops answering", () =>
  Effect.gen(function* () {
    const built = yield* setup({ source: "web-api", key: KEY });
    const source = yield* serviceOf(built);
    yield* settle;
    const seen: string[] = [];
    yield* Stream.runForEach(source.reads!.Changes(), (event) =>
      Effect.sync(() => {
        seen.push(event._tag === "state" ? `state:${event.state}` : event._tag);
      }),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* settle;
    seen.length = 0;
    yield* built.workers[0]!.breakChanges;
    yield* settle;
    expect(seen).toEqual(["state:degraded"]);
  }).pipe(Effect.scoped),
);

it.effect(
  "offers Replace data exactly for the checked account of the current key, and no Sync now while a removal runs",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: OTHER_KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      expect((yield* source.view).actions).toMatchObject({
        syncNow: true,
        replace: 99,
      });
      built.secrets.set("third-key", THIRD_KEY);
      const gate = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(gate);
      yield* source.selectKeySecret("third-key");
      expect((yield* source.view).actions.replace).toBeNull();
      yield* Deferred.succeed(gate, undefined);
      yield* settle;
      expect((yield* source.view).actions.replace).toBe(7);

      const removing = yield* Deferred.make<void>();
      built.behaviour.remove = Deferred.await(removing);
      const removal = yield* Effect.forkChild(source.removeData, {
        startImmediately: true,
      });
      yield* settle;
      expect((yield* source.view).actions).toMatchObject({
        syncNow: false,
        replace: null,
      });
      yield* Deferred.succeed(removing, undefined);
      yield* Fiber.join(removal);
    }).pipe(Effect.scoped),
);

it.effect(
  "answers a Sync now of the old key with the check of the new key, also when the old check ends while Configure runs",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      const refresh = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(refresh);
      const waiting = yield* Effect.forkChild(Effect.exit(source.syncNow), {
        startImmediately: true,
      });
      yield* settle;
      const configure = yield* Deferred.make<void>();
      built.behaviour.configure = Deferred.await(configure);
      built.secrets.set("second-key", OTHER_KEY);
      const selecting = yield* Effect.forkChild(
        source.selectKeySecret("second-key"),
        { startImmediately: true },
      );
      yield* settle;
      built.behaviour.refresh = Effect.void;
      yield* Deferred.succeed(refresh, undefined);
      yield* settle;
      expect(waiting.pollUnsafe()).toBeUndefined();
      built.behaviour.configure = Effect.void;
      yield* Deferred.succeed(configure, undefined);
      yield* Fiber.join(selecting);
      yield* settle;
      const answer = yield* Fiber.join(waiting);
      expect(Exit.isFailure(answer)).toBe(true);
      expect(
        Exit.isFailure(answer) && Cause.squash(answer.cause),
      ).toMatchObject({
        message: "another account",
      });
    }).pipe(Effect.scoped),
);

it.effect(
  "withdraws Replace data when a later check rejects the same key, also a check through the reads",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: OTHER_KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      expect((yield* source.view).actions.replace).toBe(99);
      built.behaviour.revoked.add(OTHER_KEY);
      yield* Effect.ignore(source.reads!.Refresh());
      yield* settle;
      expect((yield* source.view).status).toMatchObject({
        sync: { problem: { _tag: "key-invalid" } },
      });
      expect((yield* source.view).actions.replace).toBeNull();
      expect(yield* Effect.flip(source.replaceData(99))).toMatchObject({
        message: m.settings_online_replace_stale(),
      });
      expect(built.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY)).toBe(42);
    }).pipe(Effect.scoped),
);

it.effect("disables Sync now as soon as a removal is requested", () =>
  Effect.gen(function* () {
    const built = yield* setup({ source: "web-api", key: KEY });
    const source = yield* serviceOf(built);
    yield* settle;
    const configure = yield* Deferred.make<void>();
    built.behaviour.configure = Deferred.await(configure);
    yield* SubscriptionRef.update(built.settings, (current) => ({
      ...current,
      "zotero.language": "en-GB",
    }));
    yield* settle;
    const removal = yield* Effect.forkChild(source.removeData, {
      startImmediately: true,
    });
    expect((yield* source.view).actions.syncNow).toBe(false);
    built.behaviour.configure = Effect.void;
    yield* Deferred.succeed(configure, undefined);
    yield* Fiber.join(removal);
  }).pipe(Effect.scoped),
);

it.effect(
  "publishes one degraded event when the session unloads with a Worker attached, and answers a later caller with the stopped error",
  () =>
    Effect.gen(function* () {
      const lifetime = yield* Scope.make();
      const built = yield* setup({ source: "web-api", key: KEY }).pipe(
        Scope.provide(lifetime),
      );
      const source = yield* serviceOf(built);
      yield* settle;
      const seen: string[] = [];
      yield* Stream.runForEach(source.reads!.Changes(), (event) =>
        Effect.sync(() => {
          seen.push(
            event._tag === "state" ? `state:${event.state}` : event._tag,
          );
        }),
      ).pipe(Effect.ignore, Effect.forkScoped({ startImmediately: true }));
      yield* settle;
      seen.length = 0;
      yield* Scope.close(lifetime, Exit.void);
      yield* settle;
      expect(seen.filter((tag) => tag === "state:degraded")).toHaveLength(1);
      const late = yield* Effect.forkChild(Effect.exit(source.syncNow), {
        startImmediately: true,
      });
      yield* settle;
      const answer = late.pollUnsafe();
      expect(
        answer && Exit.isSuccess(answer) && Exit.isFailure(answer.value),
      ).toBe(true);
    }).pipe(Effect.scoped),
);

it.effect(
  "stops the online library and fails a read with DbUnavailable when its Worker stops during a Configure",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      built.behaviour.configure = Effect.never;
      yield* SubscriptionRef.update(built.settings, (current) => ({
        ...current,
        "zotero.language": "en-GB",
      }));
      yield* settle;
      yield* built.workers[0]!.breakChanges;
      yield* settle;
      expect((yield* source.view).status).toEqual({ kind: "stopped" });
      expect(yield* Effect.flip(source.reads!.Libraries({}))).toMatchObject({
        _tag: "DbUnavailable",
      });
    }).pipe(Effect.scoped),
);

it.effect(
  "fails a Configure in flight with the RPC error of its stopped Worker",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      built.behaviour.configure = Effect.never;
      const configure = yield* Effect.forkChild(
        Effect.flip(source.reads!.Configure(built.workers[0]!.configs[0]!)),
        { startImmediately: true },
      );
      yield* settle;
      yield* built.workers[0]!.breakChanges;
      yield* settle;
      expect(yield* Fiber.join(configure)).toMatchObject({
        _tag: "RpcClientError",
        reason: { cause: { _tag: "DbUnavailable" } },
      });
    }).pipe(Effect.scoped),
);

const crashSequences: Readonly<
  Record<
    string,
    {
      readonly key: string;
      readonly consented: number | null;
      readonly replica: () => Replica;
      readonly act: (
        built: Effect.Success<ReturnType<typeof setup>>,
      ) => Effect.Effect<void, unknown>;
      readonly before: readonly number[];
      readonly after: readonly number[];
      readonly removes?: true;
      readonly actsAtStart?: true;
    }
  >
> = {
  "the first build with no recorded account": {
    key: KEY,
    consented: null,
    replica: emptyReplica,
    actsAtStart: true,
    act: (built) =>
      Effect.flatMap(serviceOf(built), (source) => source.syncNow),
    before: [42],
    after: [42],
  },
  "Replace data for the account of a new key": {
    key: OTHER_KEY,
    consented: 42,
    replica: () => replicaOf(42),
    act: (built) =>
      Effect.gen(function* () {
        const source = yield* serviceOf(built);
        yield* Effect.ignore(source.syncNow);
        yield* settle;
        yield* source.replaceData(99);
        yield* settle;
        yield* source.syncNow;
      }),
    before: [42],
    after: [99],
  },
  "Remove online library data": {
    key: KEY,
    consented: 42,
    replica: () => replicaOf(42),
    act: (built) =>
      Effect.flatMap(serviceOf(built), (source) => source.removeData),
    before: [42],
    after: [],
    removes: true,
  },
  "a change of the Zotero language": {
    key: KEY,
    consented: 42,
    replica: () => replicaOf(42),
    act: (built) =>
      Effect.gen(function* () {
        const source = yield* serviceOf(built);
        yield* SubscriptionRef.update(built.settings, (current) => ({
          ...current,
          "zotero.language": "en-GB",
        }));
        yield* settle;
        yield* source.syncNow;
      }),
    before: [42],
    after: [42],
  },
};

const CRASH_RESTARTS = [
  ["the same key, the same language", KEY, false],
  ["the same key, another language", KEY, true],
  ["a key of another account, the same language", OTHER_KEY, false],
  ["a key of another account, another language", OTHER_KEY, true],
  ["no key, the same language", null, false],
  ["no key, another language", null, true],
] as const;

const seededDevice = (values: ReadonlyMap<string, string>) => {
  const device = new FailingDeviceStorage();
  for (const [key, value] of values) device.values.set(key, value);
  return device;
};

const replayWrites = (
  initial: ReadonlyMap<string, string>,
  start: Replica,
  log: readonly string[],
) => {
  const device = seededDevice(initial);
  const replica = { ...start };
  for (const entry of log) {
    const write = /^(?<key>zotlit-[^=]+)=(?<data>.*)$/u.exec(entry);
    if (write?.groups)
      device.saveLocalStorage(
        write.groups.key!,
        JSON.parse(write.groups.data!) as unknown,
      );
    else if (entry.startsWith("delete:"))
      Object.assign(replica, emptyReplica());
    else if (entry.startsWith("download:")) {
      const [, account, locale] = entry.split(":");
      Object.assign(replica, {
        account: Number(account),
        locale: locale!,
        committed: true,
      });
    }
  }
  device.writes.length = 0;
  return { device, replica };
};

const crashViolations = ({
  events,
  chosen,
  replaced,
  removes,
}: {
  readonly events: readonly string[];
  readonly chosen: ReadonlySet<number>;
  readonly replaced: ReadonlySet<number>;
  readonly removes: boolean;
}) =>
  events.flatMap((entry) => {
    const account = Number(entry.split(":")[1]);
    if (entry.startsWith("download:"))
      return chosen.has(account)
        ? []
        : [`${entry}, an account the user did not choose`];
    return removes || replaced.has(account) || chosen.has(account)
      ? []
      : [`${entry}, data the user did not ask to remove or replace`];
  });

const CRASH_ROWS = Object.keys(crashSequences).flatMap((name) =>
  CRASH_RESTARTS.flatMap(([variant, key, changed]) =>
    [false, true].map(
      (unreadable) =>
        [
          name,
          unreadable ? `${variant}, and an unreadable account record` : variant,
          key,
          changed,
          unreadable,
        ] as const,
    ),
  ),
);

it.effect.each(CRASH_ROWS)(
  "every crash point of %s, restarted with %s: no data is deleted and no account downloaded without consent (on a device with no data, the account of the key in the selected secret is consented at the first completed check, also after a restart), and the replica converges to the configured language",
  ([name, _variant, restartKey, changed, unreadable]) =>
    Effect.gen(function* () {
      const sequence = crashSequences[name]!;
      const seed = new Map<string, string>();
      const seeding = seededDevice(seed);
      seeding.saveLocalStorage(LIBRARY_SOURCE_KEY, "web-api");
      seeding.saveLocalStorage(WEB_API_URL_KEY, "http://127.0.0.1:9");
      seeding.saveLocalStorage(WEB_API_KEY_SECRET_KEY, SECRET_NAME);
      if (sequence.consented !== null)
        seeding.saveLocalStorage(CONSENTED_ACCOUNT_KEY, sequence.consented);
      const seeded = new Map(seeding.values);
      const acting = yield* Scope.make();
      const built = yield* setup({
        key: sequence.key,
        device: seededDevice(seeded),
        replica: sequence.replica(),
        language: "en-US",
      }).pipe(Scope.provide(acting));
      if (!sequence.actsAtStart) yield* settle;
      const started = built.device.writes.length;
      const base = replayWrites(
        seeded,
        sequence.replica(),
        built.device.writes.slice(0, started),
      );
      const initial = new Map(base.device.values);
      const start = base.replica;
      yield* sequence.act(built);
      yield* settle;
      yield* Scope.close(acting, Exit.void);
      const log = built.device.writes.slice(started);
      expect(log.some((entry) => /^(download|delete):/u.test(entry))).toBe(
        true,
      );

      const failures: string[] = [];
      for (let cut = 0; cut <= log.length; cut++) {
        const prefix = log.slice(0, cut);
        const world = replayWrites(initial, start, prefix);
        const atCut = { ...world.replica };
        const language =
          (name === "a change of the Zotero language") !== changed
            ? "en-GB"
            : "en-US";
        if (unreadable) world.device.unreadable.add(CONSENTED_ACCOUNT_KEY);
        const restarting = yield* Scope.make();
        const restarted = yield* setup({
          ...(restartKey === null ? {} : { key: restartKey }),
          device: world.device,
          replica: world.replica,
          language,
        }).pipe(Scope.provide(restarting));
        yield* settle;
        yield* Effect.ignore(
          Effect.flatMap(serviceOf(restarted), (source) => source.syncNow),
        );
        yield* settle;
        yield* Scope.close(restarting, Exit.void);
        const restartLog = world.device.writes;
        const keyAccount = restartKey === null ? null : ACCOUNTS[restartKey]!;
        const untouched = !prefix.some((entry) =>
          /^(zotlit-|download:|delete:)/u.test(entry),
        );
        const consentedOnEmptyDevice =
          sequence.consented === null &&
          untouched &&
          atCut.account === undefined &&
          keyAccount !== null
            ? [keyAccount]
            : [];
        const chosen = new Set(
          untouched ? [...sequence.before, ...sequence.after] : sequence.after,
        );
        const permitted = new Set([...chosen, ...consentedOnEmptyDevice]);
        const settled = new Set(
          untouched
            ? [...sequence.before, ...consentedOnEmptyDevice].filter(
                (id) =>
                  sequence.after.includes(id) ||
                  consentedOnEmptyDevice.includes(id),
              )
            : sequence.after,
        );
        const events = [...prefix, ...restartLog].filter(
          (entry) =>
            entry.startsWith("download:") || entry.startsWith("delete:"),
        );
        const at = `cut ${cut} (after ${prefix.at(-1) ?? "nothing"})`;
        const granted = restartLog.filter(
          (entry) =>
            entry.startsWith("download:") ||
            (entry.startsWith(`${CONSENTED_ACCOUNT_KEY}=`) &&
              /=\d/u.test(entry)),
        );
        if (unreadable && granted.length > 0)
          failures.push(
            `${at}: ${granted.join(", ")} while the account record cannot be read`,
          );
        for (const violation of crashViolations({
          events,
          chosen: permitted,
          replaced: new Set(
            sequence.before.filter(
              (id) => !sequence.after.includes(id) && !sequence.removes,
            ),
          ),
          removes: sequence.removes === true,
        }))
          failures.push(`${at}: ${violation}`);
        if (
          keyAccount !== null &&
          !permitted.has(keyAccount) &&
          !sequence.removes &&
          JSON.stringify(world.replica) !== JSON.stringify(atCut)
        )
          failures.push(
            `${at}: the replica changed from ${JSON.stringify(atCut)} to ${JSON.stringify(world.replica)} for a key the user did not choose`,
          );
        if (
          keyAccount !== null &&
          !unreadable &&
          settled.has(keyAccount) &&
          !(sequence.removes && !untouched) &&
          !(world.replica.committed && world.replica.locale === language)
        )
          failures.push(
            `${at}: the replica is ${JSON.stringify(world.replica)} for ${language}`,
          );
      }
      expect(failures).toEqual([]);
    }),
);

it.effect.each([
  "the key is cleared",
  "the data is removed",
  "the plugin unloads",
])(
  "answers an active stream of the online library with DbUnavailable when %s, before the Worker transport closes",
  (stop) =>
    Effect.gen(function* () {
      const lifetime = yield* Scope.make();
      const built = yield* setup({ source: "web-api", key: KEY, lifetime });
      const source = yield* serviceOf(built);
      const reading = yield* Effect.forkChild(
        Effect.flip(Stream.runDrain(source.reads!.Snapshot())),
        { startImmediately: true },
      );
      yield* settle;
      if (stop === "the key is cleared") {
        built.secrets.set(SECRET_NAME, "");
        yield* TestClock.adjust("5 minutes");
      } else if (stop === "the data is removed") yield* source.removeData;
      else yield* Scope.close(lifetime, Exit.void);
      yield* settle;
      expect(reading.pollUnsafe()).toBeDefined();
      expect(yield* Fiber.join(reading)).toBeInstanceOf(DbUnavailable);
    }).pipe(Effect.scoped),
);

it.effect(
  "removes the online library data while a stream of the online library is open: it ends the stream with DbUnavailable first, as the Worker removes the replica only after its readers let go",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      const reading = yield* Effect.forkChild(
        Effect.flip(Stream.runDrain(source.reads!.Snapshot())),
        { startImmediately: true },
      );
      yield* settle;

      yield* source.removeData;

      expect(built.workers[0]!.calls).toContain("RemoveReplica");
      expect(yield* Fiber.join(reading)).toBeInstanceOf(DbUnavailable);
    }).pipe(Effect.scoped),
);

it.effect(
  "shows the progress that the Worker pushes, the latest value at most each 250 ms, until the sync ends",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      const progressOf = Effect.map(source.view, (view) =>
        view.status.kind === "running" ? view.status.sync.progress : "none",
      );
      const gate = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(gate);
      built.behaviour.status = { ...SYNCED, syncing: true };
      const syncing = yield* Effect.forkChild(source.syncNow, {
        startImmediately: true,
      });
      yield* settle;
      const worker = built.workers[0]!;
      yield* worker.push({ phase: "download", done: 10, total: 100 });
      yield* settle;
      expect(yield* progressOf).toEqual({
        phase: "download",
        done: 10,
        total: 100,
      });
      yield* worker.push({ phase: "download", done: 20, total: 100 });
      yield* worker.push({ phase: "download", done: 30, total: 100 });
      yield* settle;
      expect(yield* progressOf).toMatchObject({ done: 10 });
      yield* TestClock.adjust("250 millis");
      yield* settle;
      expect(yield* progressOf).toEqual({
        phase: "download",
        done: 30,
        total: 100,
      });
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(yield* progressOf).toMatchObject({ done: 30 });
      built.behaviour.status = SYNCED;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(syncing);
      yield* settle;
      expect(yield* progressOf).toBeNull();
    }).pipe(Effect.scoped),
);

it.effect(
  "shows the end of a sync as soon as the Worker reports it, with no wait for the next status read",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      const gate = yield* Deferred.make<void>();
      built.behaviour.refresh = Deferred.await(gate);
      built.behaviour.status = { ...SYNCED, syncing: true };
      const syncing = yield* Effect.forkChild(source.syncNow, {
        startImmediately: true,
      });
      yield* built.workers[0]!.refreshing;
      yield* settle;
      const syncingNow = Effect.map(
        source.view,
        (view) => view.status.kind === "running" && view.status.sync.syncing,
      );
      expect(yield* syncingNow).toBe(true);
      built.behaviour.status = SYNCED;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(syncing);
      yield* settle;
      expect(yield* syncingNow).toBe(false);
    }).pipe(Effect.scoped),
);

const syncingAs = (
  built: Effect.Success<ReturnType<typeof setup>>,
  syncId: number,
  worker = 0,
) =>
  Effect.gen(function* () {
    built.behaviour.status = { ...SYNCED, syncing: true, syncId };
    yield* built.workers[worker]!.refreshing;
    yield* settle;
  });

const stopOf = (source: LibrarySource["Service"]) =>
  Effect.map(source.view, (view) => view.stop ?? null);

it.effect(
  "ends a Sync now with UserCancelled when the Worker reports the stop of its sync, and with its failure otherwise",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      built.behaviour.refresh = Effect.fail(
        new DbUnavailable({ message: "The sync stopped before it finished" }),
      );
      built.behaviour.status = {
        ...SYNCED,
        problem: { _tag: "stopped", message: "stopped" },
      };
      expect(yield* Effect.flip(source.syncNow)).toBeInstanceOf(UserCancelled);

      built.behaviour.refresh = Effect.fail(
        new DbUnavailable({ message: "offline" }),
      );
      built.behaviour.status = SYNCED;
      expect(yield* Effect.flip(source.syncNow)).toBeInstanceOf(DbUnavailable);
    }).pipe(Effect.scoped),
);

it.effect(
  "ends a Sync now with UserCancelled when the user stops the download that follows the first consent",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: "refused0invented0key0000",
        consented: null,
        replica: emptyReplica(),
      });
      const source = yield* serviceOf(built);
      yield* settle;
      let refreshes = 0;
      built.behaviour.refresh = Effect.suspend(() => {
        if (++refreshes === 1) return Effect.void;
        built.behaviour.status = {
          ...SYNCED,
          problem: { _tag: "stopped", message: "stopped" },
        };
        return Effect.fail(
          new DbUnavailable({ message: "The sync stopped before it finished" }),
        );
      });
      built.secrets.set("working-key", KEY);
      yield* source.selectKeySecret("working-key");
      expect(yield* Effect.flip(source.syncNow)).toBeInstanceOf(UserCancelled);
      expect(refreshes).toBe(2);
      expect(built.device.loadLocalStorage(CONSENTED_ACCOUNT_KEY)).toBe(42);
    }).pipe(Effect.scoped),
);

it.effect(
  "starts a new Worker with no stop state, also when its sync has the number of a stopped sync of the Worker before it",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      yield* syncingAs(built, 7);
      built.behaviour.stop = Effect.succeed(true);
      yield* source.stopSync;
      expect(yield* stopOf(source)).toEqual({ syncId: 7, state: "confirmed" });

      yield* source.selectKeySecret(null);
      yield* source.selectKeySecret(SECRET_NAME);
      yield* settle;
      expect(built.workers).toHaveLength(2);
      yield* syncingAs(built, 7, 1);
      expect((yield* source.view).status).toMatchObject({
        kind: "running",
        sync: { syncing: true, syncId: 7 },
      });
      expect(yield* stopOf(source)).toBeNull();
      yield* source.stopSync;
      expect(
        built.workers[1]!.calls.filter((call) => call.startsWith("StopSync")),
      ).toEqual(["StopSync:7"]);
      expect(yield* stopOf(source)).toEqual({ syncId: 7, state: "confirmed" });
    }).pipe(Effect.scoped),
);

it.effect(
  "asks the Worker once when Stop sync is pressed twice, also for a sync that the Worker started",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      yield* syncingAs(built, 7);
      const entered = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<void>();
      built.behaviour.stop = Effect.andThen(
        Deferred.succeed(entered, undefined),
        Effect.as(Deferred.await(answer), true),
      );
      const first = yield* Effect.forkChild(source.stopSync, {
        startImmediately: true,
      });
      yield* Deferred.await(entered);
      expect(yield* stopOf(source)).toEqual({ syncId: 7, state: "requested" });
      const second = yield* Effect.forkChild(source.stopSync, {
        startImmediately: true,
      });
      yield* Deferred.succeed(answer, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(
        built.workers[0]!.calls.filter((call) => call.startsWith("StopSync")),
      ).toEqual(["StopSync:7"]);
      expect(yield* stopOf(source)).toEqual({ syncId: 7, state: "confirmed" });
    }).pipe(Effect.scoped),
);

it.effect(
  "settles a stop that is interrupted before the Worker answers as failed, and a later press asks again",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      yield* syncingAs(built, 3);
      const entered = yield* Deferred.make<void>();
      built.behaviour.stop = Effect.andThen(
        Deferred.succeed(entered, undefined),
        Effect.never,
      );
      const stopping = yield* Effect.forkChild(source.stopSync, {
        startImmediately: true,
      });
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(stopping);
      expect(yield* stopOf(source)).toEqual({ syncId: 3, state: "failed" });

      built.behaviour.stop = Effect.succeed(true);
      yield* source.stopSync;
      expect(yield* stopOf(source)).toEqual({ syncId: 3, state: "confirmed" });
      expect(
        built.workers[0]!.calls.filter((call) => call.startsWith("StopSync")),
      ).toEqual(["StopSync:3", "StopSync:3"]);
    }).pipe(Effect.scoped),
);

it.effect(
  "tells a stop that got no answer apart from a stop that the Worker refused",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ source: "web-api", key: KEY });
      const source = yield* serviceOf(built);
      yield* settle;
      yield* syncingAs(built, 4);
      built.behaviour.stop = Effect.die(new Error("the Worker port closed"));
      yield* source.stopSync;
      expect(yield* stopOf(source)).toEqual({ syncId: 4, state: "failed" });

      built.behaviour.stop = Effect.succeed(false);
      yield* source.stopSync;
      expect(yield* stopOf(source)).toEqual({ syncId: 4, state: "refused" });
    }).pipe(Effect.scoped),
);

it.effect("drops the answer to a stop of a sync that has ended", () =>
  Effect.gen(function* () {
    const built = yield* setup({ source: "web-api", key: KEY });
    const source = yield* serviceOf(built);
    yield* settle;
    yield* syncingAs(built, 5);
    const entered = yield* Deferred.make<void>();
    const answer = yield* Deferred.make<void>();
    built.behaviour.stop = Effect.andThen(
      Deferred.succeed(entered, undefined),
      Effect.as(Deferred.await(answer), false),
    );
    const stopping = yield* Effect.forkChild(source.stopSync, {
      startImmediately: true,
    });
    yield* Deferred.await(entered);
    yield* syncingAs(built, 6);
    yield* Deferred.succeed(answer, undefined);
    yield* Fiber.join(stopping);
    expect(yield* stopOf(source)).toBeNull();
  }).pipe(Effect.scoped),
);

const GONE_VAULT: StoredReplicaFolder = {
  id: "removedvault0001",
  bytes: 52_428_800,
  changed: DateTime.makeUnsafe("2026-09-03T10:30:00Z"),
};
const OTHER_GONE_VAULT: StoredReplicaFolder = {
  id: "removedvault0002",
  bytes: 1_048_576,
  changed: null,
};

it.effect(
  "lists the online library data of other folders, and removes one folder with no change to the records, the Worker or the replica of this vault",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        source: "web-api",
        key: KEY,
        others: [GONE_VAULT, OTHER_GONE_VAULT],
      });
      const source = yield* serviceOf(built);
      yield* settle;
      expect(yield* source.otherData).toEqual({ kind: "unread" });

      yield* source.readOtherData;
      expect(yield* source.otherData).toEqual({
        kind: "listed",
        scope: "gone-vaults",
        folders: [GONE_VAULT, OTHER_GONE_VAULT],
      });

      const writes = [...built.device.writes];
      yield* source.removeOtherData(GONE_VAULT.id);
      expect(built.otherRemovals).toEqual([GONE_VAULT.id]);
      expect(yield* source.otherData).toEqual({
        kind: "listed",
        scope: "gone-vaults",
        folders: [OTHER_GONE_VAULT],
      });
      expect(built.device.writes).toEqual(writes);
      expect(built.removed).toEqual([]);
      expect(built.workers.every((worker) => !worker.stopped)).toBe(true);
      expect(built.workers.flatMap((worker) => worker.calls)).not.toContain(
        "RemoveReplica",
      );
    }).pipe(Effect.scoped),
);

it.effect(
  "names the reason when the data of other folders cannot be read, also while this vault reads the Zotero database file",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({
        othersUnreadable: new DbUnavailable({
          message: "ZotLit could not read the vault list of Obsidian",
        }),
      });
      const source = yield* serviceOf(built);
      yield* source.readOtherData;
      expect(yield* source.otherData).toEqual({
        kind: "unreadable",
        message: "ZotLit could not read the vault list of Obsidian",
      });
    }).pipe(Effect.scoped),
);

it.effect(
  "removes the online library data of this vault from the Advanced page while this vault reads the Zotero database file, and keeps the file source",
  () =>
    Effect.gen(function* () {
      const built = yield* setup({ key: KEY });
      const source = yield* serviceOf(built);
      yield* source.removeData;
      expect(built.removed).toEqual(["/zotlit/test-vault"]);
      expect((yield* source.view).status).toEqual({ kind: "file-source" });
      expect(built.workers).toEqual([]);
    }).pipe(Effect.scoped),
);
