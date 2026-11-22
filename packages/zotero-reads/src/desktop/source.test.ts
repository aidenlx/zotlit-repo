import type { ZoteroReadsClient } from "#contract/rpc.ts";
import type { ChangeEvent, ReadsConfig } from "#contract/rpc.ts";
import { it } from "@effect/vitest";
import type { FileSystem } from "effect";
import {
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  PlatformError,
  Queue,
  Ref,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { createFixtureSchema } from "@zotlit/db-testing";
import { layerNodeFileSystemWith } from "@zotlit/obsidian-desktop/__fixtures__/node-file-system.ts";
import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@zotlit/plugin-kernel/constants.ts";

import { prepareRead, snapshotSource } from "./read-source.ts";
import type { PreparedRead, SourceFingerprint } from "./read-source.ts";
import { layerSource } from "./source.ts";
import type { SourceOptions, SourcePorts } from "./source.ts";

import { DbUnavailable } from "#contract/rpc.ts";
import { Connection } from "#worker/connection.ts";
import { makeInProcessClient } from "#worker/in-process.ts";

let watchers: FakeWatcher[] = [];
let unwatchable = new Map<string, "fail" | "die" | "hang">();
let hungStarts = Deferred.makeUnsafe<void>();

const fakeWatch = (
  path: string,
  options?: FileSystem.WatchOptions,
): Stream.Stream<FileSystem.WatchEvent, PlatformError.PlatformError> =>
  unwatchable.get(path) === "fail"
    ? Stream.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "FileSystem",
          method: "stat",
          pathOrDescriptor: path,
        }),
      )
    : unwatchable.get(path) === "die"
      ? Stream.callback<FileSystem.WatchEvent>(() =>
          Effect.sync(() => {
            throw Object.assign(
              new Error(
                "ENOSPC: System limit for number of file watchers reached",
              ),
              { code: "ENOSPC" },
            );
          }),
        )
      : Stream.callback<FileSystem.WatchEvent>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const watcher: FakeWatcher = {
                path,
                listener: (_event, filename) =>
                  Queue.offerUnsafe(queue, { _tag: "Update", path: filename }),
                pending: () => Queue.sizeUnsafe(queue),
                closed: false,
              };
              watchers.push(watcher);
              return watcher;
            }),
            (watcher) =>
              Effect.sync(() => {
                watcher.closed = true;
              }),
          ).pipe(
            Effect.tap(() =>
              Effect.andThen(
                unwatchable.get(path) === "hang"
                  ? Deferred.await(hungStarts)
                  : Effect.void,
                Effect.sync(() => options?.onReady?.()),
              ),
            ),
          ),
        );

const testFileSystem = layerNodeFileSystemWith(() => ({ watch: fakeWatch }));

const testSource = (options?: SourceOptions) =>
  layerSource(options).pipe(Layer.provideMerge(testFileSystem));

let dir: string;
let dbPath: string;

beforeEach(async () => {
  watchers = [];
  unwatchable = new Map();
  hungStarts = Deferred.makeUnsafe<void>();
  dir = join(tmpdir(), `zotlit-reads-source-test-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  dbPath = join(dir, "zotero.sqlite");
  writeLibrary(dbPath, 1);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function writeLibrary(path: string, version: number): void {
  using sqlite = new DatabaseSync(path);
  seedLibrary(sqlite);
  sqlite.exec(`update libraries set version = ${version} where libraryID = 1`);
}

function seedLibrary(sqlite: DatabaseSync): void {
  const exists = sqlite
    .prepare("select name from sqlite_master where name = 'libraries'")
    .get();
  if (exists) return;
  createFixtureSchema(sqlite);
  sqlite.exec(
    "insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', 0, 0)",
  );
}

function config(patch: Partial<ReadsConfig> = {}): ReadsConfig {
  return {
    databasePath: dbPath,
    readMode: "copy",
    autoRefresh: true,
    locale: null,
    chineseSegmenter: null,
    logLevel: null,
    ...patch,
  };
}

interface FakeWatcher {
  readonly path: string;
  readonly listener: (event: string, filename: string) => void;
  readonly pending: () => number;
  closed: boolean;
}

function testPorts() {
  const reads: PreparedRead[] = [];
  const releases: PreparedRead[] = [];
  const releaseGate = Ref.makeUnsafe<{
    entered: Deferred.Deferred<void>;
    release: Deferred.Deferred<void>;
  } | null>(null);
  const ports = {
    prepareRead: vi.fn<SourcePorts["prepareRead"]>(
      (mode: ReadsConfig["readMode"], path: string) =>
        prepareRead(mode, path).pipe(
          Effect.tap((read) => Effect.sync(() => reads.push(read))),
          Effect.flatMap((read) =>
            Effect.acquireRelease(Effect.succeed(read), () =>
              Ref.getAndSet(releaseGate, null).pipe(
                Effect.flatMap((gate) =>
                  gate
                    ? Effect.andThen(
                        Deferred.succeed(gate.entered, undefined),
                        Deferred.await(gate.release),
                      )
                    : Effect.void,
                ),
                Effect.andThen(Effect.sync(() => releases.push(read))),
              ),
            ),
          ),
        ),
    ),
    snapshotSource: vi.fn<SourcePorts["snapshotSource"]>(snapshotSource),
    reapReadClones: vi.fn<SourcePorts["reapReadClones"]>(() => Effect.void),
  } satisfies Partial<SourcePorts>;
  return { ports, watchers, reads, releases, releaseGate };
}

const waitFor = (assertion: () => void) =>
  Effect.promise(() => vi.waitFor(assertion));

const startSource = Effect.fnUntraced(function* (
  initial: ReadsConfig | null,
  ports: Partial<SourcePorts>,
) {
  const scope = yield* Scope.fork(yield* Effect.scope, "sequential");
  const context = yield* Layer.buildWithScope(testSource({ ports }), scope);
  const reads: ZoteroReadsClient = yield* makeInProcessClient().pipe(
    Effect.provideContext(context),
    Scope.provide(scope),
  );
  const events: ChangeEvent[] = [];
  yield* Stream.runForEach(reads.Changes(), (event) =>
    Effect.sync(() => events.push(event)),
  ).pipe(Effect.ignore, Effect.forkIn(scope));
  yield* waitFor(() => expect(events).toHaveLength(1));
  if (initial) yield* reads.Configure(initial);
  const tags = () => events.slice(1).map((event) => event._tag);
  return {
    reads,
    events,
    tags,
    sawTags: (expected: ChangeEvent["_tag"][], start = 1) =>
      waitFor(() =>
        expect(events.slice(start).map((event) => event._tag)).toEqual(
          expected,
        ),
      ),
    idle: () =>
      waitFor(() => {
        const lane = events.filter((event) => event._tag === "refreshing");
        expect(lane.at(-1)).toEqual({ _tag: "refreshing", active: false });
      }),
    version: () =>
      Effect.map(
        reads.Libraries({}),
        (libraries) => libraries.find((l) => l.libraryID === 1)!.version,
      ),
    generation: Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* Connection;
        return connection.databaseGeneration(yield* connection.borrow);
      }),
    ).pipe(Effect.provideContext(context)),
    close: () => Scope.close(scope, Exit.void),
  };
});

const emitDirEvent = Effect.fnUntraced(function* (
  watchers: FakeWatcher[],
  filename: string,
) {
  const bound = watchers.filter((w) => w.path === dir && !w.closed).at(-1);
  expect(bound, "a bound directory watcher").toBeDefined();
  bound!.listener("change", filename);
  yield* waitFor(() => expect(bound!.pending()).toBe(0));
});

function holdRead(ports: ReturnType<typeof testPorts>["ports"]) {
  const held = Deferred.makeUnsafe<void>();
  ports.prepareRead.mockImplementationOnce((mode, path) =>
    Effect.andThen(Deferred.await(held), prepareRead(mode, path)),
  );
  return { release: () => Deferred.succeed(held, undefined) };
}

const tagsSince = (events: ChangeEvent[], start: number) =>
  events.slice(start).map((event) => event._tag);

const awaitFingerprint = (
  gate: Deferred.Deferred<SourceFingerprint>,
): Effect.Effect<SourceFingerprint, DbUnavailable> => Deferred.await(gate);

describe("ZoteroReads source", () => {
  it.effect("opens the configured read source at startup", () =>
    Effect.gen(function* () {
      const { ports } = testPorts();
      const source = yield* startSource(config(), ports);
      expect(yield* source.version()).toBe(1);
      yield* source.sawTags(["refreshing", "changed", "refreshing"]);
      expect(ports.prepareRead).toHaveBeenCalledExactlyOnceWith("copy", dbPath);
    }),
  );

  it.effect("opens the settings it starts with, before any Configure", () =>
    Effect.gen(function* () {
      const { ports } = testPorts();
      const version = yield* Effect.gen(function* () {
        const reads = yield* makeInProcessClient();
        return yield* reads.Libraries({});
      }).pipe(
        Effect.scoped,
        Effect.provide(testSource({ ports, initial: config() })),
      );
      expect(version.find((l) => l.libraryID === 1)?.version).toBe(1);
    }),
  );

  it.effect("waits for Configure before it opens anything", () =>
    Effect.gen(function* () {
      const { ports } = testPorts();
      const source = yield* startSource(null, ports);
      expect(ports.prepareRead).not.toHaveBeenCalled();
      expect(source.events).toEqual([
        { _tag: "state", state: "loading", error: null },
      ]);
      yield* source.reads.Configure(config());
      expect(yield* source.version()).toBe(1);
    }),
  );

  it.effect(
    "reads committed WAL rows in a copy and skips them in an immutable read",
    () =>
      Effect.gen(function* () {
        using live = new DatabaseSync(dbPath);
        live.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      update libraries set version = 2 where libraryID = 1;
    `);
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        expect(yield* source.version()).toBe(2);

        yield* source.reads.Configure(config({ readMode: "immutable" }));
        yield* source.reads.Refresh();
        expect(yield* source.version()).toBe(1);
      }),
  );

  it.effect(
    "names the effective Read Mode of each new connection on Changes",
    () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.idle();
        expect(
          source.events.filter((event) => event._tag === "changed"),
        ).toEqual([{ _tag: "changed", readMode: "copy" }]);

        yield* source.reads.Configure(config({ readMode: "immutable" }));
        yield* source.reads.Refresh();
        yield* waitFor(() =>
          expect(
            source.events.filter((event) => event._tag === "changed").at(-1),
          ).toEqual({ _tag: "changed", readMode: "immutable" }),
        );
        const seed = yield* Stream.runHead(source.reads.Changes()).pipe(
          Effect.map((option) => Option.getOrThrow(option)),
        );
        expect(seed).toEqual({
          _tag: "state",
          state: "ready",
          error: null,
          readMode: "immutable",
        });
      }),
  );

  it.effect(
    "settles degraded when the startup open fails, and Refresh fails while degraded",
    () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(
          config({ databasePath: join(dir, "absent", "zotero.sqlite") }),
          ports,
        );
        const error = yield* Effect.flip(source.reads.Libraries({}));
        expect(error).toMatchObject({ _tag: "DbUnavailable" });
        yield* source.sawTags([
          "refreshing",
          "refresh-failed",
          "db-file-missing",
          "degraded",
          "refreshing",
        ]);
        expect(yield* Effect.flip(source.reads.Refresh())).toMatchObject({
          _tag: "DbUnavailable",
        });
      }),
  );

  it.effect("leaves degraded once a refresh opens the source", () =>
    Effect.gen(function* () {
      const { ports } = testPorts();
      ports.prepareRead.mockImplementationOnce(() =>
        Effect.fail(new DbUnavailable({ message: "busy" })),
      );
      const source = yield* startSource(config(), ports);
      yield* Effect.ignore(source.reads.Libraries({}));
      yield* source.sawTags([
        "refreshing",
        "refresh-failed",
        "degraded",
        "refreshing",
      ]);

      yield* source.reads.NotifyExternalChange();
      yield* TestClock.adjust("2 seconds");
      yield* waitFor(() =>
        expect(source.tags().filter((tag) => tag === "changed")).toHaveLength(
          1,
        ),
      );
      expect(yield* source.version()).toBe(1);
    }),
  );

  it.effect(
    "keeps the active client when a refresh fails, and Refresh reports the failure",
    () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        expect(yield* source.version()).toBe(1);
        yield* source.idle();
        const before = source.events.length;

        writeLibrary(dbPath, 2);
        ports.prepareRead.mockImplementationOnce(() =>
          Effect.fail(new DbUnavailable({ message: "busy" })),
        );
        expect(yield* Effect.flip(source.reads.Refresh())).toMatchObject({
          _tag: "DbUnavailable",
          message: "busy",
        });

        expect(yield* source.version()).toBe(1);
        yield* source.sawTags(
          ["refreshing", "refresh-failed", "refreshing"],
          before,
        );
        expect(
          source.events.find((e) => e._tag === "refresh-failed"),
        ).toMatchObject({ moved: false });
      }),
  );

  it.effect(
    "keeps the active client when the new source is not a Zotero database",
    () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        expect(yield* source.version()).toBe(1);

        yield* Effect.promise(() => mkdir(join(dir, "other")));
        const other = join(dir, "other", "zotero.sqlite");
        new DatabaseSync(other).close();
        yield* source.reads.Configure(config({ databasePath: other }));
        yield* Effect.ignore(source.reads.Refresh());

        expect(yield* source.version()).toBe(1);
        yield* waitFor(() =>
          expect(
            source.events.find((e) => e._tag === "refresh-failed"),
          ).toHaveProperty(
            "error.message",
            expect.stringContaining("This file is not a Zotero database."),
          ),
        );
        expect(
          source.events.find((e) => e._tag === "refresh-failed"),
        ).toMatchObject({ moved: true });
      }),
  );

  it.effect(
    "refreshes when the read mode or database path changes, not on an auto-refresh change",
    () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        yield* Effect.promise(() => mkdir(join(dir, "next")));
        const next = join(dir, "next", "zotero.sqlite");
        writeLibrary(next, 3);
        const source = yield* startSource(config(), ports);
        yield* source.version();

        const immutable = config({ readMode: "immutable" });
        yield* source.reads.Configure(immutable);
        yield* waitFor(() =>
          expect(ports.prepareRead).toHaveBeenCalledTimes(2),
        );
        yield* source.reads.Configure({ ...immutable, databasePath: next });
        yield* waitFor(() =>
          expect(ports.prepareRead).toHaveBeenCalledTimes(3),
        );
        yield* source.reads.Configure({
          ...immutable,
          databasePath: next,
          autoRefresh: false,
        });
        yield* source.reads.Refresh();

        expect(ports.prepareRead.mock.calls.slice(0, 3)).toEqual([
          ["copy", dbPath],
          ["immutable", dbPath],
          ["immutable", next],
        ]);
        expect(yield* source.version()).toBe(3);
      }),
  );

  it.effect(
    "sweeps read snapshots beside each database path it binds, once each",
    () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        yield* Effect.promise(() => mkdir(join(dir, "next")));
        const next = join(dir, "next", "zotero.sqlite");
        writeLibrary(next, 3);
        const source = yield* startSource(config(), ports);
        yield* source.version();
        yield* source.reads.Refresh();
        expect(ports.reapReadClones).toHaveBeenCalledExactlyOnceWith({
          parent: join(dir, ZOTERO_DB_READ_PARENT_DIRNAME),
        });

        yield* source.reads.Configure(config({ databasePath: next }));
        yield* source.reads.Refresh();
        expect(ports.reapReadClones).toHaveBeenCalledTimes(2);
        expect(ports.reapReadClones).toHaveBeenLastCalledWith({
          parent: join(dir, "next", ZOTERO_DB_READ_PARENT_DIRNAME),
        });
      }),
  );

  it.effect("keeps refreshing active across coalesced trailing reruns", () =>
    Effect.gen(function* () {
      const { ports } = testPorts();
      const source = yield* startSource(config(), ports);
      yield* source.idle();
      const held = holdRead(ports);

      const before = source.events.length;
      const first = yield* Effect.forkChild(source.reads.Refresh(), {
        startImmediately: true,
      });
      yield* waitFor(() => expect(ports.prepareRead).toHaveBeenCalledTimes(2));
      const second = yield* Effect.forkChild(source.reads.Refresh(), {
        startImmediately: true,
      });
      yield* held.release();
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      expect(ports.prepareRead).toHaveBeenCalledTimes(3);
      yield* source.sawTags(
        ["refreshing", "changed", "changed", "refreshing"],
        before,
      );
    }),
  );

  it.effect(
    "coalesces an external change during the initial open into the same lane",
    () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const startup = holdRead(ports);
        const source = yield* startSource(config(), ports);
        yield* waitFor(() => expect(ports.prepareRead).toHaveBeenCalledOnce());

        yield* source.reads.NotifyExternalChange();
        yield* TestClock.adjust("2 seconds");

        yield* startup.release();
        yield* source.sawTags([
          "refreshing",
          "changed",
          "changed",
          "refreshing",
        ]);
        expect(ports.prepareRead).toHaveBeenCalledTimes(2);
        expect(yield* source.version()).toBe(1);
      }),
  );

  describe("refresh lane coalescing", () => {
    function holdFailure(
      ports: ReturnType<typeof testPorts>["ports"],
      message: string,
    ) {
      const held = Deferred.makeUnsafe<void>();
      ports.prepareRead.mockImplementationOnce(() =>
        Effect.andThen(
          Deferred.await(held),
          Effect.fail(new DbUnavailable({ message })),
        ),
      );
      return {
        release: () => Deferred.succeed(held, undefined),
      };
    }

    it.effect(
      "runs one trailing rerun for every request made during a refresh",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          const held = holdRead(ports);
          const before = source.events.length;

          const first = yield* Effect.forkChild(source.reads.Refresh(), {
            startImmediately: true,
          });
          yield* waitFor(() =>
            expect(ports.prepareRead).toHaveBeenCalledTimes(2),
          );
          const during = [
            yield* Effect.forkChild(source.reads.Refresh(), {
              startImmediately: true,
            }),
            yield* Effect.forkChild(source.reads.Refresh(), {
              startImmediately: true,
            }),
            yield* Effect.forkChild(source.reads.Refresh(), {
              startImmediately: true,
            }),
          ];
          yield* source.version();
          yield* held.release();
          yield* Effect.forEach([first, ...during], (fiber) =>
            Fiber.join(fiber),
          );
          yield* source.idle();

          expect(ports.prepareRead).toHaveBeenCalledTimes(3);
          yield* source.sawTags(
            ["refreshing", "changed", "changed", "refreshing"],
            before,
          );
        }),
    );

    it.effect("keeps the first caller waiting for the trailing rerun", () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.idle();
        const heldFirst = holdRead(ports);
        const heldTrailing = holdRead(ports);

        const first = yield* Effect.forkChild(source.reads.Refresh(), {
          startImmediately: true,
        });
        yield* waitFor(() =>
          expect(ports.prepareRead).toHaveBeenCalledTimes(2),
        );
        const second = yield* Effect.forkChild(source.reads.Refresh(), {
          startImmediately: true,
        });
        yield* source.version();
        yield* heldFirst.release();
        yield* waitFor(() =>
          expect(ports.prepareRead).toHaveBeenCalledTimes(3),
        );

        expect(first.pollUnsafe() !== undefined).toBe(false);
        expect(second.pollUnsafe() !== undefined).toBe(false);
        yield* heldTrailing.release();
        yield* Fiber.join(first);
        yield* Fiber.join(second);
      }),
    );

    it.effect(
      "settles every caller with the failure of the lane's last refresh",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          const held = holdFailure(ports, "first");
          ports.prepareRead.mockImplementationOnce(() =>
            Effect.fail(new DbUnavailable({ message: "trailing" })),
          );

          const first = yield* Effect.forkChild(
            Effect.flip(source.reads.Refresh()),
            { startImmediately: true },
          );
          yield* waitFor(() =>
            expect(ports.prepareRead).toHaveBeenCalledTimes(2),
          );
          const second = yield* Effect.forkChild(
            Effect.flip(source.reads.Refresh()),
            { startImmediately: true },
          );
          yield* source.version();
          yield* held.release();

          expect(
            yield* Effect.forEach([first, second], (fiber) =>
              Fiber.join(fiber),
            ),
          ).toMatchObject([
            { _tag: "DbUnavailable", message: "trailing" },
            { _tag: "DbUnavailable", message: "trailing" },
          ]);
          expect(ports.prepareRead).toHaveBeenCalledTimes(3);
        }),
    );

    it.effect(
      "settles every caller successfully when the trailing rerun recovers",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          const held = holdFailure(ports, "first");

          const first = yield* Effect.forkChild(source.reads.Refresh(), {
            startImmediately: true,
          });
          yield* waitFor(() =>
            expect(ports.prepareRead).toHaveBeenCalledTimes(2),
          );
          const second = yield* Effect.forkChild(source.reads.Refresh(), {
            startImmediately: true,
          });
          yield* source.version();
          yield* held.release();

          yield* Fiber.join(first);
          yield* Fiber.join(second);
          expect(ports.prepareRead).toHaveBeenCalledTimes(3);
        }),
    );

    it.effect(
      "gives a push that arrives during a refresh its trailing read even when the source is unchanged",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          const held = holdRead(ports);

          const refresh = yield* Effect.forkChild(source.reads.Refresh(), {
            startImmediately: true,
          });
          yield* waitFor(() =>
            expect(ports.prepareRead).toHaveBeenCalledTimes(2),
          );
          yield* source.reads.NotifyExternalChange();
          yield* TestClock.adjust("2 seconds");
          yield* source.version();
          yield* held.release();
          yield* Fiber.join(refresh);
          yield* source.idle();

          expect(ports.prepareRead).toHaveBeenCalledTimes(3);
        }),
    );
  });

  it.effect(
    "hands a borrower the newest client while an unread one is released",
    () =>
      Effect.gen(function* () {
        const { ports, releaseGate } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.version();
        yield* source.reads.Refresh();

        const gate = {
          entered: Deferred.makeUnsafe<void>(),
          release: Deferred.makeUnsafe<void>(),
        };
        yield* Ref.set(releaseGate, gate);
        writeLibrary(dbPath, 3);
        const refresh = yield* Effect.forkChild(source.reads.Refresh(), {
          startImmediately: true,
        });
        yield* Deferred.await(gate.entered);
        expect(yield* source.version()).toBe(3);
        yield* Deferred.succeed(gate.release, undefined);
        yield* Fiber.join(refresh);

        expect(yield* source.version()).toBe(3);
      }),
  );

  describe("databaseGeneration", () => {
    it.effect(
      "keeps the generation when a refresh reopens the same database",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          expect(yield* source.generation).toBe(1);
          writeLibrary(dbPath, 2);
          yield* source.reads.Refresh();
          expect(yield* source.version()).toBe(2);
          expect(yield* source.generation).toBe(1);
        }),
    );

    it.effect(
      "gives a higher generation after a Configure to another database file",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          yield* Effect.promise(() => mkdir(join(dir, "next")));
          const next = join(dir, "next", "zotero.sqlite");
          writeLibrary(next, 3);
          const source = yield* startSource(config(), ports);
          const before = yield* source.generation;
          yield* source.reads.Configure(config({ databasePath: next }));
          yield* source.reads.Refresh();
          expect(yield* source.version()).toBe(3);
          expect(yield* source.generation).toBeGreaterThan(before);
        }),
    );

    it.effect(
      "gives a higher generation to another database at the same path",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          const before = yield* source.generation;
          {
            using sqlite = new DatabaseSync(dbPath);
            sqlite.exec(
              "insert into settings (setting, key, value) values ('account', 'localUserKey', 'OTHERDB');",
            );
          }
          writeLibrary(dbPath, 2);
          yield* source.reads.Refresh();
          expect(yield* source.version()).toBe(2);
          expect(yield* source.generation).toBeGreaterThan(before);
        }),
    );
  });

  describe("watch start", () => {
    it.effect.each(["fail", "die"] as const)(
      "serves and closes the watches it bound when the database watch cannot start: %s",
      (how) =>
        Effect.gen(function* () {
          unwatchable.set(dbPath, how);
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);

          expect(yield* source.version()).toBe(1);
          expect(watchers.map((w) => [w.path, w.closed])).toEqual([
            [dir, true],
          ]);
          writeLibrary(dbPath, 2);
          yield* source.reads.Refresh();
          expect(yield* source.version()).toBe(2);
        }),
    );
  });

  describe("watch start interrupted", () => {
    it.effect.each(["zotero.sqlite", "zotero.sqlite-wal"])(
      "closes a %s watch still starting when the source closes",
      (filename) =>
        Effect.gen(function* () {
          const path = join(dir, filename);
          if (filename === "zotero.sqlite-wal")
            yield* Effect.promise(() => writeFile(path, ""));
          unwatchable.set(path, "hang");
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* waitFor(() =>
            expect(watchers.map((w) => w.path)).toContain(path),
          );

          yield* source.close();

          expect(watchers.map((w) => [w.path, w.closed])).toEqual(
            watchers.map((w) => [w.path, true]),
          );
        }),
    );
  });

  describe("WAL watch start overlapping", () => {
    it.effect(
      "keeps one WAL watch when a WAL event arrives while the lane starts it",
      () =>
        Effect.gen(function* () {
          const walPath = join(dir, "zotero.sqlite-wal");
          yield* Effect.promise(() => writeFile(walPath, ""));
          unwatchable.set(walPath, "hang");
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* waitFor(() =>
            expect(watchers.map((w) => w.path)).toContain(walPath),
          );

          using debounce = vi.spyOn(yield* Clock.Clock, "sleep");
          yield* emitDirEvent(watchers, "zotero.sqlite-wal");
          yield* Deferred.succeed(hungStarts, undefined);
          yield* source.version();
          yield* waitFor(() => expect(debounce).toHaveBeenCalled());
          yield* TestClock.adjust("2 seconds");
          yield* waitFor(() =>
            expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
          );

          expect(
            watchers.filter((w) => w.path === walPath && !w.closed),
          ).toHaveLength(1);
          yield* source.close();
          expect(watchers.map((w) => [w.path, w.closed])).toEqual(
            watchers.map((w) => [w.path, true]),
          );
        }),
    );
  });

  describe("watcher self-echo gate", () => {
    it.effect(
      "ignores a watcher tick when the source is unchanged since the last read",
      () =>
        Effect.gen(function* () {
          const { ports, watchers } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.version();

          yield* emitDirEvent(watchers, "zotero.sqlite");
          yield* emitDirEvent(watchers, "zotero.sqlite-wal");
          yield* TestClock.adjust("2 seconds");
          yield* waitFor(() =>
            expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
          );
          yield* source.version();

          expect(ports.prepareRead).toHaveBeenCalledOnce();
        }),
    );

    it.effect(
      "refreshes when the watcher tick follows a real Zotero write",
      () =>
        Effect.gen(function* () {
          const { ports, watchers } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.version();

          writeLibrary(dbPath, 2);
          yield* emitDirEvent(watchers, "zotero.sqlite");
          yield* TestClock.adjust("2 seconds");

          yield* waitFor(() =>
            expect(
              source.tags().filter((tag) => tag === "changed"),
            ).toHaveLength(2),
          );
          expect(yield* source.version()).toBe(2);
        }),
    );

    it.effect(
      "refreshes an immutable read when the source fingerprint is unchanged",
      () =>
        Effect.gen(function* () {
          const { ports, watchers } = testPorts();
          const source = yield* startSource(
            config({ readMode: "immutable" }),
            ports,
          );
          yield* source.version();

          yield* emitDirEvent(watchers, "zotero.sqlite");
          yield* TestClock.adjust("2 seconds");

          yield* waitFor(() =>
            expect(ports.prepareRead).toHaveBeenCalledTimes(2),
          );
        }),
    );

    it.effect(
      "keeps an immutable watcher tick cancelled when auto-refresh is off",
      () =>
        Effect.gen(function* () {
          const { ports, watchers } = testPorts();
          const immutable = config({ readMode: "immutable" });
          const source = yield* startSource(immutable, ports);
          yield* source.version();

          yield* emitDirEvent(watchers, "zotero.sqlite");
          yield* source.reads.Configure({ ...immutable, autoRefresh: false });
          yield* TestClock.adjust("2 seconds");
          yield* source.version();

          expect(ports.prepareRead).toHaveBeenCalledOnce();
        }),
    );

    it.effect(
      "retains the snapshot on an unchanged push, while manual refresh still reopens it",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          const before = source.events.length;

          yield* source.reads.NotifyExternalChange();
          yield* TestClock.adjust("2 seconds");
          yield* source.sawTags(["refreshing", "refreshing"], before);

          expect(ports.prepareRead).toHaveBeenCalledOnce();
          expect(ports.snapshotSource).toHaveBeenCalledTimes(2);
          expect(yield* source.version()).toBe(1);

          yield* source.reads.Refresh();
          expect(ports.prepareRead).toHaveBeenCalledTimes(2);
        }),
    );

    it.effect(
      "refreshes a changed push using one pre-read source fingerprint",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          writeLibrary(dbPath, 2);
          const before = source.events.length;

          yield* source.reads.NotifyExternalChange();
          yield* TestClock.adjust("2 seconds");
          yield* source.sawTags(
            ["refreshing", "changed", "refreshing"],
            before,
          );

          expect(yield* source.version()).toBe(2);
          expect(ports.snapshotSource).toHaveBeenCalledTimes(2);
          expect(ports.prepareRead).toHaveBeenCalledTimes(2);
        }),
    );

    it.effect(
      "retries an unchanged push after a failed refresh with held reads",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          ports.prepareRead.mockImplementationOnce(() =>
            Effect.fail(new DbUnavailable({ message: "busy" })),
          );
          yield* Effect.flip(source.reads.Refresh());
          yield* source.idle();
          const before = source.events.length;

          yield* source.reads.NotifyExternalChange();
          yield* TestClock.adjust("2 seconds");
          yield* source.sawTags(
            ["refreshing", "changed", "refreshing"],
            before,
          );

          expect(ports.prepareRead).toHaveBeenCalledTimes(3);
          expect(yield* source.version()).toBe(1);
        }),
    );

    it.effect.each(["unreadable", "unstable"] as const)(
      "refreshes a push when its fingerprint is %s",
      (observation) =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          const before = source.events.length;
          if (observation === "unreadable") {
            ports.snapshotSource.mockImplementationOnce(() =>
              Effect.fail(new DbUnavailable({ message: "EIO" })),
            );
          } else {
            ports.snapshotSource.mockImplementationOnce((path) =>
              Effect.map(snapshotSource(path), (fingerprint) => ({
                ...fingerprint,
                wal: { state: "unstable" },
              })),
            );
          }

          yield* source.reads.NotifyExternalChange();
          yield* TestClock.adjust("2 seconds");
          yield* source.sawTags(
            ["refreshing", "changed", "refreshing"],
            before,
          );

          expect(ports.prepareRead).toHaveBeenCalledTimes(2);
          expect(yield* source.version()).toBe(1);
        }),
    );

    it.effect(
      "keeps an unchanged trusted signal in Immutable Source mode",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(
            config({ readMode: "immutable" }),
            ports,
          );
          yield* source.idle();
          const before = source.events.length;

          yield* source.reads.NotifyExternalChange();
          yield* TestClock.adjust("2 seconds");
          yield* source.sawTags(
            ["refreshing", "changed", "refreshing"],
            before,
          );

          expect(ports.prepareRead).toHaveBeenCalledTimes(2);
        }),
    );

    it.effect(
      "preserves manual force queued during a trusted fingerprint read",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          const fingerprint = yield* snapshotSource(dbPath);
          const gate = Deferred.makeUnsafe<SourceFingerprint, never>();
          yield* Effect.addFinalizer(() => Deferred.succeed(gate, fingerprint));
          ports.snapshotSource.mockImplementationOnce(() =>
            awaitFingerprint(gate),
          );
          const before = source.events.length;

          yield* source.reads.NotifyExternalChange();
          yield* TestClock.adjust("2 seconds");
          yield* waitFor(() =>
            expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
          );
          const forced = yield* Effect.forkChild(source.reads.Refresh(), {
            startImmediately: true,
          });
          yield* source.version();
          yield* Deferred.succeed(gate, fingerprint);
          yield* Fiber.join(forced);

          yield* source.sawTags(
            ["refreshing", "changed", "changed", "refreshing"],
            before,
          );
          expect(ports.prepareRead).toHaveBeenCalledTimes(3);
        }),
    );

    it.effect(
      "refreshes the new configuration when it changes during a trusted fingerprint read",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.idle();
          const next = join(dir, "next.sqlite");
          writeLibrary(next, 3);
          const fingerprint = yield* snapshotSource(dbPath);
          const gate = Deferred.makeUnsafe<SourceFingerprint, never>();
          yield* Effect.addFinalizer(() => Deferred.succeed(gate, fingerprint));
          ports.snapshotSource.mockImplementationOnce(() =>
            awaitFingerprint(gate),
          );
          const before = source.events.length;

          yield* source.reads.NotifyExternalChange();
          yield* TestClock.adjust("2 seconds");
          yield* waitFor(() =>
            expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
          );
          yield* source.reads.Configure(config({ databasePath: next }));
          yield* Deferred.succeed(gate, fingerprint);

          yield* source.sawTags(
            ["refreshing", "changed", "changed", "refreshing"],
            before,
          );
          expect(yield* source.version()).toBe(3);
        }),
    );

    it.effect("refreshes when the source fingerprint cannot be read", () =>
      Effect.gen(function* () {
        const { ports, watchers } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.version();

        ports.snapshotSource.mockImplementationOnce(() =>
          Effect.fail(new DbUnavailable({ message: "EIO" })),
        );
        yield* emitDirEvent(watchers, "zotero.sqlite");
        yield* TestClock.adjust("2 seconds");

        yield* waitFor(() =>
          expect(ports.prepareRead).toHaveBeenCalledTimes(2),
        );
      }),
    );

    it.effect(
      "keeps a watcher tick armed across the rebind that follows a refresh",
      () =>
        Effect.gen(function* () {
          const { ports, watchers } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.version();

          const held = holdRead(ports);
          const refresh = yield* Effect.forkChild(source.reads.Refresh(), {
            startImmediately: true,
          });
          yield* waitFor(() =>
            expect(ports.prepareRead).toHaveBeenCalledTimes(2),
          );

          yield* emitDirEvent(watchers, "zotero.sqlite");
          yield* held.release();
          yield* Fiber.join(refresh);
          writeLibrary(dbPath, 2);

          yield* TestClock.adjust("2 seconds");
          yield* waitFor(() =>
            expect(
              source.tags().filter((tag) => tag === "changed"),
            ).toHaveLength(3),
          );
          expect(yield* source.version()).toBe(2);
        }),
    );

    it.effect("gates the next tick again once a trusted burst has fired", () =>
      Effect.gen(function* () {
        const { ports, watchers } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.idle();

        writeLibrary(dbPath, 2);
        const before = source.events.length;
        yield* source.reads.NotifyExternalChange();
        yield* TestClock.adjust("2 seconds");
        yield* source.sawTags(["refreshing", "changed", "refreshing"], before);

        yield* emitDirEvent(watchers, "zotero.sqlite");
        yield* TestClock.adjust("2 seconds");
        yield* waitFor(() =>
          expect(ports.snapshotSource).toHaveBeenCalledTimes(3),
        );
        yield* source.version();

        expect(ports.prepareRead).toHaveBeenCalledTimes(2);
      }),
    );

    it.effect("keeps a pending push when auto-refresh is switched off", () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.version();

        writeLibrary(dbPath, 2);
        yield* source.reads.NotifyExternalChange();
        yield* source.reads.Configure(config({ autoRefresh: false }));
        yield* TestClock.adjust("2 seconds");

        yield* waitFor(() =>
          expect(ports.prepareRead).toHaveBeenCalledTimes(2),
        );
      }),
    );

    it.effect(
      "cancels an untrusted tick when auto-refresh is switched off",
      () =>
        Effect.gen(function* () {
          const { ports, watchers } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.version();

          writeLibrary(dbPath, 2);
          yield* emitDirEvent(watchers, "zotero.sqlite");
          yield* source.reads.Configure(config({ autoRefresh: false }));
          yield* TestClock.adjust("2 seconds");
          yield* source.version();

          expect(ports.prepareRead).toHaveBeenCalledOnce();
          expect(watchers.every((w) => w.closed)).toBe(true);
        }),
    );

    it.effect(
      "drops a tick that outlives the auto-refresh switch inside the gate",
      () =>
        Effect.gen(function* () {
          const { ports, watchers } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.version();

          const gate = Deferred.makeUnsafe<SourceFingerprint, never>();
          ports.snapshotSource.mockImplementationOnce(() =>
            awaitFingerprint(gate),
          );
          writeLibrary(dbPath, 2);
          yield* emitDirEvent(watchers, "zotero.sqlite");
          yield* TestClock.adjust("2 seconds");
          yield* waitFor(() =>
            expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
          );

          yield* source.reads.Configure(config({ autoRefresh: false }));
          yield* Deferred.succeed(gate, yield* snapshotSource(dbPath));
          yield* source.version();

          expect(ports.prepareRead).toHaveBeenCalledOnce();
        }),
    );
  });

  describe("lifetime guards", () => {
    it.effect("drops a tick whose gate check outlives teardown", () =>
      Effect.gen(function* () {
        const { ports, watchers } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.version();

        const gate = Deferred.makeUnsafe<SourceFingerprint, never>();
        ports.snapshotSource.mockImplementationOnce(() =>
          awaitFingerprint(gate),
        );
        writeLibrary(dbPath, 2);
        yield* emitDirEvent(watchers, "zotero.sqlite");
        yield* TestClock.adjust("2 seconds");
        yield* waitFor(() =>
          expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
        );

        yield* source.close();
        yield* Deferred.succeed(gate, yield* snapshotSource(dbPath));

        expect(ports.prepareRead).toHaveBeenCalledOnce();
      }),
    );

    it.effect(
      "releases a read that lands after teardown and opens nothing on it",
      () =>
        Effect.gen(function* () {
          const { ports, watchers } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.version();
          const boundAtStartup = watchers.length;

          const acquired = Deferred.makeUnsafe<PreparedRead>();
          const late = Deferred.makeUnsafe<void>();
          ports.prepareRead.mockImplementationOnce((mode, path) =>
            Effect.gen(function* () {
              const read = yield* prepareRead(mode, path);
              yield* Deferred.succeed(acquired, read);
              yield* Deferred.await(late);
              return read;
            }),
          );
          yield* source.idle();
          const before = source.events.length;
          yield* Effect.forkScoped(source.reads.Refresh());
          yield* waitFor(() =>
            expect(ports.prepareRead).toHaveBeenCalledTimes(2),
          );
          yield* source.close();

          const read = yield* Deferred.await(acquired);
          yield* Deferred.succeed(late, undefined);
          yield* Effect.promise(() =>
            expect(readdir(dirname(read.path))).rejects.toMatchObject({
              code: "ENOENT",
            }),
          );

          expect(watchers).toHaveLength(boundAtStartup);
          expect(watchers.every((w) => w.closed)).toBe(true);
          expect(tagsSince(source.events, before)).not.toContain("changed");
        }),
    );

    it.effect("reports nothing when a read fails after teardown", () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.version();

        const late = Deferred.makeUnsafe<PreparedRead, DbUnavailable>();
        ports.prepareRead.mockImplementationOnce(() => Deferred.await(late));
        yield* source.idle();
        const before = source.events.length;
        yield* Effect.forkScoped(source.reads.Refresh());
        yield* waitFor(() =>
          expect(ports.prepareRead).toHaveBeenCalledTimes(2),
        );
        yield* source.close();
        yield* Deferred.fail(late, new DbUnavailable({ message: "gone" }));

        const tags = tagsSince(source.events, before);
        expect(tags).not.toContain("refresh-failed");
        expect(tags).not.toContain("degraded");
      }),
    );

    it.effect(
      "leaves nothing open when teardown lands while the old read is released",
      () =>
        Effect.gen(function* () {
          const { ports, watchers, reads, releases, releaseGate } = testPorts();
          const source = yield* startSource(config(), ports);
          yield* source.version();

          const gate = {
            entered: Deferred.makeUnsafe<void>(),
            release: Deferred.makeUnsafe<void>(),
          };
          yield* Ref.set(releaseGate, gate);
          yield* Effect.forkScoped(source.reads.Refresh());
          yield* Deferred.await(gate.entered);
          const closing = yield* Effect.forkChild(source.close(), {
            startImmediately: true,
          });
          yield* Deferred.succeed(gate.release, undefined);
          yield* Fiber.join(closing);

          expect(releases).toHaveLength(2);
          expect(releases).toEqual(expect.arrayContaining(reads));
          expect(watchers.every((w) => w.closed)).toBe(true);
        }),
    );

    it.effect("closes every client and releases every read on teardown", () =>
      Effect.gen(function* () {
        const { ports, reads, releases } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.version();
        yield* source.reads.Refresh();
        expect(reads).toHaveLength(2);
        yield* source.close();
        expect(releases).toEqual(reads);
      }),
    );
  });

  describe("db-file-missing signal", () => {
    const missing = () => join(dir, "absent", "zotero.sqlite");

    it.effect("emits once when the database file is absent", () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(
          config({ databasePath: missing() }),
          ports,
        );
        yield* source.sawTags([
          "refreshing",
          "refresh-failed",
          "db-file-missing",
          "degraded",
          "refreshing",
        ]);
      }),
    );

    it.effect(
      "reaches a subscriber that arrives after the first open failed",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const seed = yield* Effect.gen(function* () {
            const reads = yield* makeInProcessClient();
            yield* Effect.flip(reads.Libraries({}));
            const pull = yield* Stream.toPull(reads.Changes());
            return yield* pull;
          }).pipe(
            Effect.scoped,
            Effect.provide(
              testSource({
                ports,
                initial: config({ databasePath: missing() }),
              }),
            ),
          );
          expect(seed.map((event) => event._tag)).toEqual([
            "state",
            "db-file-missing",
          ]);
        }),
    );

    it.effect(
      "does not emit a second time on a later failure in the same lifetime",
      () =>
        Effect.gen(function* () {
          const { ports } = testPorts();
          const source = yield* startSource(
            config({ databasePath: missing() }),
            ports,
          );
          yield* source.idle();
          const before = source.events.length;
          yield* Effect.ignore(source.reads.Refresh());
          yield* source.sawTags(
            ["refreshing", "refresh-failed", "degraded", "refreshing"],
            before,
          );
        }),
    );

    it.effect("does not emit when the file exists but cannot be read", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeFile(dbPath, "not a database"));
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.sawTags([
          "refreshing",
          "refresh-failed",
          "degraded",
          "refreshing",
        ]);
      }),
    );

    it.effect("emits nothing on a healthy open", () =>
      Effect.gen(function* () {
        const { ports } = testPorts();
        const source = yield* startSource(config(), ports);
        yield* source.sawTags(["refreshing", "changed", "refreshing"]);
      }),
    );
  });
});
