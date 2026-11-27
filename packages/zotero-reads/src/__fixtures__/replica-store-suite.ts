import { it } from "@effect/vitest";
import {
  Cause,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Logger,
  Scope,
  SubscriptionRef,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, expectTypeOf } from "vitest";

import type { ZoteroDatabase } from "@zotlit/db";
import { beginLibraryPass, recordUnchanged } from "@zotlit/db/replica";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import type { ApplyStep } from "@zotlit/web-library";

import type { ReplicaDriver, ReplicaHandle } from "#worker/replica-driver.ts";
import { makeReplicaStore } from "#worker/replica-store.ts";
import type {
  ApplyRequest,
  Readable,
  ReplicaStore,
  ReplicaStoreOptions,
} from "#worker/replica-store.ts";

export interface ReplicaStoreSuite {
  readonly driver: () => Promise<ReplicaDriver>;
  readonly exists: (driver: ReplicaDriver, file: string) => boolean;
  readonly leaveSidecars: (driver: ReplicaDriver, file: string) => void;
  readonly checkpointStatements: number;
}

const HOLD_BACK = "20 millis";
const MARKER = "marker-of-the-open-apply";

const notes = (db: ZoteroDatabase): string[] =>
  db
    .all<{ body: string }>("select body from storeNotes order by id")
    .map((row) => row.body);

function inserts(
  bodies: readonly string[],
  first: (db: ZoteroDatabase) => void = () => undefined,
): ApplyRequest["steps"] {
  return function* (db) {
    first(db);
    for (const [index, body] of bodies.entries()) {
      db.run(`insert into storeNotes (body) values ('${body}')`);
      yield { applied: index + 1, total: bodies.length } satisfies ApplyStep;
    }
    return [];
  };
}

interface Faults {
  failing: boolean;
  checkpointFails?: boolean;
  renewFails?: boolean;
  closeFails?: boolean;
  refusing?: boolean;
  stageRollbackFails?: boolean;
  onOpen?: () => void;
  opens: number;
  closes?: number;
}

function withFailingRollback(
  db: ZoteroDatabase,
  faults: Faults,
): ZoteroDatabase {
  return new Proxy(db, {
    get(target, key) {
      if (key === "transaction" && faults.stageRollbackFails)
        return (write: (tx: ZoteroDatabase) => unknown) => {
          target.run("begin");
          const written = write(target);
          target.run("commit");
          return written;
        };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function faulty(driver: ReplicaDriver, faults: Faults): ReplicaDriver {
  return {
    ...driver,
    open: (file) => {
      faults.opens++;
      if (faults.refusing) throw new Error("the replica file is held");
      const handle = driver.open(file);
      faults.onOpen?.();
      let seen: ZoteroDatabase | undefined;
      let proxy: ZoteroDatabase | undefined;
      return {
        get db() {
          if (seen !== handle.db) {
            seen = handle.db;
            proxy = withFailingRollback(handle.db, faults);
          }
          return proxy!;
        },
        statements: () => handle.statements(),
        changes: () => handle.changes(),
        inTransaction: () => handle.inTransaction(),
        exec: (text) => {
          if (faults.failing && (text === "commit" || text === "rollback"))
            throw new Error(`disk I/O error at ${text}`);
          handle.exec(text);
        },
        checkpoint: () => {
          if (faults.checkpointFails)
            throw new Error("disk I/O error at the checkpoint");
          handle.checkpoint();
        },
        renew: () => {
          if (faults.renewFails)
            throw new Error("disk I/O error at the renewal");
          return handle.renew();
        },
        close: () => {
          faults.closes = (faults.closes ?? 0) + 1;
          handle.close();
          if (faults.closeFails) throw new Error("disk I/O error at the close");
        },
      } satisfies ReplicaHandle;
    },
  };
}

let files = 0;

export function describeReplicaStore(
  name: string,
  suite: ReplicaStoreSuite,
): void {
  const openStore = (
    options: Partial<ReplicaStoreOptions> & {
      readonly base?: ReplicaDriver;
      readonly faults?: Faults;
      readonly opened?: boolean;
    } = {},
  ) =>
    Effect.gen(function* () {
      const { base, faults, opened = true, ...rest } = options;
      const driver = base ?? (yield* Effect.promise(() => suite.driver()));
      const file = rest.file ?? `replica-store-${++files}.sqlite`;
      const store = yield* makeReplicaStore({
        driver: Effect.succeed(faults ? faulty(driver, faults) : driver),
        readable: yield* SubscriptionRef.make<Readable>({
          state: "ready",
          error: null,
        }),
        holdBack: HOLD_BACK,
        sliceMillis: 0,
        ...rest,
        file,
      });
      if (opened) {
        yield* store.open;
        store.stage((db) =>
          db.run(
            "create table if not exists storeNotes (id integer primary key, body text not null)",
          ),
        );
      }
      const read = <A>(f: (db: ZoteroDatabase) => A) =>
        Effect.scoped(Effect.map(store.borrow, (db) => f(db)));
      return { store, driver, file, read };
    });

  const closedReplica = (prepare: (store: ReplicaStore) => Effect.Effect<void, unknown>) =>
    Effect.gen(function* () {
      const file = `replica-store-${++files}.sqlite`;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { store } = yield* openStore({ file });
          yield* Effect.orDie(prepare(store));
        }),
      );
      return file;
    });

  describe(`the Replica Store on ${name}`, () => {
    it.effect(
      "keeps a reader that comes between the slices of an apply waiting, then gives it the complete new state",
      () =>
        Effect.gen(function* () {
          let slices = 0;
          let reader: Fiber.Fiber<string[], unknown> | undefined;
          const pending: boolean[] = [];
          let probe: Effect.Effect<void> = Effect.void;
          const { store, read } = yield* openStore({
            betweenSlices: Effect.suspend(() => probe),
          });
          yield* store.apply({ steps: inserts(["old"]), visible: () => true });
          probe = Effect.gen(function* () {
            if (++slices === 1)
              reader = yield* Effect.forkDetach(read(notes), {
                startImmediately: true,
              });
            else pending.push(reader!.pollUnsafe() === undefined);
          });
          yield* store.apply({
            steps: inserts(["a", "b", "c"]),
            visible: () => true,
          });
          expect(pending.length).toBeGreaterThan(0);
          expect(pending.every(Boolean)).toBe(true);
          expect(yield* Fiber.join(reader!)).toEqual(["old", "a", "b", "c"]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "begins an apply only when no borrow is held, and holds new borrows back while it waits",
      () =>
        Effect.gen(function* () {
          const { store, read } = yield* openStore();
          const pin = yield* Scope.make();
          const pinned = yield* Scope.provide(store.borrow, pin);
          let began = false;
          const applying = yield* Effect.forkChild(
            store.apply({
              steps: (db) => {
                began = true;
                return inserts(["late"])(db);
              },
              visible: () => true,
            }),
            { startImmediately: true },
          );
          expect(store.report().waitingForReaders).toBe(true);
          const held = yield* Effect.forkChild(read(notes), {
            startImmediately: true,
          });
          expect(held.pollUnsafe()).toBeUndefined();
          yield* TestClock.adjust("1 second");
          expect(began).toBe(false);
          expect(notes(pinned)).toEqual([]);
          yield* Scope.close(pin, Exit.void);
          yield* Fiber.join(applying);
          expect(began).toBe(true);
          expect(yield* read(notes)).toEqual(["late"]);
          yield* Fiber.join(held);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "leaves the complete old state when the apply stops between slices",
      () =>
        Effect.gen(function* () {
          const second = yield* Deferred.make<void>();
          let slices = -1;
          const { store, read } = yield* openStore({
            betweenSlices: Effect.suspend(() =>
              slices >= 0 && ++slices === 2
                ? Effect.andThen(Deferred.succeed(second, undefined), Effect.never)
                : Effect.void,
            ),
          });
          yield* store.apply({ steps: inserts(["old"]), visible: () => true });
          slices = 0;
          const applying = yield* Effect.forkChild(
            store.apply({ steps: inserts(["a", "b", "c"]), visible: () => true }),
          );
          yield* Deferred.await(second);
          yield* Fiber.interrupt(applying);
          expect(store.report().state).toBe("open");
          expect(yield* read(notes)).toEqual(["old"]);
          expect(store.stage(notes)).toEqual(["old"]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "opens the file again when the rollback of a failed apply fails, and keeps the last good replica readable",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const { store, read } = yield* openStore({ faults });
          yield* store.apply({ steps: inserts(["good"]), visible: () => true });
          const before = yield* read((db) => db);
          faults.failing = true;
          const failure = yield* Effect.flip(
            store.apply({ steps: inserts(["lost"]), visible: () => true }),
          );
          faults.failing = false;
          expect(failure).toMatchObject({
            _tag: "storage",
            message: expect.stringContaining("could not commit the apply"),
          });
          expect(faults.opens).toBe(2);
          expect(store.report().state).toBe("open");
          const after = yield* read((db) => ({
            same: db === before,
            notes: notes(db),
          }));
          expect(after).toEqual({ same: false, notes: ["good"] });
          yield* store.apply({ steps: inserts(["next"]), visible: () => true });
          expect(yield* read(notes)).toEqual(["good", "next"]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "reports the store as closed when the file does not open again after a failed rollback, and fails each borrow",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const { store, read } = yield* openStore({ faults });
          yield* store.apply({ steps: inserts(["good"]), visible: () => true });
          faults.failing = true;
          faults.refusing = true;
          yield* Effect.flip(
            store.apply({ steps: inserts(["lost"]), visible: () => true }),
          );
          expect(store.report().state).toBe("unavailable");
          expect(yield* Effect.flip(read(notes))).toMatchObject({
            _tag: "DbUnavailable",
          });
          faults.failing = false;
          faults.refusing = false;
          yield* store.open;
          expect(yield* read(notes)).toEqual(["good"]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "reports the store as closed when its client cannot be served after the open, and opens it once the file is whole again",
      () =>
        Effect.gen(function* () {
          const file = yield* closedReplica((store) =>
            Effect.sync(() =>
              store.stage((db) =>
                db.run("alter table settings rename to settingsAway"),
              ),
            ),
          );
          const { store, driver, read } = yield* openStore({
            file,
            opened: false,
          });
          yield* Effect.flip(store.open);
          expect(store.report().state).toBe("unavailable");
          yield* Effect.acquireUseRelease(
            Effect.sync(() => driver.open(file)),
            (repair) =>
              Effect.sync(() =>
                repair.exec("alter table settingsAway rename to settings"),
              ),
            (repair) => Effect.sync(() => repair.close()),
          );
          yield* store.open;
          expect(store.report().state).toBe("open");
          expect(
            yield* read((db) =>
              db.get("select 1 from sqlite_master where name = 'settings'"),
            ),
          ).toBeDefined();
        }).pipe(Effect.scoped),
    );

    it.effect(
      "keeps the handle of an open that is interrupted, so the replica stays open and readable",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const { store, read } = yield* openStore({ faults, opened: false });
          const opening = yield* Effect.forkChild(store.open);
          faults.onOpen = () => opening.interruptUnsafe();
          const exit = yield* Fiber.await(opening);
          faults.onOpen = undefined;
          expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
            true,
          );
          expect(store.report().state).toBe("open");
          expect(faults.opens).toBe(1);
          expect(faults.closes ?? 0).toBe(0);
          expect(
            yield* read((db) => db.get("select 1 from sqlite_master limit 1")),
          ).toBeDefined();
        }).pipe(Effect.scoped),
    );

    it.effect(
      "opens the file again after a staging write whose rollback fails, once the held borrow lets go, and answers the status from the last commit meanwhile",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const { store, read } = yield* openStore({ faults });
          store.stage((db) =>
            db.run("insert into storeNotes (body) values ('kept')"),
          );
          const before = yield* store.libraries;
          const pin = yield* Scope.make();
          const pinned = yield* Scope.provide(store.borrow, pin);
          faults.stageRollbackFails = true;
          faults.failing = true;
          expect(() =>
            store.stage((db) => {
              db.run("insert into storeNotes (body) values ('half')");
              db.run(
                "insert into replicaSyncMeta (key, value) values ('zoteroLocale', 'uncommitted')",
              );
              throw new Error("the second write failed");
            }),
          ).toThrow("the second write failed");
          faults.stageRollbackFails = false;
          yield* Effect.yieldNow;
          expect(store.report().waitingForReaders).toBe(true);
          expect(notes(pinned)).toContain("kept");
          expect(yield* store.libraries).toEqual(before);
          expect(() => store.stage(notes)).toThrow();
          const opening = yield* Effect.forkChild(store.open, {
            startImmediately: true,
          });
          expect(opening.pollUnsafe()).toBeUndefined();
          yield* Scope.close(pin, Exit.void);
          yield* Fiber.join(opening);
          faults.failing = false;
          expect(faults.opens).toBe(2);
          expect(yield* read(notes)).toEqual(["kept"]);
          expect((yield* store.libraries).zoteroLocale).toBeNull();
          store.stage((db) =>
            db.run("insert into storeNotes (body) values ('whole')"),
          );
          expect(yield* read(notes)).toEqual(["kept", "whole"]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "publishes a commit whose client renewal fails by opening the file again, then sends the change event and serves the new rows on a new client",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          let commits = 0;
          const { store, read } = yield* openStore({ faults });
          yield* store.apply({ steps: inserts(["old"]), visible: () => true });
          const before = yield* read((db) => db);
          faults.renewFails = true;
          const changed = yield* store.apply({
            steps: inserts(["new"]),
            visible: () => true,
            onCommit: Effect.sync(() => void commits++),
          });
          faults.renewFails = false;
          expect(changed).toBe(true);
          expect(commits).toBe(1);
          expect(faults.opens).toBe(2);
          expect(
            yield* read((db) => ({ same: db === before, notes: notes(db) })),
          ).toEqual({ same: false, notes: ["old", "new"] });
        }).pipe(Effect.scoped),
    );

    it.effect(
      "makes the store unavailable and tells the source once when a committed apply cannot be published, and keeps the commit for the next open",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const unavailable: unknown[] = [];
          let commits = 0;
          const { store, read } = yield* openStore({
            faults,
            onUnavailable: (problem) =>
              Effect.sync(() => void unavailable.push(problem)),
          });
          yield* store.apply({ steps: inserts(["old"]), visible: () => true });
          faults.renewFails = true;
          faults.refusing = true;
          expect(
            yield* Effect.flip(
              store.apply({
                steps: inserts(["new"]),
                visible: () => true,
                onCommit: Effect.sync(() => void commits++),
              }),
            ),
          ).toMatchObject({ _tag: "storage" });
          expect(commits).toBe(0);
          expect(unavailable).toEqual([
            expect.objectContaining({ _tag: "storage" }),
          ]);
          expect(yield* Effect.flip(read(notes))).toMatchObject({
            _tag: "DbUnavailable",
          });
          faults.renewFails = false;
          faults.refusing = false;
          yield* store.open;
          expect(yield* read(notes)).toEqual(["old", "new"]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "admits no new borrow after a failed staging rollback until the recovery ends, also once the hold-back has passed",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const { store, read } = yield* openStore({ faults });
          store.stage((db) =>
            db.run("insert into storeNotes (body) values ('kept')"),
          );
          const pin = yield* Scope.make();
          yield* Scope.provide(store.borrow, pin);
          faults.stageRollbackFails = true;
          faults.failing = true;
          expect(() =>
            store.stage((db) => {
              db.run("insert into storeNotes (body) values ('half')");
              throw new Error("the second write failed");
            }),
          ).toThrow("the second write failed");
          faults.stageRollbackFails = false;
          yield* TestClock.adjust("1 second");
          const late = yield* Effect.forkChild(read(notes), {
            startImmediately: true,
          });
          yield* TestClock.adjust("1 second");
          expect(late.pollUnsafe()).toBeUndefined();
          yield* Scope.close(pin, Exit.void);
          expect(yield* Fiber.join(late)).toEqual(["kept"]);
          faults.failing = false;
        }).pipe(Effect.scoped),
    );

    it.effect(
      "tells the source that the store is unavailable when the file does not open again after a failed staging rollback",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const unavailable: unknown[] = [];
          const { store, read } = yield* openStore({
            faults,
            onUnavailable: (problem) =>
              Effect.sync(() => void unavailable.push(problem)),
          });
          faults.stageRollbackFails = true;
          faults.failing = true;
          faults.refusing = true;
          expect(() =>
            store.stage((db) => {
              db.run("insert into storeNotes (body) values ('half')");
              throw new Error("the second write failed");
            }),
          ).toThrow("the second write failed");
          expect(yield* Effect.flip(read(notes))).toMatchObject({
            _tag: "DbUnavailable",
          });
          expect(unavailable).toEqual([
            expect.objectContaining({ _tag: "storage" }),
          ]);
          faults.stageRollbackFails = false;
          faults.failing = false;
          faults.refusing = false;
        }).pipe(Effect.scoped),
    );

    it.effect(
      "logs a failed close of the broken handle when it opens the file again",
      () =>
        Effect.gen(function* () {
          const warnings: string[] = [];
          const faults: Faults = { failing: false, opens: 0 };
          yield* Effect.gen(function* () {
            const { store } = yield* openStore({ faults });
            faults.failing = true;
            faults.closeFails = true;
            yield* Effect.flip(
              store.apply({ steps: inserts(["lost"]), visible: () => true }),
            );
            faults.failing = false;
            faults.closeFails = false;
          }).pipe(
            Effect.provide(
              Logger.layer([
                Logger.make(({ logLevel, message }) => {
                  if (logLevel === "Warn") warnings.push(String(message));
                }),
              ]),
            ),
          );
          expect(warnings).toContainEqual(
            expect.stringContaining("could not close"),
          );
        }).pipe(Effect.scoped),
    );

    it.effect(
      "answers the libraries of the newest commit during a recovery, with no status request after the commit",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const { store, read } = yield* openStore({ faults });
          yield* store.apply({
            steps: inserts(["a"], (db) =>
              db.run(
                `insert into replicaSyncMeta (key, value) values ('zoteroLocale', '${MARKER}')`,
              ),
            ),
            visible: () => true,
          });
          const pin = yield* Scope.make();
          yield* Scope.provide(store.borrow, pin);
          faults.stageRollbackFails = true;
          faults.failing = true;
          expect(() =>
            store.stage(() => {
              throw new Error("the write failed");
            }),
          ).toThrow("the write failed");
          faults.stageRollbackFails = false;
          yield* Effect.yieldNow;
          expect((yield* store.libraries).zoteroLocale).toBe(MARKER);
          yield* Scope.close(pin, Exit.void);
          yield* read(notes);
          faults.failing = false;
        }).pipe(Effect.scoped),
    );

    it.effect(
      "lists only the libraries that an apply committed: a staged new group is absent, and a library that waits for its removal stays",
      () =>
        Effect.gen(function* () {
          const committedList = (store: ReplicaStore) =>
            Effect.map(store.libraries, ({ libraries }) =>
              libraries.map(({ library }) => `${library.type}:${library.id}`),
            );
          const file = yield* closedReplica((store) =>
            Effect.gen(function* () {
              store.stage((db) => {
                db.run(
                  "insert into replicaSyncLibraries (libraryType, remoteID, state, sinceVersion, lastSync) values ('group', 8, 'remove', 3, 1000)",
                );
                beginLibraryPass(db, {
                  library: { type: "group", id: 7 },
                  sinceVersion: 0,
                  targetVersion: 5,
                });
              });
              yield* store.apply({
                steps: inserts(["seen"]),
                visible: () => true,
              });
              expect(yield* committedList(store)).toEqual(["group:8"]);
            }),
          );
          const { store } = yield* openStore({ file, opened: false });
          yield* store.open;
          expect(yield* committedList(store)).toEqual(["group:8"]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "reads the last commit again when a download ends, so the sync time of an unchanged library is current",
      () =>
        Effect.gen(function* () {
          const { store } = yield* openStore();
          const library = { type: "user", id: 42 } as const;
          const syncedAt = (at: number) =>
            store.stage((db) =>
              recordUnchanged(db, library, toInstant(DateTime.makeUnsafe(at))),
            );
          syncedAt(1_000);
          yield* store.apply({ steps: inserts(["a"]), visible: () => true });
          syncedAt(2_000);
          yield* store.downloadEnded;
          expect(
            (yield* store.libraries).libraries.map((entry) =>
              entry.lastSync?.epochMilliseconds,
            ),
          ).toEqual([2_000]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "runs a staging write while a reader holds a borrow, as one transaction that a failure undoes",
      () =>
        Effect.gen(function* () {
          const { store } = yield* openStore();
          const pin = yield* Scope.make();
          const pinned = yield* Scope.provide(store.borrow, pin);
          store.stage((db) =>
            db.run("insert into storeNotes (body) values ('staged')"),
          );
          expect(notes(pinned)).toEqual(["staged"]);
          expect(() =>
            store.stage((db) => {
              db.run("insert into storeNotes (body) values ('half')");
              throw new Error("the second write failed");
            }),
          ).toThrow("the second write failed");
          expect(notes(pinned)).toEqual(["staged"]);
          yield* Scope.close(pin, Exit.void);
        }).pipe(Effect.scoped),
    );

    it.effect("accepts only a synchronous staging write", () =>
      Effect.gen(function* () {
        const { store } = yield* openStore();
        expectTypeOf<(db: ZoteroDatabase) => Promise<void>>().not.toExtend<
          Parameters<typeof store.stage<Promise<void>>>[0]
        >();
        expectTypeOf<(db: ZoteroDatabase) => Promise<undefined>>().not.toExtend<
          Parameters<typeof store.stage<void>>[0]
        >();
        expectTypeOf<(db: ZoteroDatabase) => void | Promise<void>>().not.toExtend<
          Parameters<typeof store.stage<void | Promise<void>>>[0]
        >();
        expectTypeOf<(db: ZoteroDatabase) => void>().toExtend<
          Parameters<typeof store.stage<void>>[0]
        >();
        expect(store.stage(() => 1)).toBe(1);
      }).pipe(Effect.scoped),
    );

    it.effect(
      "fails the open with a storage problem when the libraries or the identity cannot be read, and applies nothing on that file",
      () =>
        Effect.gen(function* () {
          for (const [table, away, stand] of [
            ["replicaSyncLibraries", "librariesAway", "(unrelated integer)"],
            ["settings", "settingsAway", null],
          ] as const) {
            const file = yield* closedReplica((store) =>
              Effect.sync(() =>
                store.stage((db) => {
                  db.run(`alter table ${table} rename to ${away}`);
                  if (stand) db.run(`create table ${table} ${stand}`);
                }),
              ),
            );
            const { store, driver, read } = yield* openStore({
              file,
              opened: false,
            });
            expect(yield* Effect.flip(store.open)).toMatchObject({
              _tag: "storage",
            });
            expect(yield* Effect.flip(store.libraries)).toMatchObject({
              _tag: "storage",
            });
            expect(
              yield* Effect.flip(
                store.apply({ steps: inserts(["never"]), visible: () => true }),
              ),
            ).toMatchObject({ _tag: "storage" });
            yield* Effect.acquireUseRelease(
              Effect.sync(() => driver.open(file)),
              (repair) =>
                Effect.sync(() => {
                  if (stand) repair.exec(`drop table ${table}`);
                  repair.exec(`alter table ${away} rename to ${table}`);
                }),
              (repair) => Effect.sync(() => repair.close()),
            );
            yield* store.open;
            expect(yield* read(notes)).toEqual([]);
            expect((yield* store.libraries).identity).toMatchObject({
              kind: "web-api",
            });
          }
        }).pipe(Effect.scoped),
    );

    it.effect(
      "answers the libraries, the replica language and the identity from the last commit during an apply",
      () =>
        Effect.gen(function* () {
          const seen: unknown[] = [];
          let probe: Effect.Effect<void> = Effect.void;
          const { store } = yield* openStore({
            betweenSlices: Effect.suspend(() => probe),
          });
          const before = yield* store.libraries;
          expect(before.zoteroLocale).toBeNull();
          expect(before.identity).toMatchObject({ kind: "web-api" });
          probe = Effect.orDie(
            Effect.map(store.libraries, (committed) => {
              seen.push(committed);
            }),
          );
          yield* store.apply({
            steps: inserts(["a", "b"], (db) => {
              db.run(
                `insert into replicaSyncMeta (key, value) values ('zoteroLocale', '${MARKER}')`,
              );
              db.run(
                `insert or replace into settings (setting, key, value) values ('account', 'username', '${MARKER}')`,
              );
            }),
            visible: () => true,
          });
          probe = Effect.void;
          expect(seen.length).toBeGreaterThan(0);
          for (const committed of seen) expect(committed).toEqual(before);
          const after = yield* store.libraries;
          expect(after.zoteroLocale).toBe(MARKER);
          expect(after.identity).toMatchObject({ username: MARKER });
        }).pipe(Effect.scoped),
    );

    it.effect(
      "keeps the client object and runs no commit step for an apply with no change that readers see",
      () =>
        Effect.gen(function* () {
          let commits = 0;
          const { store, read } = yield* openStore();
          const before = yield* read((db) => db);
          const quiet = yield* store.apply({
            steps: inserts(["unseen"]),
            visible: () => false,
            onCommit: Effect.sync(() => void commits++),
          });
          expect(quiet).toBe(false);
          expect(commits).toBe(0);
          expect(yield* read((db) => db === before)).toBe(true);
          const seen = yield* store.apply({
            steps: inserts(["seen"]),
            visible: () => true,
            onCommit: Effect.sync(() => void commits++),
          });
          expect(seen).toBe(true);
          expect(commits).toBe(1);
          expect(yield* read((db) => db === before)).toBe(false);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "empties the replica into a new one in the same file once no borrow is held",
      () =>
        Effect.gen(function* () {
          const { store, read } = yield* openStore();
          yield* store.apply({ steps: inserts(["gone"]), visible: () => true });
          const pin = yield* Scope.make();
          yield* Scope.provide(store.borrow, pin);
          let announced = false;
          const emptying = yield* Effect.forkChild(
            store.empty(Effect.sync(() => void (announced = true))),
            { startImmediately: true },
          );
          expect(store.report().waitingForReaders).toBe(true);
          expect(announced).toBe(false);
          yield* Scope.close(pin, Exit.void);
          yield* Fiber.join(emptying);
          expect(announced).toBe(true);
          expect(
            yield* read((db) =>
              db.get("select 1 from sqlite_master where name = 'storeNotes'"),
            ),
          ).toBeUndefined();
        }).pipe(Effect.scoped),
    );

    it.effect(
      "removes the replica file once no borrow is held",
      () =>
        Effect.gen(function* () {
          const { store, driver, file } = yield* openStore();
          yield* store.apply({ steps: inserts(["gone"]), visible: () => true });
          const pin = yield* Scope.make();
          yield* Scope.provide(store.borrow, pin);
          const removing = yield* Effect.forkChild(store.remove(), {
            startImmediately: true,
          });
          expect(store.report().waitingForReaders).toBe(true);
          expect(suite.exists(driver, file)).toBe(true);
          yield* Scope.close(pin, Exit.void);
          yield* Fiber.join(removing);
          expect(store.report().state).toBe("closed");
          expect(suite.exists(driver, file)).toBe(false);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "removes the journal and WAL files that a closed replica left",
      () =>
        Effect.gen(function* () {
          const file = yield* closedReplica((store) =>
            Effect.asVoid(
              store.apply({ steps: inserts(["gone"]), visible: () => true }),
            ),
          );
          const { store, driver } = yield* openStore({ file, opened: false });
          suite.leaveSidecars(driver, file);
          const names = [file, `${file}-journal`, `${file}-wal`];
          for (const name of names)
            expect(suite.exists(driver, name)).toBe(true);
          yield* store.remove();
          for (const name of names)
            expect(suite.exists(driver, name)).toBe(false);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "tells its observer the statements and changed rows of each staging write and each apply",
      () =>
        Effect.gen(function* () {
          const seen: string[] = [];
          const { store } = yield* openStore({
            observer: {
              staged: ({ statements, changes }) =>
                void seen.push(`stage ${statements} ${changes}`),
              applied: ({ statements, changes }) =>
                void seen.push(`apply ${statements} ${changes}`),
            },
          });
          seen.length = 0;
          store.stage((db) => {
            db.run("insert into storeNotes (body) values ('x'), ('y')");
            db.run("update storeNotes set body = body || '!'");
          });
          expect(store.stage(notes)).toEqual(["x!", "y!"]);
          yield* store.apply({
            steps: inserts(["a", "b", "c"]),
            visible: () => true,
          });
          expect(seen).toEqual([
            "stage 4 4",
            "stage 3 0",
            `apply ${5 + suite.checkpointStatements} 3`,
          ]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "times each apply from begin to commit, and the read gate from its close to its reopen",
      () =>
        Effect.gen(function* () {
          const { store } = yield* openStore({
            betweenSlices: Effect.sleep("10 millis"),
          });
          expect(store.report().lastApply).toBeNull();
          const applying = yield* Effect.forkChild(
            store.apply({
              steps: inserts(["b", "c", "d"]),
              visible: () => true,
              onCommit: Effect.sleep("5 millis"),
            }),
            { startImmediately: true },
          );
          yield* TestClock.adjust("35 millis");
          yield* Fiber.join(applying);
          expect(store.report().lastApply).toMatchObject({
            sequence: 1,
            applyMillis: 30,
            closedMillis: 35,
          });
        }).pipe(Effect.scoped),
    );

    it.effect(
      "counts the drain of a short borrow in the time that the gate stays closed, and leaves out a borrow longer than the hold-back",
      () =>
        Effect.gen(function* () {
          const { store } = yield* openStore({
            betweenSlices: Effect.sleep("10 millis"),
          });
          const pinnedApply = (held: `${number} millis`) =>
            Effect.gen(function* () {
              const pin = yield* Scope.make();
              yield* Scope.provide(store.borrow, pin);
              const applying = yield* Effect.forkChild(
                store.apply({ steps: inserts(["e"]), visible: () => true }),
                { startImmediately: true },
              );
              yield* TestClock.adjust(held);
              yield* Scope.close(pin, Exit.void);
              yield* TestClock.adjust("10 millis");
              yield* Fiber.join(applying);
              return store.report().lastApply!.closedMillis;
            });
          expect(yield* pinnedApply("15 millis")).toBe(25);
          expect(yield* pinnedApply("35 millis")).toBe(10);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "records the times of a committed apply when an interrupt comes during its change event",
      () =>
        Effect.gen(function* () {
          const { store } = yield* openStore();
          const reached = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const applying = yield* Effect.forkChild(
            store.apply({
              steps: inserts(["kept"]),
              visible: () => true,
              onCommit: Effect.andThen(
                Deferred.succeed(reached, undefined),
                Deferred.await(release),
              ),
            }),
            { startImmediately: true },
          );
          yield* Deferred.await(reached);
          const interrupting = yield* Effect.forkChild(
            Fiber.interrupt(applying),
            { startImmediately: true },
          );
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(interrupting);
          expect(store.report().lastApply).toMatchObject({ sequence: 1 });
        }).pipe(Effect.scoped),
    );

    it.effect(
      "publishes a commit before it tells the observer, so a failed measurement keeps the new state readable",
      () =>
        Effect.gen(function* () {
          let announced = false;
          const { store, read } = yield* openStore({
            observer: {
              staged: () => undefined,
              applied: () => {
                throw new Error("the measurement failed");
              },
            },
          });
          const exit = yield* Effect.exit(
            store.apply({
              steps: inserts(["kept"]),
              visible: () => true,
              onCommit: Effect.sync(() => void (announced = true)),
            }),
          );
          expect(Exit.isFailure(exit)).toBe(true);
          expect(announced).toBe(true);
          expect(yield* read(notes)).toEqual(["kept"]);
        }).pipe(Effect.scoped),
    );
    it.effect(
      "keeps a published apply served and readable when the checkpoint after it fails, and names a storage problem until a checkpoint succeeds",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          let atCommit: unknown = "not published";
          const { store, read } = yield* openStore({ faults });
          faults.checkpointFails = true;
          const changed = yield* store.apply({
            steps: inserts(["published"]),
            visible: () => true,
            onCommit: Effect.sync(() => {
              atCommit = store.report().fileProblem;
            }),
          });
          expect(changed).toBe(true);
          expect(atCommit).toBeNull();
          expect(yield* read(notes)).toEqual(["published"]);
          expect(store.report().fileProblem).toMatchObject({
            _tag: "storage",
            message: expect.stringContaining("checkpoint"),
          });
          faults.checkpointFails = false;
          yield* store.downloadEnded;
          expect(store.report().fileProblem).toBeNull();
          expect(faults.opens).toBe(1);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "forgets the checkpoint problem of a replica file once that file is removed",
      () =>
        Effect.gen(function* () {
          const faults: Faults = { failing: false, opens: 0 };
          const { store } = yield* openStore({ faults });
          faults.checkpointFails = true;
          yield* store.apply({ steps: inserts(["kept"]), visible: () => true });
          expect(store.report().fileProblem).not.toBeNull();
          yield* store.empty();
          expect(store.report().fileProblem).toBeNull();
        }).pipe(Effect.scoped),
    );
  });
}
