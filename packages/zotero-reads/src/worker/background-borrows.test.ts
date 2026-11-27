import { it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  References,
} from "effect";
import { describe, expect, vi } from "vitest";

import * as db from "@zotlit/db";

import { Connection, layerRcRef } from "./connection.ts";
import { layerUnpinnedConnectionItemSource } from "./item-source.ts";

import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
  worksSql,
} from "#__fixtures__/in-process.ts";
import { SEED } from "#__fixtures__/reads-seed.ts";
import { memoryWebApiSource, seededApi } from "#__fixtures__/web-api.ts";
import { MY_LIBRARY_SCOPE } from "#contract/library-scope.ts";

const ACCOUNT = { userID: 42, username: "reader" } as const;
const KEY_ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
const EXTRA_WORKS = 1200;

const workKey = (index: number) => {
  let key = "";
  for (let rest = index, at = 0; at < 7; at++) {
    key = KEY_ALPHABET[rest % KEY_ALPHABET.length] + key;
    rest = Math.floor(rest / KEY_ALPHABET.length);
  }
  return `W${key}`;
};
const LATE_KEY = workKey(EXTRA_WORKS - 1);

const seeded = () =>
  seededApi(
    `${SEED}\n${worksSql(
      Array.from({ length: EXTRA_WORKS }, (_, index) => ({
        itemID: 1000 + index,
        key: workKey(index),
        title: `Background work ${index}`,
        citationKey: `work${index}`,
      })),
    )}`,
    ACCOUNT,
  );

function observedConnection(
  source: Layer.Layer<Connection>,
  reads: () => number,
) {
  const holds: number[] = [];
  let armed: {
    readonly when: () => boolean;
    readonly parked: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  } | null = null;
  const layer = Layer.effect(Connection)(
    Effect.gen(function* () {
      const connection = yield* Connection;
      return {
        ...connection,
        borrow: Effect.gen(function* () {
          const park = armed;
          if (park?.when()) {
            armed = null;
            yield* Deferred.succeed(park.parked, undefined);
            yield* Deferred.await(park.release);
          }
          const client = yield* connection.borrow;
          const before = reads();
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => holds.push(reads() - before)),
          );
          return client;
        }),
      };
    }),
  ).pipe(Layer.provide(source));
  return {
    layer,
    holds,
    parkWhen: (when: () => boolean) =>
      Effect.gen(function* () {
        const parked = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        armed = { when, parked, release };
        return { parked, release };
      }),
  };
}

function captureLogs() {
  const lines: string[] = [];
  const waiters: { text: string; done: Deferred.Deferred<void> }[] = [];
  const logger = Logger.make(({ message }) => {
    const text = Array.isArray(message) ? message.join(" ") : String(message);
    lines.push(text);
    for (const waiter of waiters.filter((entry) => entry.text === text)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      Deferred.doneUnsafe(waiter.done, Exit.void);
    }
  });
  return {
    lines,
    count: (text: string, from = 0) =>
      lines.slice(from).filter((line) => line === text).length,
    next: (text: string) =>
      Effect.sync(() => {
        const done = Deferred.makeUnsafe<void>();
        waiters.push({ text, done });
        return done;
      }),
    provide: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, "All"),
      ),
  };
}

const webApiSource = (api: ReturnType<typeof seeded>) =>
  memoryWebApiSource(api, { holdBack: "50 millis" });

const PUBLISHED = "Citation lookup published";
const BUILT = "Item index built";
const RESTARTED = "Item index build started again; the source changed";

describe("background reads over the Web API source", () => {
  it.live.each(["between two windows", "after the last window"] as const)(
    "a Citation Lookup build holds one borrow for each window, lets a sync commit %s, and publishes only the new library version",
    (at) => {
      const logs = captureLogs();
      return logs.provide(
        Effect.gen(function* () {
          const api = seeded();
          const windows = yield* Effect.acquireDisposable(
            Effect.sync(() => vi.spyOn(db, "getCitekeyWindow")),
          );
          const observed = observedConnection(
            webApiSource(api),
            () => windows.mock.calls.length,
          );
          const reads = yield* inProcessClient(observed.layer, {
            itemSource: layerUnpinnedConnectionItemSource,
            citationWindowSize: 100,
          });
          const first = yield* reads.CitationLookup({
            scope: MY_LIBRARY_SCOPE,
            citekeys: ["main2024"],
          });
          expect(first.citekeys.get("main2024")).toMatchObject({
            kind: "unique",
          });
          const lastWindow = windows.mock.calls.at(-1)![1].throughItemID;
          const library = api.api.library({ type: "user", id: 42 });
          library.updateItem("MAIN2345", {
            citationKey: "renamed2024",
            dateModified: "2025-01-01T00:00:00Z",
          });
          library.updateItem(LATE_KEY, {
            citationKey: "renamedlate",
            dateModified: "2025-01-01T00:00:00Z",
          });
          const since = windows.mock.calls.length;
          const logged = logs.lines.length;
          const { parked, release } = yield* observed.parkWhen(() =>
            at === "between two windows"
              ? windows.mock.calls.length > since
              : windows.mock.calls
                  .slice(since)
                  .some((call) => call[1].throughItemID === lastWindow),
          );
          const lookup = yield* Effect.forkChild(
            reads.CitationLookup({
              scope: { mode: "all" },
              citekeys: ["main2024", "renamed2024", "renamedlate"],
            }),
          );
          yield* Deferred.await(parked);
          yield* reads.Refresh().pipe(Effect.timeout("5 seconds"));
          yield* Deferred.succeed(release, undefined);
          const answer = yield* Fiber.join(lookup);
          expect(answer.citekeys.get("main2024")).toEqual({ kind: "missing" });
          expect(answer.citekeys.get("renamed2024")).toMatchObject({
            kind: "unique",
            item: { indexedKey: "MAIN2345" },
          });
          expect(answer.citekeys.get("renamedlate")).toMatchObject({
            kind: "unique",
            item: { indexedKey: LATE_KEY },
          });
          expect(logs.count(PUBLISHED, logged)).toBe(1);
          expect(Math.max(...observed.holds)).toBe(1);
        }).pipe(Effect.scoped),
      );
    },
    30_000,
  );

  it.live.each(["between two pages", "after the last page"] as const)(
    "the item index scan holds one borrow for each page, lets a sync commit %s, and first holds the new library version",
    (at) => {
      const logs = captureLogs();
      return logs.provide(
        Effect.gen(function* () {
          const api = seeded();
          const pages = yield* Effect.acquireDisposable(
            Effect.sync(() => vi.spyOn(db, "getIndexedItemRowsRange")),
          );
          const observed = observedConnection(
            webApiSource(api),
            () => pages.mock.calls.length,
          );
          const reads = yield* inProcessClient(observed.layer, {
            itemSource: layerUnpinnedConnectionItemSource,
          });
          const search = (query: string) =>
            Effect.map(
              reads.SearchItems({ libraryIDs: [1], query, limit: 5 }),
              (hits) => hits.map((hit) => hit.item.key),
            );
          expect(yield* search("Main Study")).toContain("MAIN2345");
          const lastPage = pages.mock.calls.at(-1)![2].to;
          const library = api.api.library({ type: "user", id: 42 });
          library.updateItem("MAIN2345", {
            title: "Renamed Inquiry",
            dateModified: "2025-01-01T00:00:00Z",
          });
          const since = pages.mock.calls.length;
          const { parked, release } = yield* observed.parkWhen(() =>
            at === "between two pages"
              ? pages.mock.calls.length > since
              : pages.mock.calls
                  .slice(since)
                  .some((call) => call[2].to === lastPage),
          );
          yield* reads.Refresh();
          yield* Deferred.await(parked);
          library.updateItem(LATE_KEY, {
            title: "Late Inquiry",
            dateModified: "2025-01-01T00:00:00Z",
          });
          yield* reads.Refresh().pipe(Effect.timeout("5 seconds"));
          const logged = logs.lines.length;
          const built = yield* logs.next(BUILT);
          yield* Deferred.succeed(release, undefined);
          yield* Deferred.await(built);
          expect(logs.count(RESTARTED, logged)).toBe(1);
          expect(yield* search("Inquiry")).toEqual(
            expect.arrayContaining(["MAIN2345", LATE_KEY]),
          );
          expect(Math.max(...observed.holds)).toBe(1);
        }).pipe(Effect.scoped),
      );
    },
    30_000,
  );

  it.live(
    "answers a Citation Lookup with annotation keys from one borrow at a time",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        let held = 0;
        let most = 0;
        const counted = Layer.effect(Connection)(
          Effect.gen(function* () {
            const connection = yield* Connection;
            return {
              ...connection,
              borrow: Effect.acquireRelease(
                Effect.sync(() => {
                  held++;
                  most = Math.max(most, held);
                }),
                () =>
                  Effect.sync(() => {
                    held--;
                  }),
              ).pipe(Effect.andThen(connection.borrow)),
            };
          }),
        ).pipe(Layer.provide(webApiSource(api)));
        const reads = yield* inProcessClient(counted, {
          itemSource: layerUnpinnedConnectionItemSource,
        });
        yield* reads.CitationLookup({
          scope: MY_LIBRARY_SCOPE,
          citekeys: ["main2024"],
        });
        most = 0;
        yield* reads.CitationLookup({
          scope: MY_LIBRARY_SCOPE,
          citekeys: ["main2024"],
          annotationKeys: ["ANNO2345"],
        });
        expect(most).toBe(1);
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "answers a search issued during an apply from the committed library version, with no second search",
    () =>
      Effect.gen(function* () {
        const api = seeded();
        let probe: Effect.Effect<void> = Effect.void;
        const reads = yield* inProcessClient(
          memoryWebApiSource(api, {
            holdBack: "50 millis",
            slicing: { pageSize: 1, sliceMillis: 0 },
            betweenSlices: Effect.suspend(() => probe),
          }),
          { itemSource: layerUnpinnedConnectionItemSource },
        );
        const search = (query: string) =>
          Effect.map(
            reads.SearchItems({ libraryIDs: [1], query, limit: 5 }),
            (hits) =>
              hits.map(
                (hit) =>
                  `${hit.item.key} ${(hit.item.fields as { title?: string }).title}`,
              ),
          );
        expect(yield* search("Main Study")).toContain("MAIN2345 Main Study");
        api.api.library({ type: "user", id: 42 }).updateItem("MAIN2345", {
          title: "Renamed Inquiry",
          dateModified: "2025-01-01T00:00:00Z",
        });
        const applying = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        probe = Effect.andThen(
          Deferred.succeed(applying, undefined),
          Deferred.await(release),
        );
        const refresh = yield* Effect.forkChild(reads.Refresh());
        yield* Deferred.await(applying);
        probe = Effect.void;
        const byOldTitle = yield* Effect.forkChild(search("Main Study"), {
          startImmediately: true,
        });
        const byNewTitle = yield* Effect.forkChild(search("Inquiry"), {
          startImmediately: true,
        });
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(refresh);
        expect(
          (yield* Fiber.join(byOldTitle)).filter((hit) =>
            hit.startsWith("MAIN2345"),
          ),
        ).toEqual([]);
        expect(yield* Fiber.join(byNewTitle)).toContain(
          "MAIN2345 Renamed Inquiry",
        );
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "the item index signature holds one borrow for each range and starts again on a new client between two ranges",
    () => {
      const logs = captureLogs();
      let title = "First title";
      const extras: { itemID: number; key: string; title: string }[] = [];
      return logs.provide(
        Effect.gen(function* () {
          const ranges = yield* Effect.acquireDisposable(
            Effect.sync(() => vi.spyOn(db, "getIndexSignatureRange")),
          );
          const observed = observedConnection(
            layerRcRef(
              memoryOpener(() =>
                seedWorksSql([
                  { itemID: 5, key: "FIRST234", title: "Early work" },
                  { itemID: 15_001, key: "LATER234", title },
                  ...extras,
                ]),
              ).open,
            ),
            () => ranges.mock.calls.length,
          );
          const reads = yield* inProcessClient(observed.layer, {
            itemSource: layerUnpinnedConnectionItemSource,
          });
          const search = (query: string) =>
            Effect.map(
              reads.SearchItems({ libraryIDs: [1], query, limit: 5 }),
              (hits) => hits.map((hit) => hit.item.key),
            );
          expect(yield* search("First title")).toEqual(["LATER234"]);
          expect(ranges.mock.calls.length).toBeGreaterThan(1);
          const since = ranges.mock.calls.length;
          const { parked, release } = yield* observed.parkWhen(
            () => ranges.mock.calls.length > since,
          );
          title = "Second title";
          extras.push({ itemID: 3, key: "SECOND23", title: "Extra" });
          yield* reads.Refresh();
          yield* Deferred.await(parked);
          title = "Third title";
          extras.push({ itemID: 1, key: "THIRD234", title: "Extra" });
          yield* reads.Refresh();
          const logged = logs.lines.length;
          const built = yield* logs.next(BUILT);
          const released = ranges.mock.calls.length;
          yield* Deferred.succeed(release, undefined);
          yield* Deferred.await(built);
          expect(logs.count(RESTARTED, logged)).toBe(1);
          expect(ranges.mock.calls[released]![2]).toMatchObject({ from: 1 });
          expect(yield* search("Third title")).toEqual(["LATER234"]);
          expect(Math.max(...observed.holds)).toBe(1);
        }).pipe(Effect.scoped),
      );
    },
    30_000,
  );
});
