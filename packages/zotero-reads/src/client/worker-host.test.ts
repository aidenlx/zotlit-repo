import type { EffectiveReadMode } from "#contract/rpc.ts";
import type { ZoteroReadsClient } from "#contract/rpc.ts";
import type { ChangeEvent, FileReadsConfig } from "#contract/rpc.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  Option,
  Queue,
  References,
  Scope,
  Stream,
} from "effect";
import type { Duration } from "effect";
import { TestClock } from "effect/testing";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { createFixtureSchema } from "@zotlit/db-testing";
import { createClient } from "@zotlit/db/client/node";
import { LogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { subscribe } from "@zotlit/plugin-kernel/effect-stream.ts";

import * as readsEvents from "./events.ts";
import { connectWorker, makeWorkerReads } from "./worker-host.ts";
import type { ReapWorkerSnapshots } from "./worker-host.ts";
import type { WorkerConnection } from "./worker-host.ts";

import { readsFixture } from "#__fixtures__/reads.ts";
import { DbUnavailable } from "#contract/rpc.ts";
import { WORKER_CLOSED } from "#contract/worker-signal.ts";
import { nodeClient } from "#desktop/node-client.ts";
import { snapshotRevision } from "#desktop/snapshot-revision.ts";
import { layerRcRef } from "#worker/connection.ts";
import { makeInProcessClient } from "#worker/in-process.ts";

function fakeWorkers(
  options: {
    failStart?: (n: number) => boolean;
    hangStart?: (n: number) => boolean;
    readMode?: (n: number) => EffectiveReadMode;
    unanswered?: (n: number) => number;
    closeWait?: (n: number) => Duration.Input | undefined;
    changes?: Stream.Stream<ChangeEvent>;
    unansweredRequests?: readonly (
      | "Configure"
      | "Libraries"
      | "Snapshot"
      | "Refresh"
    )[];
  } = {},
) {
  let spawned = 0;
  const deaths = new Map<number, Deferred.Deferred<DbUnavailable>>();
  const cuts = new Map<number, Deferred.Deferred<void, Error>>();
  const ended = new Set<number>();
  const abandoned = new Set<number>();
  const connect: Effect.Effect<WorkerConnection, DbUnavailable, Scope.Scope> =
    Effect.gen(function* () {
      const n = ++spawned;
      const closing = yield* Deferred.make<void>();
      yield* Effect.addFinalizer(() => {
        Deferred.doneUnsafe(closing, Exit.void);
        const wait = abandoned.has(n) ? undefined : options.closeWait?.(n);
        return Effect.andThen(
          wait === undefined ? Effect.void : Effect.sleep(wait),
          Effect.sync(() => ended.add(n)),
        );
      });
      if (options.failStart?.(n)) {
        return yield* new DbUnavailable({
          message: `worker #${n} did not start`,
        });
      }
      if (options.hangStart?.(n)) return yield* Effect.never;
      const context = yield* Layer.build(
        layerRcRef(() => {
          const client = createClient(":memory:");
          createFixtureSchema(client.$client);
          client.$client.exec(
            `insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', ${n}, 0)`,
          );
          return nodeClient(client);
        }),
      );
      const served = yield* makeInProcessClient({ snapshotRevision }).pipe(
        Effect.provideContext(context),
        Effect.provide(NodeFileSystem.layer),
      );
      const mode = options.readMode?.(n);
      const answering: ZoteroReadsClient = mode
        ? {
            ...served,
            Changes: ((...args: Parameters<typeof served.Changes>) =>
              Stream.map(
                served.Changes(...args) as Stream.Stream<ChangeEvent, unknown>,
                (event) =>
                  event._tag === "changed" ||
                  (event._tag === "state" && event.state === "ready")
                    ? { ...event, readMode: mode }
                    : event,
              )) as typeof served.Changes,
          }
        : served;
      const cut = yield* Deferred.make<void, Error>();
      cuts.set(n, cut);
      let missed = 0;
      const client: ZoteroReadsClient = {
        ...answering,
        Changes: ((...args: Parameters<typeof answering.Changes>) =>
          Stream.interruptWhen(
            options.changes ??
              (answering.Changes(...args) as Stream.Stream<
                ChangeEvent,
                unknown
              >),
            Deferred.await(cut),
          )) as typeof answering.Changes,
        Ping: (...args: Parameters<typeof answering.Ping>) =>
          missed++ < (options.unanswered?.(n) ?? 0)
            ? Effect.never
            : answering.Ping(...args),
        ...(options.unansweredRequests?.includes("Configure") && {
          Configure: () => Effect.never,
        }),
        ...(options.unansweredRequests?.includes("Libraries") && {
          Libraries: () => Effect.never,
        }),
        ...(options.unansweredRequests?.includes("Snapshot") && {
          Snapshot: (() =>
            Stream.fromEffect(
              Effect.andThen(Deferred.await(closing), Effect.interrupt),
            )) as unknown as typeof answering.Snapshot,
        }),
        ...(options.unansweredRequests?.includes("Refresh") && {
          Refresh: () =>
            Effect.andThen(Deferred.await(closing), Effect.interrupt),
        }),
      };
      const died = yield* Deferred.make<DbUnavailable>();
      deaths.set(n, died);
      return {
        client,
        died: Deferred.await(died),
        abandon: Effect.sync(() => abandoned.add(n)),
      };
    });
  return {
    connect,
    spawned: () => spawned,
    cut: (n: number, how: "fails" | "ends") =>
      how === "fails"
        ? Deferred.fail(cuts.get(n)!, new Error(`worker #${n} port closed`))
        : Deferred.succeed(cuts.get(n)!, undefined),
    abandoned: (n: number) => abandoned.has(n),
    kill: (n: number) =>
      Deferred.succeed(
        deaths.get(n)!,
        new DbUnavailable({ message: `worker #${n} crashed` }),
      ),
    ended: (n: number) => ended.has(n),
  };
}

const workerSeen = (reads: Pick<ZoteroReadsClient, "Libraries">) =>
  Effect.map(
    reads.Libraries({}),
    (libraries) => libraries.find((l) => l.libraryID === 1)!.version,
  );

const until = Effect.fnUntraced(function* (
  pull: Effect.Effect<readonly ChangeEvent[], unknown>,
  tag: ChangeEvent["_tag"],
) {
  const seen: ChangeEvent[] = [];
  while (!seen.some((event) => event._tag === tag)) {
    seen.push(...(yield* Effect.orDie(pull)));
  }
  return seen;
});

describe("ZoteroReads worker adapter", () => {
  it.effect("serves reads from the worker it spawned on creation", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers();
      const seen = yield* Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        return yield* workerSeen(reads);
      }).pipe(Effect.scoped);
      expect(seen).toBe(1);
      expect(workers.spawned()).toBe(1);
    }),
  );

  it.effect(
    "settles a Configure and a read in flight when their worker stops",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({
          unansweredRequests: ["Configure", "Libraries"],
        });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          const configure = yield* Effect.forkChild(
            Effect.flip(reads.Configure({} as FileReadsConfig)),
            { startImmediately: true },
          );
          const read = yield* Effect.forkChild(
            Effect.flip(reads.Libraries({})),
            { startImmediately: true },
          );
          yield* Effect.yieldNow;
          yield* workers.kill(1);
          return {
            configure: yield* Fiber.join(configure),
            read: yield* Fiber.join(read),
          };
        }).pipe(Effect.scoped, Effect.timeout("1 second"));
        expect(result.configure).toMatchObject({
          _tag: "RpcClientError",
          reason: {
            cause: { _tag: "DbUnavailable", message: "worker #1 crashed" },
          },
        });
        expect(result.read).toMatchObject({
          _tag: "DbUnavailable",
          message: "worker #1 crashed",
        });
      }),
  );

  it.effect(
    "fails a stream read and a Refresh in flight with DbUnavailable when their worker stops",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({
          unansweredRequests: ["Snapshot", "Refresh"],
        });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          const snapshot = yield* Effect.forkChild(
            Effect.flip(Stream.runDrain(reads.Snapshot())),
            { startImmediately: true },
          );
          const refresh = yield* Effect.forkChild(
            Effect.flip(reads.Refresh()),
            {
              startImmediately: true,
            },
          );
          yield* Effect.yieldNow;
          yield* workers.kill(1);
          return {
            snapshot: yield* Fiber.join(snapshot),
            refresh: yield* Fiber.join(refresh),
          };
        }).pipe(Effect.scoped, Effect.timeout("1 second"));
        const stop = { _tag: "DbUnavailable", message: "worker #1 crashed" };
        expect(result.snapshot).toMatchObject(stop);
        expect(result.refresh).toMatchObject(stop);
      }),
  );

  it.effect(
    "a worker error moves the client to degraded with a tagged error and ends that worker",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.kill(1);
          const events = yield* until(changes, "degraded");
          const read = yield* Effect.flip(reads.Libraries({}));
          return { events, read, ended: workers.ended(1) };
        }).pipe(Effect.scoped);
        expect(result.events.at(-1)).toMatchObject({
          _tag: "degraded",
          error: { _tag: "DbUnavailable", message: "worker #1 crashed" },
        });
        expect(result.read).toMatchObject({
          _tag: "DbUnavailable",
          message: "worker #1 crashed",
        });
        expect(result.ended).toBe(true);
      }),
  );

  it.effect(
    "seeds only the current worker crash after a missing database recovers",
    () =>
      Effect.gen(function* () {
        const feed = yield* Queue.unbounded<ChangeEvent>();
        const workers = fakeWorkers({ changes: Stream.fromQueue(feed) });
        const reads = yield* makeWorkerReads(workers.connect);
        const live = yield* Stream.toPull(reads.Changes());

        yield* Queue.offer(feed, { _tag: "db-file-missing" });
        yield* until(live, "db-file-missing");
        yield* Queue.offer(feed, { _tag: "changed" });
        yield* until(live, "changed");
        yield* workers.kill(1);
        yield* until(live, "degraded");

        const late = yield* Stream.toPull(reads.Changes());
        expect(yield* late).toEqual([
          {
            _tag: "state",
            state: "degraded",
            error: expect.objectContaining({ message: "worker #1 crashed" }),
          },
        ]);
      }),
  );

  it.effect.each([
    { _tag: "changed" },
    { _tag: "state", state: "ready", error: null },
  ] satisfies ChangeEvent[])(
    "emits a new missing database event after a $_tag recovery",
    (ready) =>
      Effect.gen(function* () {
        const feed = yield* Queue.unbounded<ChangeEvent>();
        const workers = fakeWorkers({ changes: Stream.fromQueue(feed) });
        const reads = yield* makeWorkerReads(workers.connect);
        const live = yield* Stream.toPull(reads.Changes());

        yield* Queue.offer(feed, { _tag: "db-file-missing" });
        yield* until(live, "db-file-missing");
        yield* Queue.offer(feed, ready);
        yield* until(live, "changed");

        yield* Queue.offer(feed, { _tag: "db-file-missing" });
        yield* Queue.offer(feed, { _tag: "refreshing", active: false });
        const events = yield* until(live, "refreshing");
        expect(events.map((event) => event._tag)).toEqual([
          "db-file-missing",
          "refreshing",
        ]);
      }),
  );

  it.effect(
    "answers a stream read asked as a queue from the live worker, and fails it while no worker serves",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          const snapshots = yield* reads.Snapshot(undefined, { asQueue: true });
          const snapshot = yield* Queue.take(snapshots);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.kill(1);
          yield* until(changes, "degraded");
          const failed = yield* Effect.flip(
            reads.Snapshot(undefined, { asQueue: true }),
          );
          return { snapshot, failed };
        }).pipe(Effect.scoped);
        expect(result.snapshot).toEqual(expect.any(String));
        expect(result.failed).toMatchObject({
          _tag: "DbUnavailable",
          message: "worker #1 crashed",
        });
      }),
  );

  it.effect(
    "Refresh after a worker death spawns a new worker that serves",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.kill(1);
          yield* until(changes, "degraded");

          yield* reads.Refresh();
          const recovered = yield* until(changes, "changed");
          return {
            recovered: recovered.at(-1),
            seen: yield* workerSeen(reads),
          };
        }).pipe(Effect.scoped);
        expect(workers.spawned()).toBe(2);
        expect(result.recovered).toEqual({ _tag: "changed" });
        expect(result.seen).toBe(2);
      }),
  );

  it.effect(
    "Configure after a worker death reconnects before applying the source",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const seen = yield* Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* makeWorkerReads(workers.connect);
            yield* workerSeen(reads);
            const changes = yield* Stream.toPull(reads.Changes());
            yield* workers.kill(1);
            yield* until(changes, "degraded");
            yield* reads.Configure({
              databasePath: "/new/zotero.sqlite",
              readMode: "copy",
              autoRefresh: false,
              locale: null,
              chineseSegmenter: null,
              logLevel: null,
            });
            yield* reads.Refresh();
            return yield* workerSeen(reads);
          }),
        );
        expect(seen).toBe(2);
      }),
  );

  it.effect(
    "rejects an old Snapshot after another worker opens a Snapshot",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const { service } = yield* readsFixture(
          makeWorkerReads(workers.connect),
        );
        const oldLease = yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => await service.acquireRead()),
        );
        expect(yield* workerSeen(oldLease.reads)).toBe(1);

        const degraded = Promise.withResolvers<void>();
        const off = subscribe(
          service.runtime,
          readsEvents.degraded(service),
          () => degraded.resolve(),
        );
        yield* workers.kill(1);
        yield* Effect.promise(() => degraded.promise);
        off();
        yield* service.refresh;

        const newLease = yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => await service.acquireRead()),
        );
        expect(yield* workerSeen(newLease.reads)).toBe(2);
        expect(yield* Effect.flip(workerSeen(oldLease.reads))).toMatchObject({
          _tag: "SnapshotExpired",
        });
      }),
  );

  it.effect(
    "passes on the Read Mode each worker's connection opened with",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({
          readMode: (n) => (n === 1 ? "copy" : "immutable"),
        });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workerSeen(reads);
          const opened = yield* until(changes, "changed");
          const seed = yield* Stream.runHead(reads.Changes());
          yield* workers.kill(1);
          yield* until(changes, "degraded");
          yield* reads.Refresh();
          const recovered = yield* until(changes, "changed");
          return { opened: opened.at(-1), seed, respawned: recovered.at(-1) };
        }).pipe(Effect.scoped);
        expect(result.opened).toEqual({ _tag: "changed", readMode: "copy" });
        expect(Option.getOrThrow(result.seed)).toEqual({
          _tag: "state",
          state: "ready",
          error: null,
          readMode: "copy",
        });
        expect(result.respawned).toEqual({
          _tag: "changed",
          readMode: "immutable",
        });
      }),
  );

  it.effect(
    "a worker that stops answering moves the client to degraded, and Refresh spawns a new one",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({
          unanswered: (n) => (n === 1 ? Infinity : 0),
        });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          const seed = Effect.map(Stream.runHead(reads.Changes()), (option) =>
            Option.getOrThrow(option),
          );
          yield* TestClock.adjust("10 seconds");
          yield* TestClock.adjust("15 seconds");
          yield* TestClock.adjust("4999 millis");
          const before = yield* seed;
          yield* TestClock.adjust("1 millis");
          let after = yield* seed;
          const degraded = (event: ChangeEvent) =>
            event._tag === "state" && event.state === "degraded";
          for (let turn = 0; turn < 100 && !degraded(after); turn++) {
            yield* Effect.yieldNow;
            after = yield* seed;
          }
          const read = yield* Effect.flip(reads.Libraries({}));
          const ended = workers.ended(1);
          yield* reads.Refresh();
          return {
            before,
            after,
            read,
            ended,
            abandoned: workers.abandoned(1),
            seen: yield* workerSeen(reads),
          };
        }).pipe(Effect.scoped);
        expect(result.before).toMatchObject({ _tag: "state", state: "ready" });
        expect(result.after).toMatchObject({
          _tag: "state",
          state: "degraded",
          error: {
            _tag: "DbUnavailable",
            message: "The database worker stopped responding",
          },
        });
        expect(result.read).toMatchObject({
          _tag: "DbUnavailable",
          message: "The database worker stopped responding",
        });
        expect(result.ended).toBe(true);
        expect(result.abandoned).toBe(false);
        expect(result.seen).toBe(2);
      }),
  );

  it.effect.each([
    ["fails", "The database worker connection broke"],
    ["ends", "The database worker connection ended"],
  ] as const)(
    "a transport that %s with no error event lets Refresh respawn without the close wait",
    ([how, message]) =>
      Effect.gen(function* () {
        const workers = fakeWorkers({
          closeWait: (n) => (n === 1 ? "5 seconds" : undefined),
        });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.cut(1, how);
          for (let turn = 0; turn < 100; turn++) yield* Effect.yieldNow;
          const refresh = yield* Effect.forkChild(reads.Refresh());
          for (let turn = 0; turn < 100 && !refresh.pollUnsafe(); turn++)
            yield* Effect.yieldNow;
          const exit = refresh.pollUnsafe();
          if (!exit) yield* TestClock.adjust("5 seconds");
          const events = exit ? yield* until(changes, "changed") : [];
          return {
            exit,
            events,
            ended: workers.ended(1),
            abandoned: workers.abandoned(1),
            seen: exit ? yield* workerSeen(reads) : undefined,
          };
        }).pipe(Effect.scoped);
        expect(result.exit).toMatchObject({ _tag: "Success" });
        expect(result.events).toContainEqual(
          expect.objectContaining({
            error: expect.objectContaining({
              message: expect.stringContaining(message),
            }),
          }),
        );
        expect(result.abandoned).toBe(true);
        expect(result.ended).toBe(true);
        expect(result.seen).toBe(2);
      }),
  );

  it.effect(
    "a worker that misses one ping and answers the next stays connected",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({ unanswered: () => 1 });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          yield* workerSeen(reads);
          yield* TestClock.adjust("10 seconds");
          yield* TestClock.adjust("15 seconds");
          yield* TestClock.adjust("5 seconds");
          return yield* workerSeen(reads);
        }).pipe(Effect.scoped);
        expect(result).toBe(1);
        expect(workers.spawned()).toBe(1);
      }),
  );

  it.effect("a worker that keeps answering stays connected", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers();
      const result = yield* Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        for (let probe = 0; probe < 60; probe++)
          yield* TestClock.adjust("10 seconds");
        return yield* workerSeen(reads);
      }).pipe(Effect.scoped);
      expect(result).toBe(1);
      expect(workers.spawned()).toBe(1);
    }),
  );

  it.effect(
    "a worker that does not start leaves the client degraded until Refresh succeeds",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({ failStart: (n) => n === 1 });
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeWorkerReads(workers.connect);
          const [seed] = yield* Effect.orDie(
            Stream.runHead(reads.Changes()).pipe(Effect.map((o) => [o])),
          );
          const before = yield* Effect.flip(reads.Libraries({}));
          yield* reads.Refresh();
          return { seed, before, after: yield* workerSeen(reads) };
        }).pipe(Effect.scoped);
        expect(result.seed).toMatchObject({
          _tag: "Some",
          value: {
            _tag: "state",
            state: "degraded",
            error: {
              _tag: "DbUnavailable",
              message: "worker #1 did not start",
            },
          },
        });
        expect(result.before).toMatchObject({
          _tag: "DbUnavailable",
          message: "worker #1 did not start",
        });
        expect(result.after).toBe(2);
      }),
  );

  it.effect("bounds a hung startup, releases it, and recovers on Refresh", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers({ hangStart: (n) => n === 1 });
      const result = yield* Effect.gen(function* () {
        const starting = yield* Effect.forkChild(
          makeWorkerReads(workers.connect),
        );
        yield* TestClock.adjust("15 seconds");
        const exit = yield* Fiber.await(starting);
        if (Exit.isFailure(exit)) return { exit };
        const reads = exit.value;
        const seed = yield* Stream.runHead(reads.Changes());
        const ended = workers.ended(1);
        yield* reads.Refresh();
        return { exit, seed, ended, seen: yield* workerSeen(reads) };
      }).pipe(Effect.scoped);
      expect(result.exit).toMatchObject({ _tag: "Success" });
      expect(result.seed).toMatchObject({
        value: { state: "degraded", error: { _tag: "DbUnavailable" } },
      });
      expect(result.ended).toBe(true);
      expect(result.seen).toBe(2);
    }),
  );

  it.effect(
    "service unload finishes when the initial worker never connects",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers({ hangStart: () => true });
        const opening = yield* Effect.forkChild(
          readsFixture(makeWorkerReads(workers.connect)),
        );
        yield* TestClock.adjust("15 seconds");
        const { service, runtime } = yield* Fiber.join(opening);
        yield* runtime.disposeEffect;
        yield* runtime.disposeEffect;
        expect(workers.ended(1)).toBe(true);
        expect((yield* service.current).state).toBe("degraded");
      }),
  );

  it.effect("ends a worker whose start was interrupted", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers({ hangStart: (n) => n === 2 });
      const ended = yield* Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
        const changes = yield* Stream.toPull(reads.Changes());
        yield* workers.kill(1);
        yield* until(changes, "degraded");

        const refreshing = yield* reads
          .Refresh()
          .pipe(Effect.timeoutOption("10 millis"), Effect.forkChild);
        yield* TestClock.adjust("10 millis");
        yield* Fiber.join(refreshing);
        return workers.ended(2);
      }).pipe(Effect.scoped);
      expect(workers.spawned()).toBe(2);
      expect(ended).toBe(true);
    }),
  );

  it.effect(
    "moves ZoteroReads to degraded on a worker error, and refresh recovers",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const { service } = yield* readsFixture(
          makeWorkerReads(workers.connect),
        );
        const { reads } = service;
        yield* workerSeen(reads);

        const degraded = new Promise<DbUnavailable>((resolve) =>
          subscribe(service.runtime, readsEvents.degraded(service), resolve),
        );
        yield* workers.kill(1);
        yield* Effect.promise(() =>
          expect(degraded).resolves.toMatchObject({
            _tag: "DbUnavailable",
            message: "worker #1 crashed",
          }),
        );
        expect((yield* service.current).state).toBe("degraded");

        yield* service.refresh;
        yield* Stream.runHead(
          Stream.filter(service.changes, (state) => state.state === "ready"),
        );
        expect(yield* workerSeen(reads)).toBe(2);
        expect(workers.ended(1)).toBe(true);
      }),
  );

  it.effect("reports no degraded ZoteroReads when unload ends the worker", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers();
      const { service, runtime } = yield* readsFixture(
        makeWorkerReads(workers.connect),
      );
      const { reads } = service;
      yield* workerSeen(reads);
      yield* Stream.runHead(
        Stream.filter(service.changes, (state) => state.state === "ready"),
      );
      const degraded: DbUnavailable[] = [];
      subscribe(service.runtime, readsEvents.degraded(service), (error) =>
        degraded.push(error),
      );

      yield* runtime.disposeEffect;

      expect(workers.ended(1)).toBe(true);
      expect(workers.abandoned(1)).toBe(false);
      expect(degraded).toEqual([]);
      expect((yield* service.current).state).toBe("ready");
    }),
  );

  it.effect(
    "unload interrupts a hung recovery and repeated unload stays safe",
    () =>
      Effect.gen(function* () {
        const recoveryStarted = Promise.withResolvers<void>();
        const workers = fakeWorkers({
          hangStart: (n) => {
            if (n !== 2) return false;
            recoveryStarted.resolve();
            return true;
          },
        });
        yield* Effect.gen(function* () {
          const scope = yield* Scope.make();
          const reads = yield* Scope.provide(
            makeWorkerReads(workers.connect),
            scope,
          );
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.kill(1);
          yield* until(changes, "degraded");
          const recovery = yield* Effect.forkChild(reads.Refresh());
          yield* Effect.promise(() => recoveryStarted.promise);
          yield* Scope.close(scope, Exit.void);
          yield* Scope.close(scope, Exit.void);
          const exit = yield* Fiber.await(recovery);
          expect(exit).toMatchObject({ _tag: "Failure" });
          expect(workers.ended(2)).toBe(true);
        }).pipe(Effect.scoped);
      }),
  );

  it.effect(
    "rejects recovery after disposal without starting another worker",
    () =>
      Effect.gen(function* () {
        const workers = fakeWorkers();
        const result = yield* Effect.gen(function* () {
          const scope = yield* Scope.make();
          const reads = yield* Scope.provide(
            makeWorkerReads(workers.connect),
            scope,
          );
          yield* workerSeen(reads);
          const changes = yield* Stream.toPull(reads.Changes());
          yield* workers.kill(1);
          yield* until(changes, "degraded");
          yield* Scope.close(scope, Exit.void);
          const refreshed = yield* Effect.exit(reads.Refresh());
          yield* Scope.close(scope, Exit.void);
          return refreshed;
        }).pipe(Effect.scoped);
        expect(result).toMatchObject({ _tag: "Failure" });
        expect(workers.spawned()).toBe(1);
      }),
  );

  it.effect("ends the worker when the caller's scope closes", () =>
    Effect.gen(function* () {
      const workers = fakeWorkers();
      yield* Effect.gen(function* () {
        const reads = yield* makeWorkerReads(workers.connect);
        yield* workerSeen(reads);
      }).pipe(Effect.scoped);
      expect(workers.ended(1)).toBe(true);
    }),
  );
});

class StandInWorker extends EventTarget {
  static spawned: StandInWorker[] = [];
  static answersClose = true;
  readonly posted: unknown[] = [];
  terminated = false;
  constructor() {
    super();
    StandInWorker.spawned.push(this);
    queueMicrotask(() =>
      this.dispatchEvent(new MessageEvent("message", { data: [0] })),
    );
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
    if (StandInWorker.answersClose && Array.isArray(data) && data[0] === 1)
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", { data: WORKER_CLOSED }),
        ),
      );
  }
  terminate(): void {
    this.terminated = true;
  }
  crash(): void {
    this.dispatchEvent(
      Object.assign(new Event("error"), { message: "worker crashed" }),
    );
  }
  get snapshotOwner(): string | undefined {
    for (const data of this.posted) {
      const message = (data as [number, { _tag?: string; value?: unknown }])[1];
      if (message?._tag === "InitialMessage")
        return (message.value as { snapshotOwner: string }).snapshotOwner;
    }
    return undefined;
  }
}

const readsConfig = (databasePath: string): FileReadsConfig => ({
  databasePath,
  readMode: "auto",
  autoRefresh: true,
  locale: null,
  chineseSegmenter: null,
  logLevel: null,
});

const openConnection = Effect.fnUntraced(function* (
  config: Effect.Effect<FileReadsConfig>,
  reapSnapshots: ReapWorkerSnapshots,
) {
  const scope = yield* Scope.make();
  const connection = yield* Scope.provide(
    connectWorker("", config, { reapSnapshots }).pipe(
      Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
    ),
    scope,
  );
  const spawned = StandInWorker.spawned.length;
  const worker = yield* Effect.promise(() =>
    vi.waitFor(() => {
      const worker = StandInWorker.spawned[spawned];
      expect(worker?.snapshotOwner).toBeDefined();
      return worker!;
    }),
  );
  return { scope, connection, worker, owner: worker.snapshotOwner! };
});

describe("connectWorker close", () => {
  const warnings: Array<{
    readonly message: unknown;
    readonly category: readonly string[];
    readonly annotations: Readonly<Record<string, unknown>>;
  }> = [];
  const captureWarnings = Logger.make(({ logLevel, message, fiber }) => {
    if (logLevel !== "Warn") return;
    warnings.push({
      message,
      category: fiber.getRef(LogCategory),
      annotations: fiber.getRef(References.CurrentLogAnnotations),
    });
  });
  beforeEach(() => {
    StandInWorker.spawned = [];
    StandInWorker.answersClose = true;
    vi.stubGlobal("Worker", StandInWorker);
    warnings.length = 0;
  });
  afterEach(() => {
    StandInWorker.answersClose = true;
    vi.unstubAllGlobals();
  });

  const closeOnStillClock = Effect.fnUntraced(function* () {
    const { scope, worker } = yield* openConnection(
      Effect.succeed(readsConfig("zotero.sqlite")),
      () => Effect.void,
    );
    const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
    for (let turn = 0; turn < 100 && !closing.pollUnsafe(); turn++)
      yield* Effect.yieldNow;
    return { closing, worker };
  });

  it.effect(
    "terminates the worker and revokes its URL when it answers close",
    () =>
      Effect.gen(function* () {
        using createUrl = vi.spyOn(URL, "createObjectURL");
        using revokeUrl = vi.spyOn(URL, "revokeObjectURL");
        const result = yield* Effect.gen(function* () {
          const { closing, worker } = yield* closeOnStillClock();
          return { closed: closing.pollUnsafe() !== undefined, worker };
        }).pipe(Effect.provide(Logger.layer([captureWarnings])));
        expect(result.closed).toBe(true);
        expect(result.worker.terminated).toBe(true);
        expect(createUrl).toHaveBeenCalledOnce();
        expect(revokeUrl).toHaveBeenCalledExactlyOnceWith(
          createUrl.mock.results[0]!.value,
        );
        expect(warnings).toEqual([]);
      }),
  );

  it.effect(
    "terminates a worker that never answers the close message after the close timeout, and warns",
    () =>
      Effect.gen(function* () {
        StandInWorker.answersClose = false;
        const result = yield* Effect.gen(function* () {
          const { closing, worker } = yield* closeOnStillClock();
          const terminatedBefore = worker.terminated;
          yield* TestClock.adjust("5 seconds");
          yield* Fiber.join(closing);
          return { terminatedBefore, terminated: worker.terminated };
        }).pipe(Effect.provide(Logger.layer([captureWarnings])));
        expect(result).toEqual({ terminatedBefore: false, terminated: true });
        expect(warnings).toEqual([
          expect.objectContaining({
            message: [
              "Database worker did not confirm its close in time; terminating it",
            ],
            category: ["zotero-reads"],
            annotations: { timeout: "5s" },
          }),
        ]);
      }),
  );
});

describe("connectWorker read snapshot cleanup", () => {
  beforeEach(() => {
    StandInWorker.spawned = [];
    vi.stubGlobal("Worker", StandInWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.effect(
    "reaps a crashed worker's snapshots once it is terminated, under its tag and each database path it read",
    () =>
      Effect.gen(function* () {
        let terminatedAtReap: boolean | undefined;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<void>();
        const reap = vi.fn(() =>
          Effect.gen(function* () {
            terminatedAtReap = StandInWorker.spawned[0]!.terminated;
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            yield* Deferred.succeed(completed, undefined);
          }),
        );
        let databasePath = join("zotero", "zotero.sqlite");
        const config = Effect.sync(() => readsConfig(databasePath));

        const owner = yield* Effect.gen(function* () {
          const { scope, connection, worker, owner } = yield* openConnection(
            config,
            reap,
          );
          databasePath = join("moved", "zotero.sqlite");
          worker.crash();
          yield* connection.died;
          expect(reap).not.toHaveBeenCalled();
          yield* Scope.close(scope, Exit.void);
          yield* Deferred.await(started);
          return owner;
        });

        expect(owner).toMatch(/^[0-9a-f]+$/);
        expect(terminatedAtReap).toBe(true);
        expect(reap).toHaveBeenCalledExactlyOnceWith({
          owner,
          databasePaths: [
            join("zotero", "zotero.sqlite"),
            join("moved", "zotero.sqlite"),
          ],
        });
        expect(Deferred.isDoneUnsafe(completed)).toBe(false);
        const settling = yield* Effect.forkChild(
          Deferred.await(completed).pipe(Effect.timeoutOption("1 second")),
        );
        yield* Deferred.succeed(release, undefined);
        yield* TestClock.adjust("1 second");
        expect(Option.isSome(yield* Fiber.join(settling))).toBe(true);
      }),
  );

  it.effect(
    "tags each connection apart, so a dead worker's reap spares the live one's snapshots",
    () =>
      Effect.gen(function* () {
        const reap = vi.fn((_options: { owner: string }) => Effect.void);
        const config = Effect.succeed(readsConfig("zotero.sqlite"));

        const [dead, live] = yield* Effect.gen(function* () {
          const dead = yield* openConnection(config, reap);
          dead.worker.crash();
          yield* Scope.close(dead.scope, Exit.void);
          const live = yield* openConnection(config, reap);
          yield* Scope.close(live.scope, Exit.void);
          return [dead.owner, live.owner];
        });

        expect(dead).not.toBe(live);
        expect(reap.mock.calls.map(([options]) => options.owner)).toEqual([
          dead,
          live,
        ]);
      }),
  );

  it.effect("closes without waiting on a reap that never settles", () =>
    Effect.gen(function* () {
      const reap = vi.fn(() => Effect.never);
      const config = Effect.succeed(readsConfig("zotero.sqlite"));

      yield* Effect.gen(function* () {
        const { scope, worker } = yield* openConnection(config, reap);
        worker.crash();
        yield* Scope.close(scope, Exit.void);
      });

      expect(reap).toHaveBeenCalledOnce();
    }),
  );
});
