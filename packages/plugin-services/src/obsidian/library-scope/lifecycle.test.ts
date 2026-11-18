import { it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  PubSub,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  inProcessClient,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { layerZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";
import type { ChangeEvent } from "@zotlit/zotero-reads/contract/rpc.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";

import { libraryScopeFixture } from "./__fixtures__.ts";
import { LibraryScope, layerLibraryScope } from "./service.ts";

import { platformSettings } from "#__fixtures__/platform-settings.ts";
import { layerQueryClients } from "#core/query-client/service.ts";
import { layerPluginSettings } from "#obsidian/settings/service.ts";

it.effect("holds the first Libraries answer when the layer builds", () =>
  Effect.gen(function* () {
    const reads = layerZoteroReads(
      inProcessClient(
        layerRcRef(
          memoryOpener(
            () => "insert into libraries (libraryID, type) values (1, 'user');",
          ).open,
        ),
      ),
    );
    const services = yield* Layer.build(
      layerLibraryScope.pipe(
        Layer.provide(
          Layer.mergeAll(
            reads,
            layerQueryClients,
            layerPluginSettings(
              {
                loadData: async () => ({ __VERSION__: 11 }),
                saveData: async () => {},
              },
              { definition: platformSettings },
            ),
          ),
        ),
      ),
    );
    const service = Context.get(services, LibraryScope);
    expect((yield* service.current)?.available).toHaveLength(1);
    const replay = yield* Stream.runHead(service.changes);
    expect(replay).toMatchObject({ value: { current: { mode: "all" } } });
  }),
);

it.effect(
  "bounds the first read without waiting for database readiness and accepts its late answer",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const client = Effect.map(
        inProcessClient(
          layerRcRef(
            memoryOpener(
              () =>
                "insert into libraries (libraryID, type) values (1, 'user');",
            ).open,
          ),
        ),
        (client) => ({
          ...client,
          Libraries: ((...args: Parameters<typeof client.Libraries>) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return yield* client.Libraries(...args);
            })) as typeof client.Libraries,
        }),
      );
      const building = yield* libraryScopeFixture(
        platformSettings,
        client,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("5 seconds");
      const f = yield* Fiber.join(building);
      expect(f.bridge.runSync(f.service.current)).toBeNull();
      yield* Deferred.succeed(release, undefined);
      yield* Stream.runHead(
        f.service.changes.pipe(
          Stream.filter((state) => state.current !== null),
        ),
      );
      expect(f.bridge.runSync(f.service.current)?.available).toHaveLength(1);
    }),
);

it.effect(
  "clears held Libraries when the read feed degrades and closes its database on unload",
  () =>
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<ChangeEvent>();
      const database = memoryOpener(
        () => "insert into libraries (libraryID, type) values (1, 'user');",
      );
      const client = Effect.map(
        inProcessClient(layerRcRef(database.open)),
        (client) => ({
          ...client,
          Changes: (() =>
            Stream.merge(
              client.Changes(),
              Stream.fromPubSub(events),
            )) as typeof client.Changes,
        }),
      );
      const f = yield* libraryScopeFixture(platformSettings, client);
      yield* Effect.promise(() =>
        expect
          .poll(() => f.bridge.runSync(f.reads.current).state)
          .toBe("ready"),
      );
      expect(f.bridge.runSync(f.service.current)?.available).toHaveLength(1);
      yield* PubSub.publish(events, {
        _tag: "degraded",
        error: new DbUnavailable({ message: "feed lost" }),
      });
      yield* Stream.runHead(
        f.service.changes.pipe(
          Stream.filter((state) => state.current === null),
        ),
      );
      expect(f.bridge.runSync(f.service.libraries)).toEqual([]);
      expect(f.bridge.runSync(f.service.libraryRows)).toBeNull();
      yield* Effect.promise(() => f.close());
      expect(database.log).toEqual(["open #1", "close #1"]);
    }),
);

it.effect(
  "scope closure ends changes and cancels an unfinished Libraries read",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      const database = memoryOpener(
        () => "insert into libraries (libraryID, type) values (1, 'user');",
      );
      const client = Effect.map(
        inProcessClient(layerRcRef(database.open)),
        (client) => ({
          ...client,
          Libraries: (() =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }).pipe(
              Effect.onInterrupt(() =>
                Deferred.succeed(interrupted, undefined),
              ),
            )) as typeof client.Libraries,
        }),
      );
      const building = yield* libraryScopeFixture(
        platformSettings,
        client,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("5 seconds");
      const f = yield* Fiber.join(building);
      const ended = yield* Stream.runDrain(f.service.changes).pipe(
        Effect.forkChild,
      );
      yield* Effect.promise(() => f.close());
      yield* Deferred.await(interrupted);
      yield* Fiber.join(ended);
      expect(f.bridge.runSync(f.service.current)).toBeNull();
    }),
);
