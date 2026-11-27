import type { SeededApi } from "#__fixtures__/web-api.ts";
import type { ChangeEvent } from "#contract/rpc.ts";
import type { WebSyncStatus } from "#contract/web-worker-rpc.ts";
import { it } from "@effect/vitest";
import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  References,
  Scope,
  Stream,
} from "effect";
import * as Scheduler from "effect/Scheduler";
import { TestClock } from "effect/testing";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { getItemsByKey, getLibraries } from "@zotlit/db";
import type { ZoteroDatabase } from "@zotlit/db";
import { storedGroupLastReadSettings } from "@zotlit/db/replica";
import { stagingViolations } from "@zotlit/db/replica/staging-invariants";
import type {
  SqliteWasm,
  SqliteWasmDatabase,
} from "@zotlit/drizzle-sqlite-wasm";
import { browserScheduler } from "@zotlit/plugin-kernel/browser-scheduler.ts";
import { READ_ALL_ACCESS } from "@zotlit/web-library/fake-zotero-api/scenario";

import { Connection } from "./connection.ts";
import { makeInProcessClient } from "./in-process.ts";
import { layerUnpinnedConnectionItemSource } from "./item-source.ts";
import { wasmReplicaDriver } from "./replica-driver-wasm.ts";
import type { ReplicaDriver, ReplicaHandle } from "./replica-driver.ts";
import { layerAbsentFileSystem } from "./serve-web-api.ts";
import { WebLibrarySync } from "./web-api-source.ts";

import { inProcessClient } from "#__fixtures__/in-process.ts";
import { SEED } from "#__fixtures__/reads-seed.ts";
import {
  keptEngine,
  keyOwner,
  loadMemoryEngine,
  memoryWebApiSource,
  seededApi,
  webApiConfig,
} from "#__fixtures__/web-api.ts";
import { DbUnavailable } from "#contract/rpc.ts";
import { nodeReplicaDriver } from "#desktop/replica-driver-node.ts";
import { snapshotRevision } from "#desktop/snapshot-revision.ts";

const ACCOUNT = { userID: 42, username: "reader" } as const;
const HOLD_BACK = "50 millis";

const seeded = () => seededApi(SEED, ACCOUNT);

const titleOf = (client: ZoteroDatabase, key = "MAIN2345") =>
  (
    getItemsByKey(client, [key], { libraryID: 1 })[0]?.fields as
      | { readonly title?: string }
      | undefined
  )?.title;

const pause = (ms = 5) =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

const until = (predicate: () => boolean, what: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 400; i++) {
      if (predicate()) return;
      yield* pause();
    }
    throw new Error(`Timed out waiting for ${what}`);
  });

const untilStatus = (check: Effect.Effect<boolean>, what: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 400; i++) {
      if (yield* check) return;
      yield* pause();
    }
    throw new Error(`Timed out waiting for ${what}`);
  });

const source = (
  api: SeededApi,
  options: Parameters<typeof memoryWebApiSource>[1] = {},
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      memoryWebApiSource(api, { holdBack: HOLD_BACK, ...options }),
    );
    const connection = Context.get(context, Connection);
    const sync = Context.get(context, WebLibrarySync);
    const events: ChangeEvent[] = [];
    yield* Stream.runForEach(connection.changes, (event) =>
      Effect.sync(() => events.push(event)),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    return { context, connection, sync, events };
  });

const read = <A>(
  connection: Connection["Service"],
  f: (client: ZoteroDatabase) => A,
) => Effect.scoped(Effect.map(connection.borrow, (client) => f(client)));

const staging = (
  connection: Connection["Service"],
  options?: Parameters<typeof stagingViolations>[1],
) => read(connection, (client) => stagingViolations(client, options));

const keysRequests = (api: SeededApi) =>
  api.api.requests.filter((request) => request.path === "/keys/current").length;

const tags = (events: readonly ChangeEvent[]) =>
  events.map((event) =>
    event._tag === "state"
      ? `state:${event.state}`
      : event._tag === "refreshing"
        ? `refreshing:${event.active}`
        : event._tag,
  );

const lines: string[] = [];
const logger = Logger.make(({ message, cause, fiber }) => {
  lines.push(
    JSON.stringify({
      message,
      annotations: fiber.getRef(References.CurrentLogAnnotations),
    }) + String(cause),
  );
});

const eventually = <A>(
  attempt: Effect.Effect<A, unknown>,
  done: (value: A) => boolean,
) =>
  Effect.gen(function* () {
    let value = yield* attempt;
    for (let i = 0; i < 200 && !done(value); i++) {
      yield* pause();
      value = yield* attempt;
    }
    return value;
  });

describe("the Web API source", () => {
  it.live(
    "names the times of the last apply in the sync status: begin, commit and the time that reads waited",
    () =>
      Effect.gen(function* () {
        const { connection, sync } = yield* source(seeded());
        expect((yield* sync.status).lastApply).toBeUndefined();
        yield* connection.refresh;
        const { lastApply } = yield* sync.status;
        expect(lastApply).toMatchObject({ sequence: 1 });
        expect(lastApply!.committedAt).toBeGreaterThanOrEqual(
          lastApply!.beganAt,
        );
        expect(lastApply!.closedMillis).toBeGreaterThanOrEqual(
          lastApply!.applyMillis,
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "builds the replica on first open: loading, then ready, and a borrow waits for the build",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events } = yield* source(api);
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
        yield* until(
          () =>
            events.some(
              (event) => event._tag === "refreshing" && !event.active,
            ),
          "the end of the first sync",
        );
        expect(tags(events).filter((tag) => tag !== "refreshing:true")).toEqual(
          ["state:loading", "changed", "refreshing:false"],
        );
      }).pipe(Effect.scoped),
  );

  it.live("opens an existing replica and serves it at once, then syncs", () =>
    Effect.gen(function* () {
      const api = seeded();
      const kept = keptEngine(yield* Effect.promise(() => loadMemoryEngine()));
      const engine = Effect.succeed(kept.engine);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { connection } = yield* source(api, { engine });
          yield* read(connection, titleOf);
        }),
      );
      const release = api.api.hold(
        (request) => request.path === "/keys/current",
      );
      const { connection, events, sync } = yield* source(api, { engine });
      expect(yield* read(connection, (client) => titleOf(client))).toBe(
        "Main Study",
      );
      expect(tags(events)[0]).toBe("state:ready");
      expect((yield* sync.status).syncing).toBe(true);
      release();
      yield* connection.refresh;
      expect((yield* sync.status).syncing).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live(
    "reports refreshing during a sync, and a refresh during a sync joins it",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events, sync } = yield* source(api);
        yield* connection.refresh;
        const before = keysRequests(api);
        events.length = 0;
        const release = api.api.hold(
          (request) => request.path === "/keys/current",
        );
        const first = yield* Effect.forkChild(connection.refresh);
        const second = yield* Effect.forkChild(connection.refresh);
        yield* until(() => keysRequests(api) > before, "the key check");
        expect((yield* sync.status).syncing).toBe(true);
        expect(tags(events)).toEqual(["refreshing:true"]);
        release();
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        expect(keysRequests(api)).toBe(before + 1);
        expect(tags(events)).toEqual(["refreshing:true", "refreshing:false"]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps reads ready on the last good replica after a failed sync, records the problem in the status, then clears it on a later good sync",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events, sync } = yield* source(api);
        yield* connection.refresh;
        events.length = 0;
        api.api.revokeKey(api.key);
        const failure = yield* Effect.flip(connection.refresh);
        expect(failure).toBeInstanceOf(DbUnavailable);
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          problem: { _tag: "key-invalid" },
        });
        expect(tags(events)).not.toContain("refresh-failed");
        expect(tags(events)).not.toContain("degraded");
        expect(events).not.toContainEqual(
          expect.objectContaining({ _tag: "state", state: "degraded" }),
        );
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
        api.api.addKey(api.key, READ_ALL_ACCESS);
        events.length = 0;
        yield* connection.refresh;
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          problem: null,
        });
        expect(events).toContainEqual({
          _tag: "state",
          state: "ready",
          error: null,
        });
      }).pipe(Effect.scoped),
  );

  it.live(
    "reports a key that no header can carry as an invalid key with none of it in the status, and sends no request",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const malformed = "invented0key\r\nX-Other: 1";
        const before = api.api.requests.length;
        yield* connection.configure(webApiConfig(malformed));
        yield* Effect.ignore(connection.refresh);
        const status = yield* sync.status;
        expect(status.problem).toMatchObject({ _tag: "key-invalid" });
        expect(JSON.stringify(status)).not.toContain("invented0key");
        expect(api.api.requests.length).toBe(before);
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps reads ready with the failed library and applies the others",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        api.api.library({ type: "user", id: 42 }).updateItem("MAIN2345", {
          title: "Changed in the personal library",
        });
        api.api.library({ type: "group", id: 900 }).updateItem("GRPITEMS", {
          title: "Changed in the group",
        });
        api.api.inject({
          match: (request) => request.path.startsWith("/groups/900/"),
          times: 100,
          answer: { status: 400, body: "Bad request" },
        });
        yield* Effect.flip(connection.refresh);
        const status = yield* sync.status;
        expect(status.state).toBe("ready");
        expect(status.problem).toMatchObject({
          _tag: "libraries-failed",
          libraries: [{ library: { type: "group", id: 900 } }],
        });
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Changed in the personal library",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "commits a sliced apply that changes only the read time of a group attachment, and publishes the change",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
        });
        api.api.library({ type: "group", id: 900 }).putItem({
          key: "GPDF2345",
          itemType: "attachment",
          parentItem: "GRPITEMS",
          linkMode: "imported_file",
          title: "g.pdf",
          contentType: "application/pdf",
          filename: "g.pdf",
        });
        yield* connection.refresh;
        const readTimes = read(connection, storedGroupLastReadSettings);
        expect(yield* readTimes).toEqual([]);
        events.length = 0;
        api.api.user.putSetting("lastRead_g900_GPDF2345", 1700000000);
        yield* connection.refresh;
        expect(yield* readTimes).toEqual(["lastRead_g900_GPDF2345"]);
        expect(tags(events)).toContain("changed");
      }).pipe(Effect.scoped),
  );

  it.live(
    "begins the apply of a sync only when a reader that holds a borrow lets go; the pinned reader sees the old data, then a new client sees the new data",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events, sync } = yield* source(api);
        yield* connection.refresh;
        const pin = yield* Scope.make();
        const pinned = yield* Scope.provide(connection.borrow, pin);
        api.api.library({ type: "user", id: 42 }).updateItem("MAIN2345", {
          title: "Changed on the web",
        });
        events.length = 0;
        const refreshing = yield* Effect.forkChild(connection.refresh);
        yield* untilStatus(
          Effect.map(sync.status, (status) => status.waitingForReaders),
          "the apply to wait",
        );
        expect((yield* sync.status).progress).toBeNull();
        expect(titleOf(pinned)).toBe("Main Study");
        const during = yield* read(connection, (client) => ({
          same: client === pinned,
          title: titleOf(client),
        }));
        expect(during).toEqual({ same: true, title: "Main Study" });
        expect(titleOf(pinned)).toBe("Main Study");
        expect(tags(events)).not.toContain("changed");
        yield* Scope.close(pin, Exit.void);
        yield* Fiber.join(refreshing);
        const after = yield* read(connection, (client) => ({
          same: client === pinned,
          title: titleOf(client),
        }));
        expect(after).toEqual({ same: false, title: "Changed on the web" });
        expect(tags(events)).toContain("changed");
      }).pipe(Effect.scoped),
  );

  it.live(
    "stops a running sync when the key changes, syncs again with the new key, and the waiting refresh ends with that sync",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const before = keysRequests(api);
        const release = api.api.hold(
          (request) => request.path === "/keys/current",
        );
        const running = yield* Effect.forkChild(connection.refresh);
        yield* until(() => keysRequests(api) > before, "the key check");
        const next = "replacementkey0000000000";
        api.api.addKey(next, READ_ALL_ACCESS);
        api.api.revokeKey(api.key);
        yield* connection.configure(webApiConfig(next));
        release();
        expect((yield* Fiber.await(running))._tag).toBe("Success");
        yield* until(
          () => keysRequests(api) === before + 2,
          "the key check of the new sync",
        );
        yield* untilStatus(
          Effect.map(sync.status, (status) => !status.syncing),
          "the sync with the new key",
        );
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          problem: null,
        });
        expect(keysRequests(api)).toBe(before + 2);
      }).pipe(Effect.scoped),
  );

  it.live(
    "publishes the change and leaves loading when the key changes while the first apply runs",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const next = "applychangekey0000000000";
        api.api.addKey(next, READ_ALL_ACCESS);
        let configured = false;
        let onSlice: Effect.Effect<void> = Effect.void;
        const context = yield* Layer.build(
          memoryWebApiSource(api, {
            holdBack: HOLD_BACK,
            slicing: { pageSize: 1, sliceMillis: 0 },
            betweenSlices: Effect.suspend(() => onSlice),
          }),
        );
        const connection = Context.get(context, Connection);
        const sync = Context.get(context, WebLibrarySync);
        const events: ChangeEvent[] = [];
        onSlice = Effect.suspend(() => {
          if (configured) return Effect.void;
          configured = true;
          return Effect.asVoid(
            Effect.forkDetach(connection.configure(webApiConfig(next))),
          );
        });
        yield* Stream.runForEach(connection.changes, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkScoped({ startImmediately: true }));
        yield* until(() => configured, "the first apply");
        yield* until(
          () =>
            tags(events).filter((tag) => tag === "refreshing:false").length >=
            2,
          "the sync with the new key",
        );
        expect(tags(events).filter((tag) => tag === "changed")).toEqual([
          "changed",
        ]);
        expect((yield* sync.status).state).toBe("ready");
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "reports the progress of the first build while the source loads",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const release = api.api.hold((request) =>
          request.path.endsWith("/deleted"),
        );
        const { connection, sync } = yield* source(api);
        yield* untilStatus(
          Effect.map(sync.status, (status) => status.progress !== null),
          "the progress of the first build",
        );
        expect(yield* sync.status).toMatchObject({
          state: "loading",
          syncing: true,
          progress: { phase: "download", done: expect.any(Number) },
        });
        release();
        yield* connection.refresh;
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          progress: null,
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "reports the download progress, then the apply progress of the applied objects of the total",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const seen: unknown[] = [];
        let sync: WebLibrarySync["Service"] | undefined;
        const { connection, sync: service } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
          betweenSlices: Effect.suspend(() =>
            sync
              ? Effect.map(sync.status, (status) => {
                  seen.push(status.progress);
                })
              : Effect.void,
          ),
        });
        yield* connection.refresh;
        sync = service;
        for (const key of ["MAIN2345", "RELA2345"]) {
          api.api
            .library({ type: "user", id: 42 })
            .updateItem(key, { title: `Progress of ${key}` });
        }
        const release = api.api.hold((request) =>
          request.path.endsWith("/deleted"),
        );
        const refreshing = yield* Effect.forkChild(connection.refresh);
        yield* untilStatus(
          Effect.map(service.status, (status) => status.progress !== null),
          "the download progress",
        );
        expect((yield* service.status).progress).toMatchObject({
          phase: "download",
        });
        release();
        yield* Fiber.join(refreshing);
        expect(seen.length).toBeGreaterThan(1);
        expect(seen).toContainEqual({ phase: "apply", done: 1, total: 2 });
        expect(seen.at(-1)).toEqual({ phase: "apply", done: 2, total: 2 });
        expect((yield* service.status).progress).toBeNull();
      }).pipe(Effect.scoped),
  );

  it.effect(
    "holds a reader that comes between the slices of an apply and gives it the new replica after the commit, while the status answers from the last commit",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const statuses: unknown[] = [];
        const readers: Fiber.Fiber<unknown, DbUnavailable>[] = [];
        let probe: Effect.Effect<void> = Effect.void;
        const { connection, sync } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
          betweenSlices: Effect.suspend(() => probe),
        });
        yield* connection.refresh;
        const view = read(connection, (client) => ({
          titles: ["MAIN2345", "RELA2345"].map((key) => titleOf(client, key)),
          version: getLibraries(client).find(
            (library) => library.libraryID === 1,
          )?.version,
        }));
        const committedOf = (status: WebSyncStatus) =>
          status.libraries.find((library) => library.library.type === "user")
            ?.committedVersion;
        const before = yield* view;
        const committedBefore = committedOf(yield* sync.status);
        probe = Effect.gen(function* () {
          statuses.push(committedOf(yield* sync.status));
          readers.push(yield* Effect.forkDetach(view));
          yield* Effect.yieldNow;
          expect(
            readers.every((reader) => reader.pollUnsafe() === undefined),
          ).toBe(true);
        });
        for (const key of ["MAIN2345", "RELA2345"]) {
          api.api
            .library({ type: "user", id: 42 })
            .updateItem(key, { title: `Sliced ${key}` });
        }
        yield* connection.refresh;
        probe = Effect.void;
        expect(readers.length).toBeGreaterThan(1);
        expect(new Set(statuses)).toEqual(new Set([committedBefore]));
        const after = yield* view;
        expect(after.titles).toEqual(["Sliced MAIN2345", "Sliced RELA2345"]);
        expect(after.version).toBeGreaterThan(before.version!);
        for (const reader of readers)
          expect(yield* Fiber.join(reader)).toEqual(after);
        expect(committedOf(yield* sync.status)).toBe(after.version);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "answers the source identity from the last commit during an apply, without a wait",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const seen: unknown[] = [];
        let probe: Effect.Effect<void> = Effect.void;
        const { connection } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
          betweenSlices: Effect.suspend(() => probe),
        });
        yield* connection.refresh;
        probe = Effect.gen(function* () {
          seen.push(yield* connection.pendingIdentity!);
        });
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Identity during the apply" });
        yield* connection.refresh;
        probe = Effect.void;
        expect(seen.length).toBeGreaterThan(0);
        for (const identity of seen)
          expect(identity).toEqual({
            kind: "web-api",
            id: expect.any(String),
            userID: 42,
            username: "reader",
          });
        expect(yield* connection.pendingIdentity!).toBeNull();
      }).pipe(Effect.scoped),
  );

  it.effect(
    "answers a read request from the RPC client that comes during an apply with the new replica after the commit",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const library = api.api.library({ type: "user", id: 42 });
        const context = yield* Layer.build(
          Layer.merge(
            memoryWebApiSource(api, {
              holdBack: HOLD_BACK,
              slicing: { pageSize: 1, sliceMillis: 0 },
            }),
            layerAbsentFileSystem,
          ),
        );
        const connection = Context.get(context, Connection);
        const sync = Context.get(context, WebLibrarySync);
        const reads = yield* makeInProcessClient({
          snapshotRevision,
          itemSource: layerUnpinnedConnectionItemSource,
        }).pipe(Effect.provideContext(context));
        yield* connection.refresh;
        const title = Effect.map(
          reads.ItemsByIndexedKeys({ indexedKeys: ["MAIN2345"] }),
          (items) =>
            (items.get("MAIN2345")?.fields as { title?: string } | undefined)
              ?.title,
        );
        library.updateItem("MAIN2345", { title: "Changed under the readers" });
        for (let index = 0; index < 200; index++) {
          library.putItem({
            ...library.items.get("RELA2345")!.data,
            key: `BULK${String(index).padStart(4, "0")}`,
          });
        }
        const refreshing = yield* Effect.forkChild(connection.refresh);
        const during: (string | undefined)[] = [];
        while (refreshing.pollUnsafe() === undefined) {
          const before = (yield* sync.status).progress;
          const seen = yield* title;
          if (before?.phase === "apply") during.push(seen);
          yield* pause(1);
        }
        yield* Fiber.join(refreshing);
        expect(during.length).toBeGreaterThan(0);
        expect(new Set(during)).toEqual(new Set(["Changed under the readers"]));
        expect(yield* title).toBe("Changed under the readers");
      }).pipe(Effect.scoped),
  );

  it.effect(
    "runs the slices of the sync on the browser scheduler of the Worker runtime, which yields through MessageChannel tasks and not through timers",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const schedulers = new Set<Scheduler.Scheduler>();
        const { connection } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
          betweenSlices: Effect.gen(function* () {
            schedulers.add(yield* Scheduler.Scheduler);
            yield* Effect.yieldNow;
          }),
        });
        yield* connection.refresh;
        expect([...schedulers]).toEqual([browserScheduler]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "gives the committed libraries in the status during an apply, and no committed version while a removed replica builds again",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        let probe: Effect.Effect<void> = Effect.void;
        const { connection, sync } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
          betweenSlices: Effect.suspend(() => probe),
        });
        yield* connection.refresh;
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Exclusive" });
        const seen: WebSyncStatus[] = [];
        probe = Effect.map(sync.status, (status) => void seen.push(status));
        yield* connection.refresh;
        expect(seen.length).toBeGreaterThan(0);
        for (const status of seen) {
          expect(status.libraries.map((entry) => entry.library)).toEqual([
            { type: "user", id: 42 },
            { type: "group", id: 900 },
          ]);
        }
        const committed = seen[0]!.libraries[0]!.committedVersion;
        expect(
          (yield* sync.status).libraries[0]!.committedVersion,
        ).toBeGreaterThan(committed!);
        seen.length = 0;
        yield* Effect.andThen(
          sync.removeReplica,
          Effect.forkChild(Effect.ignore(connection.refresh), {
            startImmediately: true,
          }),
        );
        yield* Effect.ignore(connection.refresh);
        expect(seen.length).toBeGreaterThan(0);
        expect(
          seen
            .flatMap((status) =>
              status.libraries.map((entry) => entry.committedVersion ?? 0),
            )
            .every((version) => version === 0),
        ).toBe(true);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "lets a reader that holds a borrow take a second one while a removal waits, so the removal runs once it lets go",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const pin = yield* Scope.make();
        yield* Scope.provide(connection.borrow, pin);
        const removing = yield* Effect.forkChild(sync.removeReplica, {
          startImmediately: true,
        });
        yield* untilStatus(
          Effect.map(sync.status, (status) => status.waitingForReaders),
          "the removal to wait",
        );
        const second = yield* Effect.forkChild(
          read(connection, (client) => titleOf(client)),
          { startImmediately: true },
        );
        yield* TestClock.adjust(HOLD_BACK);
        expect(yield* Fiber.join(second)).toBe("Main Study");
        yield* Scope.close(pin, Exit.void);
        yield* Fiber.join(removing);
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps the source degraded when a staging write cannot roll back and the file does not open again",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const inner = wasmReplicaDriver(
          yield* Effect.promise(() => loadMemoryEngine()),
        );
        let broken = false;
        let writes = 0;
        const driver: ReplicaDriver = {
          ...inner,
          open: (name) => {
            if (broken) throw new Error("the replica file is held");
            const handle = inner.open(name);
            const db = new Proxy(handle.db, {
              get(target, key) {
                if (key === "transaction" && broken && ++writes === 2)
                  return () => {
                    target.run("begin");
                    throw new Error("disk I/O error in a staging write");
                  };
                const value: unknown = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
            return {
              ...handle,
              db,
              exec: (text) => {
                if (broken && text === "rollback")
                  throw new Error("disk I/O error at the rollback");
                handle.exec(text);
              },
            } satisfies ReplicaHandle;
          },
        };
        const { connection, sync } = yield* source(api, {
          driver: Effect.succeed(driver),
        });
        yield* connection.refresh;
        broken = true;
        yield* Effect.flip(connection.refresh);
        expect((yield* sync.status).state).toBe("degraded");
        expect(
          yield* Effect.flip(read(connection, (client) => titleOf(client))),
        ).toMatchObject({ _tag: "DbUnavailable" });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "settles a start-up sync that a removal interrupts at once, so the next refresh builds the replica",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* sync.removeReplica;
        yield* connection.refresh.pipe(Effect.timeout("5 seconds"));
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
        expect((yield* sync.status).syncing).toBe(false);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "settles a start-up sync that a new configuration interrupts at once, so the next refresh answers",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.configure(
          webApiConfig(api.key, {
            consentedUserID: keyOwner(api),
            zoteroLocale: "de-DE",
          }),
        );
        yield* connection.refresh.pipe(Effect.timeout("5 seconds"));
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
        expect((yield* sync.status).syncing).toBe(false);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "reports a replica file that does not open as degraded, removes it, and reports the problem again when the next sync cannot open it either",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const engine = yield* Effect.promise(() => loadMemoryEngine());
        const refusing: SqliteWasm = {
          ...engine,
          open: () => {
            throw new Error("the replica file is held by another program");
          },
        };
        const { connection, sync } = yield* source(api, {
          engine: Effect.succeed(refusing),
        });
        const error = yield* Effect.flip(read(connection, titleOf));
        expect(error).toBeInstanceOf(DbUnavailable);
        expect(error.message).toContain("held by another program");
        expect(yield* sync.status).toMatchObject({
          state: "degraded",
          problem: {
            _tag: "storage",
            message: expect.stringContaining("held by another program"),
          },
        });
        yield* sync.removeReplica;
        yield* Effect.flip(connection.refresh);
        expect(yield* sync.status).toMatchObject({
          state: "degraded",
          problem: {
            _tag: "storage",
            reason: "failed",
            message: expect.stringContaining("held by another program"),
          },
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "keeps the error of a failed commit when its rollback also fails, opens the file again with a warning, and recovers on the next sync",
    () =>
      Effect.gen(function* () {
        const logged: string[] = [];
        const api = seeded();
        const engine = yield* Effect.promise(() => loadMemoryEngine());
        let failing = false;
        const faulty: SqliteWasm = {
          ...engine,
          open: (options) => {
            const database = engine.open(options);
            return Object.assign(Object.create(database) as typeof database, {
              exec: (text: string) => {
                if (failing && (text === "commit" || text === "rollback"))
                  throw new Error(`disk I/O error at ${text}`);
                database.exec(text);
              },
            });
          },
        };
        const { connection, sync } = yield* source(api, {
          engine: Effect.succeed(faulty),
        });
        yield* connection.refresh;
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Committed later" });
        failing = true;
        yield* Effect.flip(connection.refresh).pipe(
          Effect.provide(
            Logger.layer([
              Logger.make(({ message }) => {
                logged.push([message].flat().map(String).join(" "));
              }),
            ]),
          ),
          Effect.provideService(References.MinimumLogLevel, "Debug"),
        );
        expect(logged).toContain(
          "The replica opens its file again after a failed rollback",
        );
        const failed = yield* sync.status;
        expect(failed.problem).toMatchObject({
          _tag: "storage",
          message: expect.stringContaining("could not commit the apply"),
        });
        expect(failed.libraries.length).toBeGreaterThan(0);
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
        expect(yield* staging(connection)).toEqual([]);
        failing = false;
        yield* connection.refresh;
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Committed later",
        );
        expect((yield* sync.status).problem).toBeNull();
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
      }).pipe(Effect.scoped),
  );

  describe.each([
    {
      driver: "the wasm driver in memory",
      open: Effect.map(
        Effect.promise(() => loadMemoryEngine()),
        (engine) => wasmReplicaDriver(engine),
      ),
    },
    {
      driver: "the node:sqlite driver on a file",
      open: Effect.map(
        Effect.acquireRelease(
          Effect.sync(() =>
            mkdtempSync(join(tmpdir(), "zotlit-replica-full-")),
          ),
          (folder) =>
            Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
        ),
        (folder) => nodeReplicaDriver(folder),
      ),
    },
  ])("on $driver", ({ open }) => {
    const recorded = Effect.map(open, (inner) => {
      const opened: ReplicaHandle[] = [];
      const driver: ReplicaDriver = {
        ...inner,
        open: (file) => {
          const handle = inner.open(file);
          opened.push(handle);
          return handle;
        },
      };
      return { opened, driver };
    });

    it.effect(
      "keeps the error of an apply that fails because the storage is full",
      () =>
        Effect.gen(function* () {
          const api = seeded();
          const { opened, driver } = yield* recorded;
          let full = false;
          const { connection, sync } = yield* source(api, {
            driver: Effect.succeed(driver),
            slicing: { pageSize: 1, sliceMillis: 0 },
            betweenSlices: Effect.sync(() => {
              if (!full) return;
              full = false;
              const writer = opened[0]!;
              const pages = Number(
                writer.db.get<{ page_count: number }>("pragma page_count")!
                  .page_count,
              );
              writer.exec(`pragma max_page_count = ${pages}`);
            }),
          });
          yield* connection.refresh;
          const writer = opened[0]!;
          const library = api.api.library({ type: "user", id: 42 });
          library.updateItem("MAIN2345", { title: "Before the large one" });
          library.putItem({
            ...library.items.get("RELA2345")!.data,
            key: "ZZZZ2345",
            title: "Too large ".repeat(200_000),
          });
          full = true;
          yield* Effect.flip(connection.refresh);
          expect((yield* sync.status).problem).toMatchObject({
            _tag: "storage",
            reason: "full",
            message: expect.stringContaining(
              "could not apply the download: the storage is full (",
            ),
          });
          expect((yield* sync.status).problem?.message).not.toContain(
            "roll back",
          );
          writer.exec("pragma max_page_count = 1073741823");
          yield* connection.refresh;
          expect(
            (yield* read(connection, (client) => titleOf(client, "ZZZZ2345")))!,
          ).toMatch(/^Too large/);
        }).pipe(Effect.scoped),
    );

    it.effect("reports a full storage while the download is staged", () =>
      Effect.gen(function* () {
        const api = seeded();
        const { opened, driver } = yield* recorded;
        const { connection, sync } = yield* source(api, {
          driver: Effect.succeed(driver),
        });
        yield* connection.refresh;
        const writer = opened[0]!;
        const pages = Number(
          writer.db.get<{ page_count: number }>("pragma page_count")!
            .page_count,
        );
        writer.exec(`pragma max_page_count = ${pages}`);
        const library = api.api.library({ type: "user", id: 42 });
        library.putItem({
          ...library.items.get("RELA2345")!.data,
          key: "ZZZZ2345",
          title: "Too large ".repeat(200_000),
        });
        yield* Effect.flip(connection.refresh);
        expect((yield* sync.status).problem).toMatchObject({
          _tag: "storage",
          reason: "full",
          message: expect.stringContaining(
            "could not store the download: the storage is full (",
          ),
        });
      }).pipe(Effect.scoped),
    );
  });

  it.effect(
    "keeps the error and the connection when SQLite has already ended the transaction of a failed apply",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const engine = yield* Effect.promise(() => loadMemoryEngine());
        const opened: SqliteWasmDatabase<any>[] = [];
        const counted: SqliteWasm = {
          ...engine,
          open: (options) => {
            const database = engine.open(options);
            opened.push(database);
            return database;
          },
        };
        const { connection, sync } = yield* source(api, {
          engine: Effect.succeed(counted),
          slicing: { pageSize: 1, sliceMillis: 0 },
        });
        yield* connection.refresh;
        const writer = opened[0]!;
        writer.exec(
          `create temp trigger endedBySqlite before insert on main.itemDataValues
            when new.value = 'Ended by SQLite' begin select raise(rollback, 'ended by SQLite'); end`,
        );
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Ended by SQLite" });
        yield* Effect.flip(connection.refresh);
        expect((yield* sync.status).problem).toMatchObject({
          _tag: "storage",
          message: expect.stringContaining("could not apply the download"),
        });
        expect(writer.inTransaction()).toBe(false);
        expect(yield* staging(connection)).toEqual([]);
        writer.exec("drop trigger temp.endedBySqlite");
        yield* connection.refresh;
        expect(opened).toHaveLength(1);
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Ended by SQLite",
        );
        expect((yield* sync.status).problem).toBeNull();
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "gives the status of the new commit to a subscriber that reads it on each change event",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
        });
        yield* connection.refresh;
        const seen: (number | null)[] = [];
        yield* Stream.runForEach(connection.changes, (event) =>
          event._tag === "changed"
            ? Effect.map(sync.status, (status) => {
                seen.push(
                  status.libraries.find(
                    (entry) => entry.library.type === "user",
                  )!.committedVersion,
                );
              })
            : Effect.void,
        ).pipe(Effect.forkScoped({ startImmediately: true }));
        const library = api.api.library({ type: "user", id: 42 });
        const versions: number[] = [];
        for (const title of ["Second", "Third", "Fourth"]) {
          versions.push(library.updateItem("MAIN2345", { title }));
          yield* connection.refresh;
          yield* until(() => seen.length === versions.length, "the change");
        }
        expect(seen).toEqual(versions);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "keeps the old replica complete when the source stops between slices, and the next sync finishes from the staging",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const kept = keptEngine(
          yield* Effect.promise(() => loadMemoryEngine()),
        );
        const engine = Effect.succeed(kept.engine);
        let slices = -1;
        const stopped = yield* Effect.scoped(
          Effect.gen(function* () {
            const { connection } = yield* source(api, {
              engine,
              slicing: { pageSize: 1, sliceMillis: 0 },
              betweenSlices: Effect.suspend(() =>
                slices >= 0 && ++slices === 2 ? Effect.never : Effect.void,
              ),
            });
            yield* connection.refresh;
            slices = 0;
            for (const key of ["MAIN2345", "RELA2345"]) {
              api.api
                .library({ type: "user", id: 42 })
                .updateItem(key, { title: `Stopped ${key}` });
            }
            yield* Effect.forkChild(connection.refresh);
            yield* until(() => slices === 2, "the second slice");
            return api.api.requests.length;
          }),
        );
        const release = api.api.hold(
          (request) => request.path === "/keys/current",
        );
        const { connection } = yield* source(api, { engine });
        expect(
          yield* read(connection, (client) =>
            ["MAIN2345", "RELA2345"].map((key) => titleOf(client, key)),
          ),
        ).toEqual(["Main Study", expect.not.stringContaining("Stopped")]);
        expect(yield* staging(connection)).toEqual([]);
        release();
        yield* connection.refresh;
        expect(
          yield* read(connection, (client) =>
            ["MAIN2345", "RELA2345"].map((key) => titleOf(client, key)),
          ),
        ).toEqual(["Stopped MAIN2345", "Stopped RELA2345"]);
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
        expect(
          api.api.requests
            .slice(stopped)
            .filter((request) => request.query.itemKey !== undefined),
        ).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "publishes a commit whose client renewal fails through the file opened again, with the change event",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const engine = yield* Effect.promise(() => loadMemoryEngine());
        const faulty: SqliteWasm = {
          ...engine,
          open: (options) => {
            const database = engine.open(options);
            return Object.assign(Object.create(database) as typeof database, {
              renew: () => {
                throw new Error("disk I/O error");
              },
            });
          },
        };
        const { connection, events, sync } = yield* source(api, {
          engine: Effect.succeed(faulty),
        });
        yield* connection.refresh;
        expect(tags(events)).toContain("changed");
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          problem: null,
        });
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "reports the source degraded with one event when a commit cannot be published and the file does not open again",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const engine = yield* Effect.promise(() => loadMemoryEngine());
        let broken = false;
        const faulty: SqliteWasm = {
          ...engine,
          open: (options) => {
            if (broken) throw new Error("the replica file is held");
            const database = engine.open(options);
            return Object.assign(Object.create(database) as typeof database, {
              renew: () => {
                if (broken) throw new Error("disk I/O error");
                return database.renew();
              },
            });
          },
        };
        const { connection, events, sync } = yield* source(api, {
          engine: Effect.succeed(faulty),
        });
        yield* connection.refresh;
        events.length = 0;
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Unpublished Study" });
        broken = true;
        const exit = yield* Effect.exit(connection.refresh);
        expect(
          Exit.isFailure(exit) && Cause.findErrorOption(exit.cause),
        ).toMatchObject({ _tag: "Some", value: { _tag: "DbUnavailable" } });
        expect(yield* sync.status).toMatchObject({
          state: "degraded",
          problem: { _tag: "storage" },
        });
        expect(tags(events).filter((tag) => tag === "degraded")).toHaveLength(
          1,
        );
        expect(
          yield* Effect.flip(read(connection, (client) => titleOf(client))),
        ).toMatchObject({ _tag: "DbUnavailable" });
        broken = false;
        yield* connection.refresh;
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Unpublished Study",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps the number of open statements flat across applies with a change",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection } = yield* source(api);
        yield* connection.refresh;
        const statements = () =>
          read(connection, (client) =>
            Number(
              client.get<{ n: number }>(
                "select count(*) as n from sqlite_stmt",
              )!.n,
            ),
          );
        const round = read(connection, (client) => [
          titleOf(client),
          getItemsByKey(client, ["RELA2345", "RELB2345"], { libraryID: 1 }),
          getLibraries(client),
        ]);
        yield* round;
        const counts: number[] = [yield* statements()];
        for (let i = 0; i < 5; i++) {
          api.api
            .library({ type: "user", id: 42 })
            .updateItem("MAIN2345", { title: `Round ${i}` });
          yield* connection.refresh;
          yield* round;
          counts.push(yield* statements());
        }
        expect(new Set(counts).size).toBe(1);
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps the client object and emits no change for a sync with no change",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events } = yield* source(api);
        yield* connection.refresh;
        const before = yield* read(connection, (client) => client);
        events.length = 0;
        yield* connection.refresh;
        expect(yield* read(connection, (client) => client)).toBe(before);
        expect(tags(events)).toEqual(["refreshing:true", "refreshing:false"]);
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
      }).pipe(Effect.scoped),
  );

  const stopBeforeCommit = (
    api: SeededApi,
    engine: Effect.Effect<SqliteWasm>,
    access: Parameters<SeededApi["api"]["addKey"]>[1],
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        let stopping = false;
        let stopped = false;
        const { connection } = yield* source(api, {
          engine,
          slicing: { pageSize: 1, sliceMillis: 0 },
          betweenSlices: Effect.suspend(() => {
            if (!stopping) return Effect.void;
            stopped = true;
            return Effect.never;
          }),
        });
        yield* connection.refresh;
        api.api.addKey(api.key, access, ACCOUNT);
        stopping = true;
        yield* Effect.forkChild(connection.refresh);
        yield* until(() => stopped, "the stop between slices");
      }),
    );

  const groupsOf = (connection: Connection["Service"]) =>
    read(connection, (client) =>
      getLibraries(client)
        .filter((library) => library.type === "group")
        .map((library) => library.groupID),
    );

  it.effect(
    "names a storage problem in the status when the replica cannot read its libraries at the open",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const kept = keptEngine(
          yield* Effect.promise(() => loadMemoryEngine()),
        );
        const engine = Effect.succeed(kept.engine);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { connection } = yield* source(api, { engine });
            yield* connection.refresh;
            yield* read(connection, (client) => {
              client.run(
                "alter table replicaSyncLibraries rename to librariesAway",
              );
              client.run(
                "create table replicaSyncLibraries (unrelated integer)",
              );
            });
          }),
        );
        const release = api.api.hold(
          (request) => request.path === "/keys/current",
        );
        const { sync } = yield* source(api, { engine });
        expect(yield* sync.status).toMatchObject({
          state: "degraded",
          problem: {
            _tag: "storage",
            message: expect.stringContaining("could not read its libraries"),
          },
        });
        release();
      }).pipe(Effect.scoped),
  );

  it.effect(
    "keeps a group whose removal is staged in the status until the apply commits",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const seen: number[][] = [];
        let probe: Effect.Effect<void> = Effect.void;
        const { connection, sync } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
          betweenSlices: Effect.suspend(() => probe),
        });
        yield* connection.refresh;
        const groups = (status: { libraries: WebSyncStatus["libraries"] }) =>
          status.libraries.flatMap((entry) =>
            entry.library.type === "group" ? [entry.library.id] : [],
          );
        probe = Effect.map(sync.status, (status) => {
          seen.push(groups(status));
        });
        api.api.addKey(
          api.key,
          { user: { library: true }, groups: {} },
          ACCOUNT,
        );
        for (const key of ["MAIN2345", "RELA2345"])
          api.api
            .library({ type: "user", id: 42 })
            .updateItem(key, { title: `Without the group ${key}` });
        yield* connection.refresh;
        probe = Effect.void;
        expect(seen.length).toBeGreaterThan(0);
        for (const during of seen) expect(during).toEqual([900]);
        expect(groups(yield* sync.status)).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "applies no staged pass of a group that the key no longer reads",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const personalOnly = { user: { library: true }, groups: {} };
        api.api.addKey(api.key, personalOnly, ACCOUNT);
        const engine = Effect.succeed(
          keptEngine(yield* Effect.promise(() => loadMemoryEngine())).engine,
        );
        yield* stopBeforeCommit(api, engine, READ_ALL_ACCESS);
        api.api.addKey(api.key, personalOnly, ACCOUNT);
        const { connection } = yield* source(api, { engine });
        yield* connection.refresh;
        expect(yield* groupsOf(connection)).toEqual([]);
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps a group that the key reads again after its removal was staged",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const engine = Effect.succeed(
          keptEngine(yield* Effect.promise(() => loadMemoryEngine())).engine,
        );
        yield* stopBeforeCommit(api, engine, {
          user: { library: true },
          groups: {},
        });
        api.api.addKey(api.key, READ_ALL_ACCESS, ACCOUNT);
        const { connection } = yield* source(api, { engine });
        yield* connection.refresh;
        expect(yield* groupsOf(connection)).toEqual([900]);
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "sends changed when a sync renames a group and changes no item, so Library Scope reads the new name",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events } = yield* source(api);
        yield* connection.refresh;
        const library = api.api.groups.get(900)!;
        const before = library.group!;
        library.group = {
          ...before,
          version: before.version + 1,
          data: { ...before.data, name: "Renamed Group" },
        };
        events.length = 0;

        yield* connection.refresh;

        expect(
          yield* read(connection, (client) =>
            getLibraries(client).map((entry) => entry.name),
          ),
        ).toContain("Renamed Group");
        expect(tags(events)).toEqual([
          "refreshing:true",
          "changed",
          "refreshing:false",
        ]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "stores a new account name in a sync with no library change, and keeps no staged account row",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events } = yield* source(api);
        yield* connection.refresh;
        api.api.addKey(api.key, READ_ALL_ACCESS, {
          ...ACCOUNT,
          username: "renamed reader",
        });
        events.length = 0;
        yield* connection.refresh;
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
        expect(
          yield* read(connection, (client) =>
            client.get<{ value: string }>(
              "select value from settings where setting = 'account' and key = 'username'",
            ),
          ),
        ).toEqual({ value: "renamed reader" });
        expect(tags(events)).toEqual(["refreshing:true", "refreshing:false"]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps one open of the replica file across syncs, with temporary files in memory",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const kept = keptEngine(
          yield* Effect.promise(() => loadMemoryEngine()),
        );
        const { connection } = yield* source(api, {
          engine: Effect.succeed(kept.engine),
        });
        for (const title of ["One", "Two", "Three"]) {
          api.api
            .library({ type: "user", id: 42 })
            .updateItem("MAIN2345", { title });
          yield* connection.refresh;
        }
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Three",
        );
        expect(kept.opens()).toBe(1);
        expect(
          yield* read(connection, (client) =>
            client.get<{ temp_store: number }>("pragma temp_store"),
          ),
        ).toEqual({ temp_store: 2 });
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps the database generation across a sync of the same replica, and changes it when the replica is removed",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const generation = () =>
          read(connection, (client) => connection.databaseGeneration(client));
        const first = yield* generation();
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Changed" });
        yield* connection.refresh;
        expect(yield* generation()).toBe(first);
        expect(
          yield* Effect.scoped(
            Effect.flatMap(connection.borrow, (client) =>
              connection.identity(client),
            ),
          ),
        ).toMatchObject({ kind: "web-api" });
        yield* Effect.andThen(
          sync.removeReplica,
          Effect.forkChild(Effect.ignore(connection.refresh), {
            startImmediately: true,
          }),
        );
        expect(yield* generation()).not.toBe(first);
      }).pipe(Effect.scoped),
  );

  it.live(
    "closes the replica and deletes its files at a removal, so no empty replica stays until the next sync",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const folder = yield* Effect.acquireRelease(
          Effect.sync(() =>
            mkdtempSync(join(tmpdir(), "zotlit-replica-removal-")),
          ),
          (made) =>
            Effect.sync(() => rmSync(made, { recursive: true, force: true })),
        );
        const { connection, sync } = yield* source(api, {
          driver: Effect.succeed(nodeReplicaDriver(folder)),
        });
        yield* connection.refresh;
        yield* sync.removeReplica;
        expect(readdirSync(folder)).toEqual([]);
        yield* connection.refresh;
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "removes the replica, reports loading, and builds it again in the same file",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const kept = keptEngine(
          yield* Effect.promise(() => loadMemoryEngine()),
        );
        const { connection, events, sync } = yield* source(api, {
          engine: Effect.succeed(kept.engine),
        });
        const before = yield* read(connection, (client) =>
          client.get<{ value: string }>(
            "select value from settings where setting = 'account' and key = 'localUserKey'",
          ),
        );
        events.length = 0;
        yield* Effect.andThen(
          sync.removeReplica,
          Effect.forkChild(Effect.ignore(connection.refresh), {
            startImmediately: true,
          }),
        );
        expect(tags(events)[0]).toBe("state:loading");
        const after = yield* read(connection, (client) => ({
          title: titleOf(client),
          localUserKey: client.get<{ value: string }>(
            "select value from settings where setting = 'account' and key = 'localUserKey'",
          ),
        }));
        expect(after.title).toBe("Main Study");
        expect(after.localUserKey).not.toEqual(before);
        expect(kept.opens()).toBe(2);
        expect((yield* sync.status).state).toBe("ready");
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "lets a reader that waits at the gate during a removal read the rebuilt replica",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api, {
          holdBack: "500 millis",
        });
        yield* connection.refresh;
        const before = yield* read(connection, (client) => client);
        const pin = yield* Scope.make();
        yield* Scope.provide(connection.borrow, pin);
        const removing = yield* Effect.forkChild(
          Effect.andThen(
            sync.removeReplica,
            Effect.forkChild(Effect.ignore(connection.refresh), {
              startImmediately: true,
            }),
          ),
        );
        yield* untilStatus(
          Effect.map(sync.status, (status) => status.waitingForReaders),
          "the removal to wait",
        );
        const waiting = yield* Effect.forkChild(
          read(connection, (client) => ({
            same: client === before,
            title: titleOf(client),
          })),
          { startImmediately: true },
        );
        yield* Scope.close(pin, Exit.void);
        yield* Fiber.join(removing);
        expect(yield* Fiber.join(waiting)).toEqual({
          same: false,
          title: "Main Study",
        });
        expect((yield* sync.status).state).toBe("ready");
      }).pipe(Effect.scoped),
  );

  it.live(
    "builds the replica again when a sync starts while a removal waits for readers",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const pin = yield* Scope.make();
        yield* Scope.provide(connection.borrow, pin);
        const removing = yield* Effect.forkChild(
          Effect.andThen(
            sync.removeReplica,
            Effect.forkChild(Effect.ignore(connection.refresh), {
              startImmediately: true,
            }),
          ),
        );
        yield* untilStatus(
          Effect.map(sync.status, (status) => status.waitingForReaders),
          "the removal to wait",
        );
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Changed while removing" });
        const refreshing = yield* Effect.forkChild(
          Effect.result(connection.refresh),
          { startImmediately: true },
        );
        yield* Scope.close(pin, Exit.void);
        yield* Fiber.join(removing);
        expect((yield* Fiber.join(refreshing))._tag).toBe("Success");
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Changed while removing",
        );
        yield* untilStatus(
          Effect.map(sync.status, (status) => status.state === "ready"),
          "the rebuilt replica",
        );
      }).pipe(Effect.scoped),
  );

  it.live("fails each read when every library fails in the first build", () =>
    Effect.gen(function* () {
      const api = seeded();
      api.api.inject({
        match: (request) =>
          (request.path.startsWith("/users/42/") &&
            !request.path.startsWith("/users/42/groups")) ||
          request.path.startsWith("/groups/900"),
        times: 1000,
        answer: { status: 400, body: "Bad request" },
      });
      const { connection, sync } = yield* source(api);
      const error = yield* Effect.flip(read(connection, titleOf));
      expect(error).toBeInstanceOf(DbUnavailable);
      expect(yield* sync.status).toMatchObject({
        state: "degraded",
        problem: { _tag: "libraries-failed" },
      });
    }).pipe(Effect.scoped),
  );

  it.live(
    "downloads nothing for a key of an account other than the consented one, also into an empty replica",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const other = "otheraccountkey00000000b";
        api.api.addKey(other, READ_ALL_ACCESS, {
          userID: 99,
          username: "someone else",
        });
        const { connection, sync } = yield* source(api, {
          initial: webApiConfig(other, { consentedUserID: 42 }),
        });
        yield* Effect.ignore(connection.refresh);
        const status = yield* sync.status;
        expect(status.problem).toMatchObject({
          _tag: "account-changed",
          consentedUserID: 42,
          keyUserID: 99,
        });
        expect(
          api.api.requests.filter((request) => request.path.includes("/items")),
        ).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "decides a key of another account from the key check alone, before it asks for any group",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const other = "otheraccountkey00000000c";
        api.api.addKey(
          other,
          { user: { library: false }, groups: { all: { library: true } } },
          { userID: 99, username: "someone else" },
        );
        api.api.inject({
          match: (request) => request.path === "/users/99/groups",
          times: 100,
          answer: { status: 400, body: "Bad request" },
        });
        const { connection, sync } = yield* source(api, {
          initial: webApiConfig(other, { consentedUserID: 42 }),
        });
        yield* Effect.ignore(connection.refresh);
        expect((yield* sync.status).problem).toMatchObject({
          _tag: "account-changed",
          keyUserID: 99,
        });
        expect(
          api.api.requests.filter((request) =>
            request.path.startsWith("/users/99/groups"),
          ),
        ).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "lists the groups before a language rebuild, and keeps the replica when the list fails",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        api.api.inject({
          match: (request) => request.path === "/users/42/groups",
          times: 100,
          answer: { status: 400, body: "Bad request" },
        });
        yield* connection.configure(
          webApiConfig(api.key, { zoteroLocale: "en-GB" }),
        );
        yield* Effect.ignore(connection.refresh);
        expect((yield* sync.status).problem?._tag).toBe("protocol");
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "asks for an unchanged library with the key check, the group list and one settings request each",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection } = yield* source(api);
        yield* connection.refresh;
        const before = api.api.requests.length;
        yield* connection.refresh;
        expect(
          api.api.requests.slice(before).map((request) => request.path),
        ).toEqual([
          "/keys/current",
          "/users/42/groups",
          "/users/42/settings",
          "/groups/900/settings",
        ]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "reports a key of another account as a typed state, keeps the replica, and replaces it only when the configuration names the new account",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const other = "otheraccountkey00000000a";
        api.api.addKey(other, READ_ALL_ACCESS, {
          userID: 99,
          username: "someone else",
        });
        yield* connection.configure(webApiConfig(other));
        yield* untilStatus(
          Effect.map(sync.status, (status) => status.problem !== null),
          "the account check",
        );
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          problem: {
            _tag: "account-changed",
            storedUserID: 42,
            keyUserID: 99,
          },
        });
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
        yield* Effect.andThen(
          sync.removeReplica,
          Effect.forkChild(Effect.ignore(connection.refresh), {
            startImmediately: true,
          }),
        );
        yield* Effect.ignore(connection.refresh);
        expect((yield* sync.status).problem?._tag).toBe("account-changed");
        yield* connection.configure(
          webApiConfig(other, { consentedUserID: 99 }),
        );
        yield* Effect.ignore(connection.refresh);
        expect((yield* sync.status).problem?._tag).not.toBe("account-changed");
        const left = yield* Effect.result(
          read(connection, (client) => titleOf(client) ?? null),
        );
        expect(left._tag === "Failure" || left.success === null).toBe(true);
      }).pipe(Effect.scoped),
  );

  it.live(
    "fails a removal when the storage engine did not load at start, so the stored data is not reported as removed",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const kept = keptEngine(
          yield* Effect.promise(() => loadMemoryEngine()),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { connection } = yield* source(api, {
              engine: Effect.succeed(kept.engine),
            });
            yield* connection.refresh;
          }),
        );
        let loads = 0;
        const { sync } = yield* source(api, {
          engine: Effect.suspend(() =>
            ++loads === 1
              ? Effect.fail(
                  new DbUnavailable({ message: "The engine did not load" }),
                )
              : Effect.succeed(kept.engine),
          ),
        });
        const removed = yield* Effect.exit(sync.removeReplica);
        const after = yield* sync.status;
        expect(Exit.isFailure(removed) || after.libraries.length === 0).toBe(
          true,
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "reports a storage that does not load as degraded and fails each read",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api, {
          engine: Effect.fail(
            new DbUnavailable({ message: "Missing required OPFS APIs." }),
          ),
        });
        const error = yield* Effect.flip(read(connection, titleOf));
        expect(error).toMatchObject({
          _tag: "DbUnavailable",
          message: "Missing required OPFS APIs.",
        });
        expect((yield* sync.status).state).toBe("degraded");
      }).pipe(Effect.scoped),
  );

  it.live(
    "prints no API key in a log, an error, an event or the status of a failed configure and sync",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events, sync } = yield* source(api);
        yield* connection.refresh;
        const revoked = "revokedkey000000000000ab";
        yield* connection.configure(webApiConfig(revoked));
        const failure = yield* Effect.flip(connection.refresh);
        api.api.inject({
          match: (request) => request.path === "/keys/current",
          answer: { status: 400, body: `key ${api.key}` },
        });
        yield* connection.configure(webApiConfig(api.key));
        const second = yield* Effect.flip(connection.refresh);
        const everything = [
          ...lines,
          JSON.stringify(events),
          JSON.stringify(yield* sync.status),
          String(failure),
          JSON.stringify(failure),
          String(second),
          JSON.stringify(second),
          JSON.stringify(api.api.requests),
        ].join("\n");
        expect(lines.length).toBeGreaterThan(0);
        expect(everything).not.toContain(revoked);
        expect(everything).not.toContain(api.key);
      }).pipe(
        Effect.scoped,
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, "All"),
      ),
  );

  const storedDate = (client: ZoteroDatabase) =>
    client.get<{ value: string }>(
      `select v.value from items i
        join itemData d on d.itemID = i.itemID
        join fieldsCombined f on f.fieldID = d.fieldID
        join itemDataValues v on v.valueID = d.valueID
        where i.key = 'MAIN2345' and f.fieldName = 'date'`,
    )?.value;

  it.live(
    "reads a free-text date in the order of the configured Zotero language",
    () =>
      Effect.gen(function* () {
        const stored: Record<string, string | undefined> = {};
        for (const zoteroLocale of ["en-US", "en-GB", undefined]) {
          const api = seeded();
          api.api
            .library({ type: "user", id: 42 })
            .updateItem("MAIN2345", { date: "01/02/2020" });
          const { connection } = yield* source(api, {
            initial: webApiConfig(
              api.key,
              zoteroLocale ? { zoteroLocale } : {},
            ),
          });
          stored[zoteroLocale ?? "absent"] = yield* read(
            connection,
            storedDate,
          );
        }
        expect(stored).toEqual({
          "en-US": "2020-01-02 01/02/2020",
          "en-GB": "2020-02-01 01/02/2020",
          absent: "2020-01-02 01/02/2020",
        });
      }).pipe(Effect.scoped),
  );

  it.live(
    "keeps the replica readable in its recorded language while a language rebuild downloads, keeps all of it when one library fails, and replaces it in one apply when every library downloads",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { date: "01/02/2020" });
        const { connection, sync, events } = yield* source(api);
        yield* connection.refresh;
        const libraryIDs = () =>
          read(connection, (client) =>
            getLibraries(client).map((library) => library.libraryID),
          );
        const before = { libraries: yield* libraryIDs() };
        expect(before.libraries).toHaveLength(2);
        expect(yield* read(connection, storedDate)).toBe(
          "2020-01-02 01/02/2020",
        );
        api.api.inject({
          match: (request) => request.path === "/groups/900/settings",
          answer: { status: 400, body: "Bad request" },
        });
        const built = events.length;

        yield* connection.configure(
          webApiConfig(api.key, { zoteroLocale: "en-GB" }),
        );
        yield* Effect.ignore(connection.refresh);

        expect(yield* sync.status).toMatchObject({
          state: "ready",
          zoteroLocale: "en-US",
          problem: { _tag: "libraries-failed" },
        });
        expect((yield* sync.status).libraries).toHaveLength(2);
        expect(yield* libraryIDs()).toEqual(before.libraries);
        expect(yield* read(connection, storedDate)).toBe(
          "2020-01-02 01/02/2020",
        );

        yield* connection.refresh;

        expect(yield* sync.status).toMatchObject({
          state: "ready",
          zoteroLocale: "en-GB",
          problem: null,
        });
        expect(yield* read(connection, storedDate)).toBe(
          "2020-02-01 01/02/2020",
        );
        expect(yield* libraryIDs()).toEqual(before.libraries);
        expect(tags(events.slice(built))).not.toContain("state:loading");
        expect(tags(events.slice(built))).toContain("changed");
        expect(yield* staging(connection, { afterApply: true })).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.live(
    "removes the replica with no sync when no rebuild is asked, and builds it again on the next refresh",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const before = api.api.requests.length;
        yield* sync.removeReplica;
        expect(api.api.requests.length).toBe(before);
        expect(yield* sync.status).toMatchObject({
          syncing: false,
          libraries: [],
        });
        yield* connection.refresh;
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "names the online library with no account during a first build, without a wait for the build",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const context = yield* Layer.build(
          Layer.merge(
            memoryWebApiSource(api, { holdBack: HOLD_BACK }),
            layerAbsentFileSystem,
          ),
        );
        const connection = Context.get(context, Connection);
        const sync = Context.get(context, WebLibrarySync);
        const reads = yield* makeInProcessClient({
          snapshotRevision,
          itemSource: layerUnpinnedConnectionItemSource,
        }).pipe(Effect.provideContext(context));
        yield* connection.refresh;
        expect(yield* reads.SourceIdentity({})).toEqual({
          kind: "web-api",
          id: "web-api:42",
          userID: 42,
          username: "reader",
        });
        const release = api.api.hold(
          (request) => request.path === "/keys/current",
        );
        yield* Effect.andThen(
          sync.removeReplica,
          Effect.forkChild(Effect.ignore(connection.refresh), {
            startImmediately: true,
          }),
        );
        expect(yield* reads.SourceIdentity({})).toEqual({
          kind: "web-api",
          id: "web-api:unsynced",
          userID: null,
          username: null,
        });
        release();
        yield* connection.refresh;
        expect(yield* reads.SourceIdentity({})).toMatchObject({
          id: "web-api:42",
        });
      }).pipe(Effect.scoped),
  );
});

const itemRequests = (api: SeededApi, path: string) =>
  api.api.requests.filter(
    (request) => request.path === path && request.query.itemKey !== undefined,
  ).length;

const stopRunning = (sync: WebLibrarySync["Service"]) =>
  Effect.flatMap(sync.status, (status) =>
    sync.stopSync(status.syncId ?? Number.NaN),
  );

const pushedProgress = (sync: WebLibrarySync["Service"]) =>
  Effect.gen(function* () {
    const pushed: WebSyncStatus["progress"][] = [];
    yield* Stream.runForEach(sync.progress, (progress) =>
      Effect.sync(() => pushed.push(progress)),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    return pushed;
  });

describe("the progress and the stop of a sync", () => {
  it.live(
    "pushes the progress of a sync: the download sums the objects of all libraries, then the apply, then none",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Changed in the personal library" });
        api.api
          .library({ type: "group", id: 900 })
          .updateItem("GRPITEMS", { title: "Changed in the group" });
        const pushed = yield* pushedProgress(sync);
        yield* connection.refresh;
        yield* until(() => pushed.at(-1) === null, "the end of the progress");
        const download = pushed.filter(
          (progress) => progress !== null && progress.phase === "download",
        );
        expect(download.at(-1)).toEqual({
          phase: "download",
          done: 2,
          total: 2,
        });
        expect(download.at(0)).toMatchObject({ total: null });
        expect(
          download.flatMap((progress) =>
            progress.phase === "download" && progress.total !== null
              ? [progress.total]
              : [],
          ),
        ).toSatisfy((totals: number[]) => totals.every((total) => total === 2));
        expect(pushed).toContainEqual({ phase: "apply", done: 2, total: 2 });
        expect(pushed).not.toContainEqual({ phase: "waiting" });
        expect(pushed.indexOf(download.at(-1)!)).toBeLessThan(
          pushed.findIndex(
            (progress) => progress !== null && progress.phase === "apply",
          ),
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "knows the download total once each library has counted, with zero for a library that has no change",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        api.api
          .library({ type: "group", id: 900 })
          .updateItem("GRPITEMS", { title: "Changed only in the group" });
        const release = api.api.hold(
          (request) =>
            request.path === "/groups/900/items" &&
            request.query.itemKey !== undefined,
        );
        yield* Effect.addFinalizer(() => Effect.sync(release));
        const pushed = yield* pushedProgress(sync);
        const refreshing = yield* Effect.forkChild(connection.refresh);
        yield* until(
          () => itemRequests(api, "/groups/900/items") > 0,
          "the download of the group items",
        );
        yield* until(
          () =>
            pushed.some(
              (progress) =>
                progress?.phase === "download" && progress.total !== null,
            ),
          "a known download total",
        );
        const known = pushed.filter(
          (progress) =>
            progress?.phase === "download" && progress.total !== null,
        );
        expect(known[0]).toEqual({ phase: "download", done: 0, total: 1 });
        expect(
          known.every(
            (progress) =>
              progress?.phase === "download" && progress.total === 1,
          ),
        ).toBe(true);
        release();
        yield* Fiber.join(refreshing);
      }).pipe(Effect.scoped),
  );

  it.live(
    "forgets the count of a library whose pass starts again, so a total never grows after it was known",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        api.api.addKey(api.key, {
          user: { library: true, notes: true, files: true, write: false },
        });
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const personal = api.api.library({ type: "user", id: 42 });
        personal.updateItem("MAIN2345", {
          title: "Changed before the restart",
        });
        const release = api.api.hold(
          (request) => request.path === "/users/42/deleted",
        );
        yield* Effect.addFinalizer(() => Effect.sync(release));
        const deletions = () =>
          api.api.requests.filter(
            (request) => request.path === "/users/42/deleted",
          ).length;
        const before = deletions();
        const pushed = yield* pushedProgress(sync);
        const refreshing = yield* Effect.forkChild(connection.refresh);
        yield* until(
          () => deletions() > before,
          "the deletion request of the first pass",
        );
        personal.updateItem("RELA2345", { title: "Changed during the pass" });
        release();
        yield* Fiber.join(refreshing);
        const totals = pushed.flatMap((progress) =>
          progress?.phase === "download" ? [progress.total] : [],
        );
        const firstKnown = totals.indexOf(1);
        const secondKnown = totals.indexOf(2);
        expect(firstKnown).toBeGreaterThanOrEqual(0);
        expect(secondKnown).toBeGreaterThan(firstKnown);
        expect(totals.slice(firstKnown, secondKnown)).toContain(null);
        expect(totals.slice(secondKnown).every((total) => total === 2)).toBe(
          true,
        );
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Changed before the restart",
        );
      }).pipe(Effect.scoped),
    20_000,
  );

  it.live(
    "pushes the wait of the apply while a reader holds a borrow past the hold-back",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api);
        yield* connection.refresh;
        const pin = yield* Scope.make();
        yield* Scope.provide(connection.borrow, pin);
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Changed while a task reads" });
        const pushed = yield* pushedProgress(sync);
        const refreshing = yield* Effect.forkChild(connection.refresh);
        yield* until(
          () =>
            pushed.some(
              (progress) => progress !== null && progress.phase === "waiting",
            ),
          "the wait of the apply",
        );
        expect((yield* sync.status).progress).toEqual({ phase: "waiting" });
        yield* Scope.close(pin, Exit.void);
        yield* Fiber.join(refreshing);
        expect(pushed.at(-1)).toBeNull();
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Changed while a task reads",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "stops the first build during the download: a waiting borrow fails, the staged objects stay, and the next sync downloads only the rest",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const release = api.api.hold(
          (request) =>
            request.path === "/groups/900/items" &&
            request.query.itemKey !== undefined,
        );
        const { connection, sync } = yield* source(api);
        const waiting = yield* Effect.forkChild(
          Effect.exit(read(connection, (client) => titleOf(client))),
          { startImmediately: true },
        );
        yield* until(
          () => itemRequests(api, "/groups/900/items") > 0,
          "the download of the group items",
        );
        expect(yield* stopRunning(sync)).toBe(true);
        const read1 = yield* Fiber.join(waiting);
        expect(Exit.isFailure(read1)).toBe(true);
        expect(
          Exit.isFailure(read1) ? Cause.squash(read1.cause) : null,
        ).toBeInstanceOf(DbUnavailable);
        yield* untilStatus(
          Effect.map(sync.status, (status) => !status.syncing),
          "the end of the stopped sync",
        );
        expect(yield* sync.status).toMatchObject({
          state: "degraded",
          progress: null,
          problem: { _tag: "stopped" },
        });
        release();
        const personal = itemRequests(api, "/users/42/items");
        const group = itemRequests(api, "/groups/900/items");
        yield* connection.refresh;
        expect(itemRequests(api, "/users/42/items")).toBe(personal);
        expect(itemRequests(api, "/groups/900/items")).toBeGreaterThan(group);
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          problem: null,
        });
      }).pipe(Effect.scoped),
  );

  it.live(
    "stops a sync of a served replica during the download: reads keep the last good data, the status names the stop, and the next sync brings the change",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, events, sync } = yield* source(api);
        yield* connection.refresh;
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Changed before the stop" });
        api.api
          .library({ type: "group", id: 900 })
          .updateItem("GRPITEMS", { title: "Group changed before the stop" });
        const release = api.api.hold(
          (request) =>
            request.path === "/groups/900/items" &&
            request.query.itemKey !== undefined,
        );
        events.length = 0;
        lines.length = 0;
        const before = itemRequests(api, "/groups/900/items");
        const refreshing = yield* Effect.forkChild(
          Effect.exit(connection.refresh),
        );
        yield* until(
          () => itemRequests(api, "/groups/900/items") > before,
          "the download of the group items",
        );
        const { syncId } = yield* sync.status;
        expect(syncId).not.toBeNull();
        expect(yield* sync.stopSync(syncId! - 1)).toBe(false);
        expect(yield* stopRunning(sync)).toBe(true);
        const stopped = yield* Fiber.join(refreshing);
        expect(Exit.isFailure(stopped)).toBe(true);
        release();
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          syncing: false,
          problem: { _tag: "stopped" },
        });
        expect(tags(events)).not.toContain("changed");
        expect(tags(events)).not.toContain("degraded");
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
        const personal = itemRequests(api, "/users/42/items");
        yield* connection.refresh;
        expect(itemRequests(api, "/users/42/items")).toBe(personal);
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Changed before the stop",
        );
        expect((yield* sync.status).problem).toBeNull();
      }).pipe(Effect.provide(Logger.layer([logger])), Effect.scoped),
  );

  it.effect(
    "keeps the apply running when a stop comes after the apply began",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        let stop: Effect.Effect<void> = Effect.void;
        let stopped = false;
        let confirmed: boolean | null = null;
        const { connection, sync } = yield* source(api, {
          slicing: { pageSize: 1, sliceMillis: 0 },
          betweenSlices: Effect.suspend(() => {
            if (stopped) return Effect.void;
            stopped = true;
            return stop;
          }),
        });
        stopped = true;
        yield* connection.refresh;
        stopped = false;
        stop = Effect.map(stopRunning(sync), (answer) => {
          confirmed = answer;
        });
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Changed during the apply" });
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("RELA2345", { title: "Also changed during the apply" });
        yield* connection.refresh;
        expect(stopped).toBe(true);
        expect(confirmed).toBe(false);
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Changed during the apply",
        );
        expect((yield* sync.status).problem).toBeNull();
      }).pipe(Effect.scoped),
  );
});

describe("the file system of the Web Worker root", () => {
  it.effect("reports each path as absent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      expect(yield* fs.exists("/Users/reader/Zotero/storage/paper.pdf")).toBe(
        false,
      );
      const error = yield* Effect.flip(fs.readFile("storage:paper.pdf"));
      expect(error).toMatchObject({ reason: { _tag: "NotFound" } });
    }).pipe(Effect.provide(layerAbsentFileSystem)),
  );
});

describe("the readers' caches over the Web API source", () => {
  it.live(
    "rebuild the search index and the citation lookup with the new client after a sync, and Refresh starts the sync",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const reads = yield* inProcessClient(memoryWebApiSource(api), {
          itemSource: layerUnpinnedConnectionItemSource,
        });
        const search = (query: string) =>
          Effect.map(
            reads.SearchItems({ libraryIDs: [1], query, limit: 5 }),
            (hits) => hits.map((hit) => hit.item.key),
          );
        expect(yield* search("Main Study")).toContain("MAIN2345");
        const lookup = (citekey: string) =>
          reads.CitationLookup({ scope: null, citekeys: [citekey] });
        const before = yield* lookup("main2024");
        expect(before.citekeys.get("main2024")).toMatchObject({
          kind: "unique",
        });
        api.api.library({ type: "user", id: 42 }).updateItem("MAIN2345", {
          title: "Renamed Inquiry",
          citationKey: "renamed2024",
          dateModified: "2025-01-01T00:00:00Z",
        });
        const requests = keysRequests(api);
        yield* reads.Refresh();
        expect(keysRequests(api)).toBe(requests + 1);
        expect(
          yield* eventually(search("Renamed Inquiry"), (keys) =>
            keys.includes("MAIN2345"),
          ),
        ).toContain("MAIN2345");
        const after = yield* lookup("renamed2024");
        expect(after.citekeys.get("renamed2024")).toMatchObject({
          kind: "unique",
        });
        expect(after.revision).not.toBe(before.revision);
        expect(yield* reads.NotifyExternalChange()).toBeUndefined();
        expect(keysRequests(api)).toBe(requests + 1);
      }).pipe(Effect.scoped),
  );

  it.live(
    "lets a sync apply while the search index holds its built index",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const reads = yield* inProcessClient(memoryWebApiSource(api), {
          itemSource: layerUnpinnedConnectionItemSource,
        });
        yield* reads.SearchItems({
          libraryIDs: [1],
          query: "Main",
          limit: 5,
        });
        api.api.library({ type: "user", id: 42 }).updateItem("MAIN2345", {
          title: "Applied Anyway",
          dateModified: "2025-01-01T00:00:00Z",
        });
        yield* reads.Refresh().pipe(Effect.timeout("5 seconds"));
        const hits = yield* eventually(
          reads.SearchItems({
            libraryIDs: [1],
            query: "Applied Anyway",
            limit: 5,
          }),
          (found) => found.length > 0,
        );
        expect(hits.map((hit) => hit.item.key)).toContain("MAIN2345");
      }).pipe(Effect.scoped),
  );
});

describe("the request pause of the Web API source", () => {
  it.effect(
    "keeps the Backoff deadline of the last answer of a sync for the first request of the next sync",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const clock = yield* Clock.clockWith((current) =>
          Effect.succeed(current),
        );
        let backoff = false;
        let answeredAt = 0;
        const keysSent: number[] = [];
        const { connection, sync } = yield* source({
          ...api,
          fetch: async (url, init) => {
            if (url.includes("/keys/current"))
              keysSent.push(clock.currentTimeMillisUnsafe());
            const response = await api.fetch(url, init);
            if (!backoff || !url.includes("/groups/900/settings"))
              return response;
            answeredAt = clock.currentTimeMillisUnsafe();
            const headers = new Headers(response.headers);
            headers.set("Backoff", "300");
            return new Response(
              response.status === 304 ? null : response.body,
              {
                status: response.status,
                headers,
              },
            );
          },
        });
        yield* connection.refresh;
        backoff = true;
        yield* connection.refresh;
        backoff = false;
        const sent = keysSent.length;

        expect((yield* sync.status).rateWaitUntil).toBeUndefined();
        const next = yield* Effect.forkChild(connection.refresh, {
          startImmediately: true,
        });
        const waiting = yield* eventually(
          sync.status,
          (status) => status.rateWaitUntil !== undefined,
        );
        expect(waiting.rateWaitUntil?.epochMilliseconds).toBe(
          answeredAt + 300_000,
        );
        yield* TestClock.adjust("300 seconds");
        yield* Effect.promise(() =>
          api.api.until(() => keysSent.length > sent),
        );

        expect(keysSent[sent]).toBe(answeredAt + 300_000);
        yield* Fiber.join(next);
        expect((yield* sync.status).rateWaitUntil).toBeUndefined();
      }).pipe(Effect.scoped),
  );

  const keyOf = (init: {
    readonly headers: Readonly<Record<string, string>>;
  }) => init.headers["Zotero-API-Key"];

  it.effect(
    "keeps a 429 wait of one key for that key only, so another key of the same address checks itself at once",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const other = "secondkeyofaccount000042";
        api.api.addKey(other, READ_ALL_ACCESS, ACCOUNT);
        const clock = yield* Clock.clockWith((current) =>
          Effect.succeed(current),
        );
        const otherSent: number[] = [];
        let refused = false;
        const { connection } = yield* source({
          ...api,
          fetch: (url, init) => {
            if (url.includes("/keys/current") && keyOf(init) === other)
              otherSent.push(clock.currentTimeMillisUnsafe());
            if (url.includes("/keys/current") && keyOf(init) === api.key) {
              refused = true;
              return Promise.resolve(
                new Response("", {
                  status: 429,
                  headers: { "Retry-After": "3600" },
                }),
              );
            }
            return api.fetch(url, init);
          },
        });
        yield* until(() => refused, "the refusal");
        yield* connection.configure(webApiConfig(other));
        yield* Effect.promise(() => api.api.until(() => otherSent.length > 0));
        expect(otherSent[0]).toBe(0);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "keeps the Retry-After of the refusal that ends a throttled sync for the next sync",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const clock = yield* Clock.clockWith((current) =>
          Effect.succeed(current),
        );
        let refusals = 0;
        const keysSent: number[] = [];
        const { connection, sync } = yield* source({
          ...api,
          fetch: (url, init) => {
            if (!url.includes("/keys/current")) return api.fetch(url, init);
            keysSent.push(clock.currentTimeMillisUnsafe());
            if (refusals >= 5) return api.fetch(url, init);
            refusals += 1;
            return Promise.resolve(
              new Response("", {
                status: 429,
                headers: { "Retry-After": refusals === 5 ? "3600" : "0" },
              }),
            );
          },
        });
        const failed = yield* eventually(
          sync.status,
          (status) => status.problem !== null,
        );
        expect(failed.problem?._tag).toBe("rate-limited");
        const sent = keysSent.length;
        const next = yield* Effect.forkChild(
          Effect.ignore(connection.refresh),
          {
            startImmediately: true,
          },
        );
        yield* TestClock.adjust("3600 seconds");
        yield* Effect.promise(() =>
          api.api.until(() => keysSent.length > sent),
        );
        expect(keysSent[sent]).toBe(3_600_000);
        yield* Fiber.join(next);
      }).pipe(Effect.scoped),
  );
});

describe("the sync status of the Web API source", () => {
  const failingCheckpoint = Effect.map(
    Effect.promise(() => loadMemoryEngine()),
    (engine) => {
      const driver = wasmReplicaDriver(engine);
      return {
        ...driver,
        open: (file: string) => ({
          ...driver.open(file),
          checkpoint: () => {
            throw new Error("disk I/O error at the checkpoint");
          },
        }),
      };
    },
  );

  it.effect(
    "names a failed checkpoint as a problem of the replica file while the first build stays readable",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api, {
          driver: failingCheckpoint,
        });
        yield* connection.refresh;
        expect(yield* sync.status).toMatchObject({
          state: "ready",
          problem: null,
          fileProblem: {
            _tag: "storage",
            message: expect.stringContaining("checkpoint"),
          },
        });
        expect(yield* read(connection, (client) => titleOf(client))).toBe(
          "Main Study",
        );
      }).pipe(Effect.scoped),
  );

  it.live(
    "names a failed checkpoint next to a download that the researcher stops",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { connection, sync } = yield* source(api, {
          driver: failingCheckpoint,
        });
        yield* connection.refresh;
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Changed before the stop" });
        const held = (request: { query: { itemKey?: unknown } }) =>
          request.query.itemKey !== undefined;
        const before = api.api.requests.filter(held).length;
        const release = api.api.hold(held);
        yield* Effect.addFinalizer(() => Effect.sync(release));
        const refreshing = yield* Effect.forkChild(
          Effect.exit(connection.refresh),
          { startImmediately: true },
        );
        yield* Effect.promise(() =>
          api.api.until((fake) => fake.requests.filter(held).length > before),
        );
        expect(yield* stopRunning(sync)).toBe(true);
        yield* Fiber.join(refreshing);
        expect(yield* sync.status).toMatchObject({
          problem: { _tag: "stopped" },
          fileProblem: { _tag: "storage" },
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "names the wait that Zotero asks for with the time when the sync continues, and clears it after",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        let refused = false;
        const { sync } = yield* source({
          ...api,
          fetch: (url, init) => {
            if (!refused && url.includes("/keys/current")) {
              refused = true;
              return Promise.resolve(
                new Response("", {
                  status: 429,
                  headers: { "Retry-After": "30" },
                }),
              );
            }
            return api.fetch(url, init);
          },
        });
        const waiting = yield* eventually(
          sync.status,
          (status) => status.rateWaitUntil !== undefined,
        );
        expect(waiting.rateWaitUntil?.toString()).toBe("1970-01-01T00:00:30Z");
        yield* TestClock.adjust("30 seconds");
        const after = yield* eventually(
          sync.status,
          (status) => status.state === "ready",
        );
        expect(after).toMatchObject({ state: "ready", problem: null });
        expect(after.rateWaitUntil).toBeUndefined();
      }).pipe(Effect.scoped),
  );

  it.effect(
    "names no wait when the sync that Zotero asked to wait has ended with a problem",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        const { sync } = yield* source({
          ...api,
          fetch: (url, init) =>
            url.includes("/keys/current")
              ? Promise.resolve(
                  new Response("", {
                    status: 403,
                    headers: { Backoff: "300" },
                  }),
                )
              : api.fetch(url, init),
        });
        const ended = yield* eventually(
          sync.status,
          (status) => status.problem !== null,
        );
        expect(ended).toMatchObject({
          syncing: false,
          problem: { _tag: "key-invalid" },
        });
        expect(ended.rateWaitUntil).toBeUndefined();
      }).pipe(Effect.scoped),
  );
});
