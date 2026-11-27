import { it } from "@effect/vitest";
import { sql } from "drizzle-orm";
import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  Fiber,
  Logger,
  Redacted,
  References,
} from "effect";
import { TestClock } from "effect/testing";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect } from "vitest";

import { openWasmClient } from "@zotlit/db/client/wasm";
import { createReplica, readSyncStatus } from "@zotlit/db/replica";
import { openNodeReplica, PARITY_USER } from "@zotlit/db/replica/parity-pair";
import type { ReplicaClient } from "@zotlit/db/replica/parity-pair";
import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import { setLibraryLogSink } from "@zotlit/shared/logging";
import zoteroSchema from "@zotlit/zotero-types/schema.json" with { type: "json" };

import { crossOriginFetch } from "./__fixtures__/fake-zotero-api.ts";
import type { FakeRequest } from "./__fixtures__/fake-zotero-api.ts";
import {
  libraryVersions,
  syncAndApply,
  syncHarness,
} from "./__fixtures__/harness.ts";
import type { SyncHarness } from "./__fixtures__/harness.ts";
import { readerView } from "./__fixtures__/reader-view.ts";
import { newApiKey, READ_ALL_ACCESS } from "./__fixtures__/scenario.ts";
import {
  applyDownload,
  downloadReplica,
  listKeyLibraries,
  verifyKey,
} from "./index.ts";
import type { WebApiFetch } from "./index.ts";

const USER = `/users/${PARITY_USER.userID}`;
const GROUP_ID = 4815;
const GROUP = `/groups/${GROUP_ID}`;

function data(view: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(view, (key, value: unknown) =>
      key === "version" ? undefined : value,
    ),
  ) as Record<string, unknown>;
}

function fetchedKeys(requests: readonly FakeRequest[]): string[] {
  return requests.flatMap((request) =>
    (request.query.itemKey ?? request.query.collectionKey ?? "")
      .split(",")
      .filter(Boolean),
  );
}

const inLibrary = (prefix: string) => (request: FakeRequest) =>
  request.path.startsWith(`${prefix}/`) && request.path !== `${USER}/groups`;

const waitFor = (
  harness: SyncHarness,
  predicate: (requests: FakeRequest[]) => boolean,
) => Effect.promise(() => harness.api.until((api) => predicate(api.requests)));

const FIXED_DATES = {
  dateAdded: "2024-01-01T00:00:00Z",
  dateModified: "2024-01-01T00:00:00Z",
};

const stagedAtLeast = Effect.fnUntraced(function* (
  harness: SyncHarness,
  count: number,
) {
  const staged = () =>
    Number(
      harness.replica.db.get<{ n: number }>(
        sql`select count(*) as n from replicaSyncObjects where libraryType = 'user' and objectType = 'item'`,
      )!.n,
    );
  for (let attempt = 0; attempt < 200 && staged() < count; attempt++)
    yield* Effect.promise(() => delay(5));
  expect(staged()).toBeGreaterThanOrEqual(count);
});

const secondsUntil = Effect.fnUntraced(function* (arrived: () => boolean) {
  for (let seconds = 1; seconds <= 600; seconds++) {
    yield* TestClock.adjust("1 second");
    yield* Effect.promise(() => delay(2));
    if (arrived()) return seconds;
  }
  throw new Error("no request arrived in 600 virtual seconds");
});

function logSignals(onMessage: (line: string) => void = () => {}) {
  const seen: string[] = [];
  const waiters = new Set<{
    text: string;
    count: number;
    resolve: () => void;
  }>();
  const count = (text: string) =>
    seen.filter((line) => line.includes(text)).length;
  const logger = Logger.make(({ message }) => {
    const line = [message].flat().map(String).join(" ");
    onMessage(line);
    seen.push(line);
    for (const waiter of waiters) {
      if (count(waiter.text) >= waiter.count) {
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
  });
  return {
    provide: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, "Debug"),
      ),
    until: (text: string, times: number) =>
      Effect.promise(() =>
        count(text) >= times
          ? Promise.resolve()
          : new Promise<void>((resolve) =>
              waiters.add({ text, count: times, resolve }),
            ),
      ),
  };
}

const stampedFetch = Effect.fnUntraced(function* () {
  const clock = yield* Clock.clockWith((current) => Effect.succeed(current));
  const sent: number[] = [];
  const marks: {
    readonly line: string;
    readonly sent: number;
    readonly at: number;
  }[] = [];
  const fetch: WebApiFetch = (url, init) => {
    sent.push(clock.currentTimeMillisUnsafe());
    return globalThis.fetch(url, init);
  };
  const mark = (line: string) => {
    marks.push({
      line,
      sent: sent.length,
      at: clock.currentTimeMillisUnsafe(),
    });
  };
  const waitsExactly = Effect.fnUntraced(function* (
    signal: string,
    times: number,
    seconds: number,
  ) {
    const signalled = marks.filter(({ line }) => line.includes(signal))[
      times - 1
    ]!;
    yield* TestClock.adjust(
      Duration.millis(
        signalled.at + seconds * 1000 - clock.currentTimeMillisUnsafe(),
      ),
    );
    expect(sent[signalled.sent]).toBe(signalled.at + seconds * 1000);
  });
  return { fetch, mark, waitsExactly };
});

const driven = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    let done = false;
    const fiber = yield* Effect.forkChild(
      effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            done = true;
          }),
        ),
      ),
      { startImmediately: true },
    );
    yield* Effect.promise(() => delay(2));
    if (!done) yield* secondsUntil(() => done);
    return yield* Fiber.join(fiber);
  });

const INTERNED: Readonly<Record<string, string>> = {
  itemID: "select itemID as id, key as name from items",
  parentItemID: "select itemID as id, key as name from items",
  collectionID: "select collectionID as id, key as name from collections",
  parentCollectionID: "select collectionID as id, key as name from collections",
  libraryID:
    "select l.libraryID as id, coalesce('group:' || g.groupID, l.type) as name from libraries l left join groups g using (libraryID)",
  valueID: "select valueID as id, value as name from itemDataValues",
  creatorID:
    "select creatorID as id, firstName || '|' || lastName || '|' || fieldMode as name from creators",
  tagID: "select tagID as id, name from tags",
  predicateID:
    "select predicateID as id, predicate as name from relationPredicates",
};

function replicaRows(db: ReplicaClient["db"]): Record<string, string[]> {
  const names = Object.fromEntries(
    Object.entries(INTERNED).map(([column, query]) => [
      column,
      new Map(
        db
          .all<{ id: number; name: string }>(sql.raw(query))
          .map((row) => [Number(row.id), row.name]),
      ),
    ]),
  );
  const tables = db
    .all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table'
        and name not like 'replicaSync%' and name not like 'sqlite_%'
        and name != 'relationPredicates' order by name`,
    )
    .map((row) => row.name);
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .all<Record<string, unknown>>(
          sql`select * from ${sql.identifier(table)}`,
        )
        .filter((row) => !(table === "settings" && row.key === "localUserKey"))
        .map((row) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(row).map(([column, value]) => [
                column,
                value === null || !(column in names)
                  ? value
                  : (names[column]!.get(Number(value)) ?? `missing:${value}`),
              ]),
            ),
          ),
        )
        .sort(),
    ]),
  );
}

type ItemView = { key: string; fields: { title?: string } };

function itemsIn(harness: SyncHarness, library: string): ItemView[] {
  const view = readerView(harness.replica.db) as Record<
    string,
    { items: ItemView[] }
  >;
  return view[library]?.items ?? [];
}

function titleIn(harness: SyncHarness, library: string, key: string) {
  return itemsIn(harness, library).find((item) => item.key === key)?.fields
    .title;
}

function firstItem(harness: SyncHarness, library: "user" | "group") {
  const records = harness.pair.records.find((record) =>
    library === "user" ? record.group === null : record.group?.id === GROUP_ID,
  )!;
  return records.items.find(
    (item) => !item.data.parentItem && item.data.itemType !== "note",
  )!;
}

describe("downloadReplica", () => {
  it.effect(
    "builds the personal and group libraries that the readers read as the scenario",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const { report, applied } = yield* syncAndApply(harness);

          expect(report.libraries.map((library) => library.outcome)).toEqual([
            "staged",
            "staged",
          ]);
          expect(
            applied.every((library) => library.deferred.length === 0),
          ).toBe(true);
          expect(data(readerView(harness.replica.db))).toEqual(
            data(readerView(harness.pair.replica.db)),
          );
          expect(
            harness.replica.db.all(
              sql`select key, value from settings where setting = 'account' and key in ('userID', 'username') order by key`,
            ),
          ).toEqual([
            { key: "userID", value: PARITY_USER.userID },
            { key: "username", value: PARITY_USER.username },
          ]);
          expect(libraryVersions(harness.replica.db)).toEqual({
            user: harness.api.user.version,
            [`group:${GROUP_ID}`]: harness.api.library({
              type: "group",
              id: GROUP_ID,
            }).version,
          });
          expect(
            readSyncStatus(harness.replica.db).map((status) => ({
              state: status.state,
              committed: status.committedVersion,
              synced: status.lastSync !== null,
            })),
          ).toEqual([
            {
              state: "idle",
              committed: harness.api.user.version,
              synced: true,
            },
            {
              state: "idle",
              committed: harness.api.library({ type: "group", id: GROUP_ID })
                .version,
              synced: true,
            },
          ]);
        }),
      ),
  );

  it.effect(
    "reports the objects done of the total for each library of the first build",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* harness.download();
          const userItems = harness.progress.filter(
            (event) => event.library.type === "user" && event.phase === "items",
          );
          expect(userItems[0]).toEqual({
            library: { type: "user", id: PARITY_USER.userID },
            phase: "items",
            done: 0,
            total: harness.api.user.items.size,
          });
          expect(userItems.at(-1)!.done).toBe(harness.api.user.items.size);
          expect(
            userItems.every(
              (event, index) =>
                index === 0 || event.done >= userItems[index - 1]!.done,
            ),
          ).toBe(true);
          expect(
            new Set(
              harness.progress.map(
                (event) => `${event.library.type}:${event.phase}`,
              ),
            ),
          ).toEqual(
            new Set([
              "user:collections",
              "user:items",
              "group:collections",
              "group:items",
            ]),
          );
        }),
      ),
  );

  it.effect(
    "brings an incremental change, a deletion and the trash to the readers",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          const changed = firstItem(harness, "user");
          const trashed = harness.pair.records
            .find((record) => record.group === null)!
            .items.find(
              (item) =>
                !item.data.parentItem &&
                item.data.itemType !== "note" &&
                item.key !== changed.key,
            )!;
          const deleted = firstItem(harness, "group");
          harness.api.user.updateItem(changed.key, {
            title: "A changed title",
          });
          harness.api.user.trashItem(trashed.key);
          harness.api
            .library({ type: "group", id: GROUP_ID })
            .deleteItem(deleted.key);
          harness.api.clearRequests();

          yield* syncAndApply(harness);

          expect(fetchedKeys(harness.api.requests).sort()).toEqual(
            [changed.key, trashed.key].sort(),
          );
          expect(titleIn(harness, "user", changed.key)).toBe("A changed title");
          expect(
            itemsIn(harness, "user").some((item) => item.key === trashed.key),
          ).toBe(false);
          expect(
            itemsIn(harness, `group:${GROUP_ID}`).some(
              (item) => item.key === deleted.key,
            ),
          ).toBe(false);
          expect(
            harness.replica.db.all(
              sql`select i.key from items i join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = ${deleted.key}`,
            ),
          ).toEqual([]);
          expect(
            harness.replica.db.all(
              sql`select i.key from deletedItems d join items i using (itemID) where i.libraryID = 1 and i.key = ${trashed.key}`,
            ),
          ).toEqual([{ key: trashed.key }]);
          expect(libraryVersions(harness.replica.db).user).toBe(
            harness.api.user.version,
          );

          harness.api.user.restoreItem(trashed.key);
          yield* syncAndApply(harness);
          expect(
            itemsIn(harness, "user").some((item) => item.key === trashed.key),
          ).toBe(true);
        }),
      ),
  );

  it.effect(
    "syncs through a browser fetch that shows only the response headers the real API exposes to another origin",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const browserFetch: WebApiFetch = crossOriginFetch((url, init) =>
            globalThis.fetch(url, init),
          );
          yield* harness.download(harness.key, browserFetch);
          harness.apply();
          expect(data(readerView(harness.replica.db))).toEqual(
            data(readerView(harness.pair.replica.db)),
          );
        }),
      ),
  );

  it.effect(
    "stores the read time of a group attachment from the personal library's synced setting, as the client does, from the first build on",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const setting = `lastRead_g${GROUP_ID}_PDF2GRUP`;
          const lastRead = () =>
            harness.replica.db.get<{ lastRead: number | null }>(
              sql`select a.lastRead from itemAttachments a join items i using (itemID)
                join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = 'PDF2GRUP'`,
            )?.lastRead ?? null;

          harness.api.user.putSetting(setting, 1700000000);
          yield* syncAndApply(harness);
          expect(lastRead()).toBe(1700000000);

          harness.api.user.putSetting(setting, 1700000100);
          yield* syncAndApply(harness);
          expect(lastRead()).toBe(1700000100);

          harness.api
            .library({ type: "group", id: GROUP_ID })
            .updateItem("PDF2GRUP", {
              title: "Renamed",
            });
          yield* syncAndApply(harness);
          expect(lastRead()).toBe(1700000100);

          harness.api.user.deleteSetting(setting);
          yield* syncAndApply(harness);
          expect(lastRead()).toBeNull();
        }),
      ),
  );

  it.effect(
    "clears the read time of a group attachment whose setting is gone when an expired deletion log makes a full comparison",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const setting = `lastRead_g${GROUP_ID}_PDF2GRUP`;
          const lastRead = () =>
            harness.replica.db.get<{ lastRead: number | null }>(
              sql`select a.lastRead from itemAttachments a join items i using (itemID)
                join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = 'PDF2GRUP'`,
            )?.lastRead ?? null;
          yield* syncAndApply(harness);
          harness.api.user.putSetting(setting, 1700000100);
          yield* syncAndApply(harness);
          expect(lastRead()).toBe(1700000100);

          harness.api.user.deleteSetting(setting);
          harness.api.user.deleteLogStart = harness.api.user.version;
          yield* syncAndApply(harness);
          expect(
            harness.api.requests.some(
              (request) =>
                request.path === `${USER}/deleted` && request.status === 409,
            ),
          ).toBe(true);
          expect(lastRead()).toBeNull();
        }),
      ),
  );

  it.effect(
    "in an incremental pass replaces a read time staged by a failed pass, so a setting that is now invalid keeps the stored read time",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const setting = `lastRead_g${GROUP_ID}_PDF2GRUP`;
          const lastRead = () =>
            harness.replica.db.get<{ lastRead: number | null }>(
              sql`select a.lastRead from itemAttachments a join items i using (itemID)
                join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = 'PDF2GRUP'`,
            )?.lastRead ?? null;
          yield* syncAndApply(harness);
          harness.api.user.putSetting(setting, 21);
          yield* syncAndApply(harness);
          expect(lastRead()).toBe(21);

          harness.api.user.putSetting(setting, 42);
          harness.api.inject({
            match: (request) =>
              request.path === `${USER}/items` &&
              request.query.format === "versions",
            answer: { status: 400, body: "Bad request" },
          });
          const failed = yield* syncAndApply(harness);
          expect(failed.report.libraries[0]).toMatchObject({
            outcome: "failed",
          });
          expect(lastRead()).toBe(21);

          harness.api.user.putSetting(setting, "not a time");
          yield* syncAndApply(harness);
          expect(
            harness.api.requests.some(
              (request) =>
                request.path === `${USER}/deleted` && request.status === 409,
            ),
          ).toBe(false);
          expect(lastRead()).toBe(21);
        }),
      ),
  );

  it.effect(
    "in a full comparison drops a read time staged by a failed pass, and keeps a stored read time whose setting has an invalid value",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const setting = `lastRead_g${GROUP_ID}_PDF2GRUP`;
          const lastRead = () =>
            harness.replica.db.get<{ lastRead: number | null }>(
              sql`select a.lastRead from itemAttachments a join items i using (itemID)
                join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = 'PDF2GRUP'`,
            )?.lastRead ?? null;
          yield* syncAndApply(harness);

          harness.api.user.putSetting(setting, 1700000100);
          harness.api.inject({
            match: (request) =>
              request.path === `${USER}/items` &&
              request.query.format === "versions",
            answer: { status: 400, body: "Bad request" },
          });
          const failed = yield* syncAndApply(harness);
          expect(failed.report.libraries[0]).toMatchObject({
            outcome: "failed",
          });
          expect(lastRead()).toBeNull();
          harness.api.user.deleteSetting(setting);
          harness.api.user.deleteLogStart = harness.api.user.version;
          yield* syncAndApply(harness);
          expect(lastRead()).toBeNull();

          harness.api.user.putSetting(setting, 1700000200);
          yield* syncAndApply(harness);
          expect(lastRead()).toBe(1700000200);
          harness.api.user.putSetting(setting, "not a time");
          yield* syncAndApply(harness);
          expect(lastRead()).toBe(1700000200);
          harness.api.user.putSetting("lastPageIndex_u_ABCD2345", 3);
          harness.api.user.deleteLogStart = harness.api.user.version;
          yield* syncAndApply(harness);
          expect(
            harness.api.requests.filter(
              (request) =>
                request.path === `${USER}/deleted` && request.status === 409,
            ).length,
          ).toBe(2);
          expect(lastRead()).toBe(1700000200);
        }),
      ),
  );

  it.effect("costs one conditional request for an unchanged library", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        yield* syncAndApply(harness);
        harness.api.clearRequests();

        const report = yield* harness.download();

        for (const prefix of [USER, GROUP]) {
          const requests = harness.api.requests.filter(inLibrary(prefix));
          expect(requests).toHaveLength(1);
          expect(requests[0]).toMatchObject({
            path: `${prefix}/settings`,
            status: 304,
          });
          expect(requests[0]!.ifModifiedSinceVersion).toBeGreaterThan(0);
        }
        expect(
          harness.api.requests.map((request) => request.path).sort(),
        ).toEqual(
          [
            "/keys/current",
            `${USER}/groups`,
            `${GROUP}/settings`,
            `${USER}/settings`,
          ].sort(),
        );
        expect(report.libraries.map((library) => library.outcome)).toEqual([
          "unchanged",
          "unchanged",
        ]);
        expect(report.needsApply).toBe(false);
      }),
    ),
  );

  it.effect(
    "asks for an apply of a new account name when no library changed, and the apply stores it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          harness.api.addKey(harness.key, READ_ALL_ACCESS, {
            ...PARITY_USER,
            username: "renamed reader",
          });

          const report = yield* harness.download();

          expect(report.libraries.map((library) => library.outcome)).toEqual([
            "unchanged",
            "unchanged",
          ]);
          expect(report.needsApply).toBe(true);
          harness.apply();
          expect(
            harness.replica.db.get(
              sql`select value from settings where setting = 'account' and key = 'username'`,
            ),
          ).toEqual({ value: "renamed reader" });
        }),
      ),
  );

  it.effect(
    "sends the version of the vendored Zotero schema with each request",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);

          expect(harness.api.requests.length).toBeGreaterThan(0);
          expect(
            new Set(
              harness.api.requests.map(
                (request) => request.headers["zotero-schema-version"],
              ),
            ),
          ).toEqual(new Set([String(zoteroSchema.version)]));
        }),
      ),
  );

  it.effect("starts the pass again when the library changes during it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        yield* syncAndApply(harness);
        const item = firstItem(harness, "user");
        harness.api.user.updateItem(item.key, { title: "Before the pass" });
        harness.api.inject({
          match: (request) =>
            request.path === `${USER}/items` &&
            request.query.format === "versions",
          before: (api) =>
            api.user.updateItem(item.key, { title: "During the pass" }),
        });
        harness.api.clearRequests();

        const { report } = yield* driven(syncAndApply(harness));

        expect(
          harness.api.requests.filter(
            (request) => request.path === `${USER}/settings`,
          ),
        ).toHaveLength(2);
        expect(report.libraries[0]).toMatchObject({
          outcome: "staged",
          version: harness.api.user.version,
        });
        expect(titleIn(harness, "user", item.key)).toBe("During the pass");
      }),
    ),
  );

  it.effect(
    "keeps the stored version and the readable data after a failed pass",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          const before = readerView(harness.replica.db);
          const versions = libraryVersions(harness.replica.db);
          const item = firstItem(harness, "user");
          harness.api.user.updateItem(item.key, { title: "Never applied" });
          harness.api
            .library({ type: "group", id: GROUP_ID })
            .updateItem(firstItem(harness, "group").key, { title: "Applied" });
          harness.api.inject({
            match: (request) => request.path === `${USER}/deleted`,
            times: 3,
            answer: { status: 500, body: "Internal error" },
          });

          const { report, applied } = yield* driven(syncAndApply(harness));

          expect(report.libraries[0]).toMatchObject({
            outcome: "failed",
            error: {
              _tag: "WebApiProtocolError",
              reason: "status",
              status: 500,
            },
          });
          expect(applied.map((library) => library.library.type)).toEqual([
            "group",
          ]);
          const after = readerView(harness.replica.db);
          expect(libraryVersions(harness.replica.db).user).toBe(versions.user);
          expect(after.user).toEqual(before.user);
          expect(titleIn(harness, "user", item.key)).not.toBe("Never applied");
        }),
      ),
  );

  it.effect(
    "continues an interrupted first build from staging without fetching stored objects again",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          for (let index = 0; index < 120; index++) {
            harness.api.user.putItem({
              key: `BULK${String(index).padStart(4, "0")}`,
              itemType: "book",
              title: `Bulk book ${index}`,
            });
          }
          const isItemBatch = (request: FakeRequest) =>
            request.path === `${USER}/items` &&
            request.query.itemKey !== undefined;
          const release = harness.api.hold(
            (request) =>
              isItemBatch(request) &&
              harness.api.requests.filter(
                (entry) => isItemBatch(entry) && entry.status !== null,
              ).length >= 2,
          );
          const fiber = yield* Effect.forkChild(harness.download(), {
            startImmediately: true,
          });
          yield* waitFor(
            harness,
            (requests) =>
              requests.filter(
                (entry) => isItemBatch(entry) && entry.status === 200,
              ).length >= 2,
          );
          yield* stagedAtLeast(harness, 2 * 50);
          yield* Fiber.interrupt(fiber);
          release();
          const firstRun = harness.api.requests.filter(
            (request) => isItemBatch(request) && request.status === 200,
          );
          expect(firstRun.length).toBeGreaterThanOrEqual(2);
          expect(libraryVersions(harness.replica.db).user).toBe(0);
          harness.api.clearRequests();

          yield* syncAndApply(harness);

          const again = new Set(
            fetchedKeys(harness.api.requests.filter(isItemBatch)),
          );
          expect(fetchedKeys(firstRun).filter((key) => again.has(key))).toEqual(
            [],
          );
          expect(libraryVersions(harness.replica.db).user).toBe(
            harness.api.user.version,
          );
          const view = readerView(harness.replica.db) as Record<
            string,
            { items: unknown[] }
          >;
          expect(view.user!.items.length).toBeGreaterThan(120);
        }),
      ),
  );

  it.effect(
    "runs at most four requests at a time and fetches 50 keys with an explicit limit",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          for (let index = 0; index < 400; index++) {
            harness.api.user.putItem({
              key: `MANY${String(index).padStart(4, "0")}`,
              itemType: "journalArticle",
              title: `Article ${index}`,
            });
          }
          const isItemBatch = (request: FakeRequest) =>
            request.path === `${USER}/items` &&
            request.query.itemKey !== undefined;
          const release = harness.api.hold(isItemBatch);
          const fiber = yield* Effect.forkChild(harness.download(), {
            startImmediately: true,
          });
          yield* Effect.promise(() =>
            harness.api.until((api) => api.inFlight === 4),
          );
          release();
          yield* Fiber.join(fiber);

          expect(harness.api.maxInFlight).toBe(4);
          const batches = harness.api.requests.filter(isItemBatch);
          expect(batches.length).toBeGreaterThanOrEqual(9);
          for (const batch of batches) {
            const keys = batch.query.itemKey!.split(",");
            expect(keys.length).toBeLessThanOrEqual(50);
            expect(batch.query.limit).toBe(String(keys.length));
            expect(batch.query.includeTrashed).toBe("1");
          }
        }),
      ),
  );

  it.effect(
    "asks again for the keys of an answer that holds fewer objects than Total-Results",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          harness.api.inject({
            match: (request) =>
              request.path === `${USER}/items` &&
              request.query.itemKey !== undefined,
            truncate: 3,
          });
          yield* syncAndApply(harness);
          expect(data(readerView(harness.replica.db))).toEqual(
            data(readerView(harness.pair.replica.db)),
          );
          const batches = harness.api.requests.filter(
            (request) =>
              request.path === `${USER}/items` &&
              request.query.itemKey !== undefined,
          );
          expect(batches).toHaveLength(2);
          expect(batches[1]!.query.itemKey!.split(",")).toHaveLength(
            batches[0]!.query.itemKey!.split(",").length - 3,
          );
        }),
      ),
  );

  it.effect("pauses every request for Backoff", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        const isTarget = (request: FakeRequest) =>
          request.path === `${USER}/collections` &&
          request.query.format === "versions";
        harness.api.inject({ match: isTarget, backoff: 30 });
        const stamped = yield* stampedFetch();
        const signals = logSignals(stamped.mark);
        const fiber = yield* Effect.forkChild(
          signals.provide(harness.download(harness.key, stamped.fetch)),
          { startImmediately: true },
        );
        yield* signals.until("asked for a pause", 1);
        yield* stamped.waitsExactly("asked for a pause", 1, 30);
        const report = yield* Fiber.join(fiber);
        expect(report.libraries.map((library) => library.outcome)).toEqual([
          "staged",
          "staged",
        ]);
      }),
    ),
  );

  it.effect("waits for Retry-After on a 429 and retries the request", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        const isTarget = (request: FakeRequest) =>
          request.path === `${USER}/settings`;
        harness.api.inject({
          match: isTarget,
          answer: { status: 429, headers: { "Retry-After": "7" } },
        });
        const stamped = yield* stampedFetch();
        const signals = logSignals(stamped.mark);
        const fiber = yield* Effect.forkChild(
          signals.provide(harness.download(harness.key, stamped.fetch)),
          { startImmediately: true },
        );
        yield* signals.until("limited the request rate", 1);
        yield* stamped.waitsExactly("limited the request rate", 1, 7);
        const report = yield* Fiber.join(fiber);
        expect(
          harness.api.requests
            .filter(isTarget)
            .map((request) => request.status),
        ).toEqual([429, 200]);
        expect(report.libraries[0]).toMatchObject({ outcome: "staged" });
      }),
    ),
  );

  it.effect(
    "waits 30, 60 and 300 seconds on a 429 without Retry-After, fails the library as rate limited after five, and keeps the wait of the fifth for the next request",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const isTarget = (request: FakeRequest) =>
            request.path === `${USER}/settings`;
          harness.api.inject({
            match: isTarget,
            times: 5,
            answer: { status: 429 },
          });
          const stamped = yield* stampedFetch();
          const signals = logSignals(stamped.mark);
          const fiber = yield* Effect.forkChild(
            signals.provide(harness.download(harness.key, stamped.fetch)),
            { startImmediately: true },
          );
          for (const [index, seconds] of [30, 60, 300, 300, 300].entries()) {
            yield* signals.until("limited the request rate", index + 1);
            yield* stamped.waitsExactly(
              "limited the request rate",
              index + 1,
              seconds,
            );
          }
          const report = yield* Fiber.join(fiber);
          expect(report.libraries[0]).toMatchObject({
            outcome: "failed",
            error: { _tag: "WebApiRateLimited", attempts: 5 },
          });
        }),
      ),
    30_000,
  );

  it.effect(
    "takes one step of the wait for a burst of 429 answers, the next step for the next burst, and the first step again after a success",
    ({ annotate }) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            annotate(
              "https://github.com/aidenlx/zotlit-repo/issues/325",
              "issue",
            ),
          );
          const harness = yield* syncHarness();
          for (let index = 0; index < 400; index++) {
            harness.api.user.putItem({
              key: `MANY${String(index).padStart(4, "0")}`,
              itemType: "journalArticle",
              title: `Article ${index}`,
            });
          }
          const isItemBatch = (request: FakeRequest) =>
            request.path === `${USER}/items` &&
            request.query.itemKey !== undefined;
          const clock = yield* Clock.clockWith((current) =>
            Effect.succeed(current),
          );
          const sentAt: number[] = [];
          const fetch: WebApiFetch = (url, init) => {
            if (url.includes(`${USER}/items?`) && url.includes("itemKey="))
              sentAt.push(clock.currentTimeMillisUnsafe());
            return globalThis.fetch(url, init);
          };
          const signals = logSignals();
          const batches = () => harness.api.requests.filter(isItemBatch);
          const held = (succeeded: number) =>
            Effect.promise(() =>
              harness.api.until(
                (api) =>
                  api.inFlight === 4 &&
                  batches().filter((request) => request.status === 200)
                    .length >= succeeded,
              ),
            );

          let release = harness.api.hold(isItemBatch);
          const fiber = yield* Effect.forkChild(
            signals.provide(harness.download(harness.key, fetch)),
            { startImmediately: true },
          );
          const releaseRound = (last: boolean) => {
            const next = last ? () => {} : harness.api.hold(isItemBatch);
            release();
            release = next;
          };
          const burst = Effect.fnUntraced(function* (
            succeeded: number,
            refusals: number,
            last = false,
          ) {
            yield* held(succeeded);
            harness.api.inject({
              match: isItemBatch,
              times: 4,
              answer: { status: 429 },
            });
            const before = sentAt.length;
            const refusedAt = clock.currentTimeMillisUnsafe();
            releaseRound(last);
            yield* signals.until("limited the request rate", refusals);
            return { before, refusedAt };
          });
          const retriesAfter = Effect.fnUntraced(function* (
            { before, refusedAt }: { before: number; refusedAt: number },
            seconds: number,
          ) {
            yield* TestClock.adjust(
              Duration.millis(
                refusedAt + seconds * 1000 - clock.currentTimeMillisUnsafe(),
              ),
            );
            yield* Effect.promise(() =>
              harness.api.until(() => batches().length >= before + 4),
            ).pipe(Effect.timeoutOption("2 seconds"), TestClock.withLive);
            return sentAt
              .slice(before, before + 4)
              .map((at) => (at - refusedAt) / 1000);
          });

          const first = yield* burst(0, 4);
          expect(yield* retriesAfter(first, 30)).toEqual([30, 30, 30, 30]);

          const second = yield* burst(0, 8);
          expect(yield* retriesAfter(second, 60)).toEqual([60, 60, 60, 60]);

          yield* held(0);
          releaseRound(false);
          const afterSuccess = yield* burst(4, 12, true);
          expect(yield* retriesAfter(afterSuccess, 30)).toEqual([
            30, 30, 30, 30,
          ]);

          const report = yield* driven(Fiber.join(fiber));
          expect(report.libraries.map((library) => library.outcome)).toEqual([
            "staged",
            "staged",
          ]);
        }),
      ),
    30_000,
  );

  it.effect(
    "gives a typed error for a wrong key and for a key that reads no library",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const wrong = yield* Effect.flip(harness.download(newApiKey()));
          expect(wrong._tag).toBe("WebApiKeyInvalid");

          const blind = newApiKey();
          harness.api.addKey(blind, { user: { library: false }, groups: {} });
          const none = yield* Effect.flip(harness.download(blind));
          expect(none._tag).toBe("WebApiNoAccess");
          expect(libraryVersions(harness.replica.db)).toEqual({ user: 0 });
        }),
      ),
  );

  it.effect(
    "counts a group permission as a readable library only when the account is in a group",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const member = newApiKey();
          harness.api.addKey(member, {
            user: { library: false },
            groups: { all: { library: true } },
          });
          const verify = (key: string) =>
            verifyKey({
              apiKey: Redacted.make(key),
              fetch: (url, init) => globalThis.fetch(url, init),
              baseUrl: harness.server.url,
            });
          const libraries = (key: string) =>
            Effect.flatMap(verify(key), (verified) =>
              listKeyLibraries(verified),
            );
          expect((yield* libraries(member)).readsLibraries).toBe(true);
          harness.api.leaveGroup(GROUP_ID);
          expect((yield* libraries(member)).readsLibraries).toBe(false);
        }),
      ),
  );

  it.effect(
    "compares the personal library in full when the key's note permission changes with no change in the library, and fetches only the notes it gains",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const withoutNotes = {
            user: { library: true, notes: false },
            groups: { all: { library: true, write: false } },
          };
          const harness = yield* syncHarness({ access: withoutNotes });
          const expected = harness.pair.records
            .find((record) => record.group === null)!
            .items.filter((item) => item.data.itemType === "note")
            .map((item) => item.key)
            .sort();
          expect(expected.length).toBeGreaterThan(0);
          const notes = () =>
            harness.replica.db
              .all<{ key: string }>(
                sql`select key from items where libraryID = 1
                  and itemID in (select itemID from itemNotes)
                  and itemID not in (select itemID from itemAttachments) order by key`,
              )
              .map((row) => row.key);
          yield* syncAndApply(harness);
          expect(notes()).toEqual([]);

          harness.api.addKey(harness.key, READ_ALL_ACCESS);
          const before = harness.api.requests.length;
          yield* syncAndApply(harness);

          expect(notes()).toEqual(expected);
          expect(
            fetchedKeys(
              harness.api.requests.slice(before).filter(inLibrary(USER)),
            ).sort(),
          ).toEqual(expected);
          const settled = harness.api.requests.length;
          yield* syncAndApply(harness);
          expect(
            harness.api.requests
              .slice(settled)
              .filter(inLibrary(USER))
              .map((request) => request.path),
          ).toEqual([`${USER}/settings`]);

          harness.api.addKey(harness.key, withoutNotes);
          yield* syncAndApply(harness);

          expect(notes()).toEqual([]);
        }),
      ),
  );

  it.effect(
    "deletes a key that is deleted and created again between two syncs, as the desktop client does, so it is in both the version map and the deletion list",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          harness.api.user.putItem({
            key: "AGAIN001",
            itemType: "book",
            title: "Created",
          });
          yield* syncAndApply(harness);
          harness.api.user.deleteItem("AGAIN001");
          harness.api.user.putItem({
            key: "AGAIN001",
            itemType: "book",
            title: "Created again",
          });

          yield* syncAndApply(harness);

          expect(titleIn(harness, "user", "AGAIN001")).toBeUndefined();
        }),
      ),
  );

  it.effect(
    "discards a staged pass made under another note permission before it reuses the staging, so a key without note access never applies staged notes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const notes = () =>
            harness.replica.db
              .all<{ key: string }>(
                sql`select key from items where libraryID = 1
                  and itemID in (select itemID from itemNotes)
                  and itemID not in (select itemID from itemAttachments)`,
              )
              .map((row) => row.key);
          const staged = yield* harness.download();
          expect(staged.needsApply).toBe(true);
          harness.api.addKey(harness.key, {
            user: { library: true, notes: false },
            groups: { all: { library: true, write: false } },
          });

          yield* syncAndApply(harness);

          expect(notes()).toEqual([]);
          expect(itemsIn(harness, "user").length).toBeGreaterThan(0);
        }),
      ),
  );

  it.effect(
    "applies no pass that a rebuild staged when the next sync is incremental and every library fails",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          const before = libraryVersions(harness.replica.db);
          harness.api.user.updateItem(firstItem(harness, "user").key, {
            title: "Changed for the rebuild",
          });
          harness.api.inject({
            match: (request) => request.path === `${GROUP}/settings`,
            answer: { status: 400, body: "Bad request" },
          });
          const rebuilt = yield* downloadReplica(harness.replica.db, {
            apiKey: Redacted.make(harness.key),
            fetch: (url, init) => globalThis.fetch(url, init),
            baseUrl: harness.server.url,
            rebuild: true,
          });
          expect(rebuilt.libraries.map((library) => library.outcome)).toEqual([
            "staged",
            "failed",
          ]);
          for (const path of [`${USER}/settings`, `${GROUP}/settings`])
            harness.api.inject({
              match: (request) => request.path === path,
              answer: { status: 400, body: "Bad request" },
            });

          const report = yield* harness.download();

          expect(report.libraries.map((library) => library.outcome)).toEqual([
            "failed",
            "failed",
          ]);
          expect(report.needsApply).toBe(false);
          harness.apply();
          expect(libraryVersions(harness.replica.db)).toEqual(before);
        }),
      ),
  );

  it.effect(
    "replaces a replica in a rebuild to another language row for row as a fresh build in that language makes it, after many server changes and an item whose new type the vocabulary lacks (apart from the interned relation predicates, which the replica never purges)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const now = Temporal.Instant.from("2026-11-27T12:00:00Z");
          const download = (db: ReplicaClient["db"], rebuild = false) =>
            downloadReplica(db, {
              apiKey: Redacted.make(harness.key),
              fetch: (url, init) => globalThis.fetch(url, init),
              baseUrl: harness.server.url,
              rebuild,
            });
          yield* download(harness.replica.db);
          applyDownload(harness.replica.db, { now, locale: "en-US" });
          const user = harness.api.user;
          const records = harness.pair.records.find(
            (record) => record.group === null,
          )!.items;
          const parent = records.find(
            (item) =>
              !item.data.parentItem &&
              records.some((child) => child.data.parentItem === item.key),
          )!;
          const others = records.filter(
            (item) =>
              !item.data.parentItem &&
              item.key !== parent.key &&
              item.data.itemType !== "note" &&
              item.data.itemType !== "attachment",
          );
          user.updateItem(parent.key, {
            itemType: "unknownFutureType",
            date: "01/02/2020",
          });
          user.updateItem(others[0]!.key, { date: "03/04/2021" });
          user.updateItem(others[1]!.key, { title: "Renamed on the web" });
          user.trashItem(others[2]!.key);
          user.deleteItem(others[3]!.key);
          user.putItem({
            key: "NEWBOOK1",
            itemType: "book",
            title: "Added",
            date: "05/06/2022",
          });
          user.putItem({
            key: "NEWNOTE1",
            itemType: "note",
            note: "<p>New note</p>",
            parentItem: "NEWBOOK1",
          });
          harness.api
            .library({ type: "group", id: GROUP_ID })
            .updateItem(firstItem(harness, "group").key, {
              date: "07/08/2019",
            });

          yield* download(harness.replica.db, true);
          applyDownload(harness.replica.db, {
            now,
            locale: "en-GB",
            replacesLocale: true,
          });
          const fresh = openNodeReplica();
          try {
            createReplica(fresh.db);
            yield* download(fresh.db);
            applyDownload(fresh.db, { now, locale: "en-GB" });

            expect(replicaRows(harness.replica.db)).toEqual(
              replicaRows(fresh.db),
            );
          } finally {
            fresh.close();
          }
        }),
      ),
  );

  it.effect(
    "keeps a rebuilt replica row for row equal to a fresh build of the same server after each step: a parent of a note gets a type the vocabulary lacks, an incremental sync skips it, a rebuild, the parent returns",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const now = Temporal.Instant.from("2026-11-27T12:00:00Z");
          const download = (db: ReplicaClient["db"], rebuild = false) =>
            downloadReplica(db, {
              apiKey: Redacted.make(harness.key),
              fetch: (url, init) => globalThis.fetch(url, init),
              baseUrl: harness.server.url,
              rebuild,
            });
          const sameAsFresh = (locale: string) =>
            Effect.gen(function* () {
              const fresh = openNodeReplica();
              try {
                createReplica(fresh.db);
                yield* download(fresh.db);
                applyDownload(fresh.db, { now, locale });
                expect(replicaRows(harness.replica.db)).toEqual(
                  replicaRows(fresh.db),
                );
              } finally {
                fresh.close();
              }
            });
          const user = harness.api.user;
          user.putItem({
            key: "PARENT01",
            itemType: "book",
            title: "A parent",
            date: "01/02/2020",
          });
          user.putItem({
            key: "CHILD001",
            itemType: "note",
            note: "<p>A child note</p>",
            parentItem: "PARENT01",
          });
          user.putSetting(`lastRead_g${GROUP_ID}_PDF2GRUP`, 1700000400);
          const groupReadTime = () =>
            harness.replica.db.get<{ lastRead: number | null }>(
              sql`select a.lastRead from itemAttachments a join items i using (itemID)
                join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = 'PDF2GRUP'`,
            )?.lastRead;
          yield* download(harness.replica.db);
          applyDownload(harness.replica.db, { now, locale: "en-US" });

          user.updateItem("PARENT01", { itemType: "unknownFutureType" });
          yield* download(harness.replica.db);
          applyDownload(harness.replica.db, { now, locale: "en-US" });
          expect(titleIn(harness, "user", "PARENT01")).toBe("A parent");

          yield* download(harness.replica.db, true);
          applyDownload(harness.replica.db, {
            now,
            locale: "en-GB",
            replacesLocale: true,
          });
          yield* sameAsFresh("en-GB");
          expect(groupReadTime()).toBe(1700000400);

          user.updateItem("PARENT01", { itemType: "book" });
          yield* download(harness.replica.db);
          applyDownload(harness.replica.db, { now, locale: "en-GB" });
          yield* sameAsFresh("en-GB");
          expect(titleIn(harness, "user", "PARENT01")).toBe("A parent");
        }),
      ),
  );

  it.effect(
    "applies only the passes that the present sync confirmed: a pass that an earlier sync completed waits while its library fails",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          const before = libraryVersions(harness.replica.db);
          const item = firstItem(harness, "user").key;
          harness.api.user.updateItem(item, { title: "Staged, not applied" });
          expect((yield* harness.download()).needsApply).toBe(true);
          harness.api.user.deleteItem(item);
          harness.api.inject({
            match: (request) => request.path === `${USER}/settings`,
            answer: { status: 400, body: "Bad request" },
          });

          const report = yield* harness.download();

          expect(report.libraries.map((library) => library.outcome)).toEqual([
            "failed",
            "unchanged",
          ]);
          expect(report.needsApply).toBe(false);
          harness.apply();
          expect(libraryVersions(harness.replica.db)).toEqual(before);

          yield* syncAndApply(harness);
          expect(titleIn(harness, "user", item)).toBeUndefined();
        }),
      ),
  );

  it.effect(
    "stores the read time of a group attachment that arrives after the personal setting that names it: in a first build, a rebuild in another language, and when the key reads the group later",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const personalOnly = {
            user: { library: true, notes: true },
            groups: {},
          };
          const harness = yield* syncHarness({ access: personalOnly });
          const now = Temporal.Instant.from("2026-11-27T12:00:00Z");
          const setting = `lastRead_g${GROUP_ID}_PDF2GRUP`;
          harness.api.user.putSetting(setting, 1700000200);
          const lastRead = () =>
            harness.replica.db.get<{ lastRead: number | null }>(
              sql`select a.lastRead from itemAttachments a join items i using (itemID)
                join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = 'PDF2GRUP'`,
            )?.lastRead ?? null;
          yield* syncAndApply(harness);
          expect(lastRead()).toBeNull();

          harness.api.addKey(harness.key, READ_ALL_ACCESS);
          yield* syncAndApply(harness);
          expect(lastRead()).toBe(1700000200);

          yield* downloadReplica(harness.replica.db, {
            apiKey: Redacted.make(harness.key),
            fetch: (url, init) => globalThis.fetch(url, init),
            baseUrl: harness.server.url,
            rebuild: true,
          });
          applyDownload(harness.replica.db, {
            now,
            locale: "en-GB",
            replacesLocale: true,
          });
          expect(lastRead()).toBe(1700000200);

          const fresh = openNodeReplica();
          try {
            createReplica(fresh.db);
            yield* downloadReplica(fresh.db, {
              apiKey: Redacted.make(harness.key),
              fetch: (url, init) => globalThis.fetch(url, init),
              baseUrl: harness.server.url,
            });
            applyDownload(fresh.db, { now, locale: "en-GB" });
            expect(
              fresh.db.get<{ lastRead: number | null }>(
                sql`select a.lastRead from itemAttachments a join items i using (itemID)
                  join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = 'PDF2GRUP'`,
              )?.lastRead,
            ).toBe(1700000200);
          } finally {
            fresh.close();
          }
        }),
      ),
  );

  it.effect("syncs only the libraries that the key reads", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness({
          access: { user: { library: true }, groups: {} },
        });
        const { report } = yield* syncAndApply(harness);
        expect(report.libraries.map((library) => library.library)).toEqual([
          { type: "user", id: PARITY_USER.userID },
        ]);
        expect(Object.keys(readerView(harness.replica.db))).toEqual(["user"]);
        expect(
          harness.api.requests.some((request) =>
            request.path.startsWith("/groups"),
          ),
        ).toBe(false);
      }),
    ),
  );

  it.effect(
    "discards the staged pass of a group that the key no longer reads before it is applied",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const personalOnly = {
            user: { library: true, notes: true },
            groups: {},
          };
          const harness = yield* syncHarness({ access: personalOnly });
          yield* syncAndApply(harness);
          harness.api.addKey(harness.key, READ_ALL_ACCESS);
          const granted = yield* harness.download();
          expect(granted.libraries).toContainEqual(
            expect.objectContaining({
              library: { type: "group", id: GROUP_ID },
              outcome: "staged",
            }),
          );
          harness.api.addKey(harness.key, personalOnly);

          const report = yield* harness.download();

          expect(report.libraries.map((library) => library.outcome)).toEqual([
            "unchanged",
          ]);
          expect(report.needsApply).toBe(false);
          harness.apply();
          expect(Object.keys(readerView(harness.replica.db))).toEqual(["user"]);
        }),
      ),
  );

  it.effect(
    "cancels the staged removal of a group that the key reads again",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          harness.api.addKey(harness.key, {
            user: { library: true, notes: true },
            groups: {},
          });
          const revoked = yield* harness.download();
          expect(revoked.libraries).toContainEqual({
            library: { type: "group", id: GROUP_ID },
            outcome: "removed",
          });
          harness.api.addKey(harness.key, READ_ALL_ACCESS);

          const report = yield* harness.download();

          expect(report.libraries.map((library) => library.outcome)).toEqual([
            "unchanged",
            "unchanged",
          ]);
          expect(report.needsApply).toBe(false);
          harness.apply();
          expect(Object.keys(readerView(harness.replica.db)).sort()).toEqual(
            ["group:4815", "user"].sort(),
          );
        }),
      ),
  );

  it.effect(
    "fails the sync on a group list shorter than its Total-Results, and keeps the group and its staged pass",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          const changed = firstItem(harness, "group");
          harness.api
            .library({ type: "group", id: GROUP_ID })
            .updateItem(changed.key, { title: "A staged group title" });
          yield* harness.download();
          const staging = () =>
            harness.replica.db.all(
              sql`select l.libraryType, l.remoteID, l.state, l.targetVersion, count(o.key) as objects
                from replicaSyncLibraries l left join replicaSyncObjects o using (libraryType, remoteID)
                group by l.libraryType, l.remoteID order by l.libraryType, l.remoteID`,
            );
          const staged = staging();
          expect(staged).toContainEqual(
            expect.objectContaining({
              libraryType: "group",
              remoteID: GROUP_ID,
              state: "complete",
            }),
          );
          harness.api.inject({
            match: (request) => request.path === `${USER}/groups`,
            answer: {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Total-Results": "1",
              },
              body: "{}",
            },
          });

          const error = yield* Effect.flip(harness.download());

          expect(error).toMatchObject({
            _tag: "WebApiProtocolError",
            path: `${USER}/groups`,
            reason: "truncated",
          });
          expect(staging()).toEqual(staged);
          expect(Object.keys(readerView(harness.replica.db))).toContain(
            `group:${GROUP_ID}`,
          );
          harness.apply();
          expect(titleIn(harness, `group:${GROUP_ID}`, changed.key)).toBe(
            "A staged group title",
          );
        }),
      ),
  );

  it.effect("removes a group library that the key no longer reads", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        yield* syncAndApply(harness);
        const libraryID = Number(
          harness.replica.db.get<{ libraryID: number }>(
            sql`select libraryID from groups where groupID = ${GROUP_ID}`,
          )!.libraryID,
        );
        harness.api.leaveGroup(GROUP_ID);

        const { report, applied } = yield* syncAndApply(harness);

        expect(report.libraries).toContainEqual({
          library: { type: "group", id: GROUP_ID },
          outcome: "removed",
        });
        expect(
          applied.find((library) => library.outcome === "removed")?.removed,
        ).toBeGreaterThan(0);
        expect(Object.keys(readerView(harness.replica.db))).toEqual(["user"]);
        for (const table of ["items", "collections"] as const) {
          expect(
            harness.replica.db.all(
              sql`select 1 from ${sql.identifier(table)} where libraryID = ${libraryID}`,
            ),
          ).toEqual([]);
        }
        expect(harness.replica.db.all(sql`pragma foreign_key_check`)).toEqual(
          [],
        );
        expect(
          harness.replica.db.all(
            sql`select value from itemDataValues where valueID not in (select valueID from itemData)`,
          ),
        ).toEqual([]);
      }),
    ),
  );

  it.effect(
    "removes the personal library's items, collections, tags and read times when the key of the same account reads only groups, and downloads them again in full when it reads the personal library again",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const setting = `lastRead_g${GROUP_ID}_PDF2GRUP`;
          yield* syncAndApply(harness);
          harness.api.user.putSetting(setting, 1700000100);
          yield* syncAndApply(harness);
          const lastRead = () =>
            harness.replica.db.get<{ lastRead: number | null }>(
              sql`select a.lastRead from itemAttachments a join items i using (itemID)
                join groups g using (libraryID) where g.groupID = ${GROUP_ID} and i.key = 'PDF2GRUP'`,
            )?.lastRead ?? null;
          expect(lastRead()).toBe(1700000100);
          const full = readerView(harness.replica.db) as Record<
            string,
            { items: unknown[]; collections: unknown[]; tags: unknown[] }
          >;
          expect(full.user!.items.length).toBeGreaterThan(0);
          expect(full.user!.tags.length).toBeGreaterThan(0);
          const groupItems = itemsIn(harness, `group:${GROUP_ID}`);
          harness.api.addKey(harness.key, {
            groups: { all: { library: true, write: false } },
          });

          const { report, applied } = yield* syncAndApply(harness);

          expect(report.libraries).toContainEqual({
            library: { type: "user", id: PARITY_USER.userID },
            outcome: "removed",
          });
          expect(
            applied.find((library) => library.library.type === "user"),
          ).toMatchObject({ outcome: "removed" });
          const view = readerView(harness.replica.db) as typeof full;
          expect(view.user).toMatchObject({
            items: [],
            collections: [],
            tags: [],
            notes: [],
          });
          expect(itemsIn(harness, `group:${GROUP_ID}`).length).toBe(
            groupItems.length,
          );
          expect(lastRead()).toBeNull();
          expect(
            readSyncStatus(harness.replica.db).map(
              (library) => library.library.type,
            ),
          ).toEqual(["group"]);
          expect(harness.replica.db.all(sql`pragma foreign_key_check`)).toEqual(
            [],
          );
          expect(
            harness.replica.db.all(
              sql`select value from itemDataValues where valueID not in (select valueID from itemData)`,
            ),
          ).toEqual([]);

          harness.api.addKey(harness.key, READ_ALL_ACCESS);
          yield* syncAndApply(harness);

          expect(data(readerView(harness.replica.db))).toEqual(data(full));
          expect(lastRead()).toBe(1700000100);
        }),
      ),
  );

  it.effect(
    "keeps the API key out of each log line, error text and request record",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const reversed = harness.key.split("").reverse().join("");
          const lines: string[] = [];
          const libraryLines: string[] = [];
          setLibraryLogSink((record) =>
            libraryLines.push(JSON.stringify(record)),
          );
          const capture = Logger.layer([
            Logger.map(Logger.formatJson, (line) => {
              lines.push(line);
            }),
          ]);
          const texts: string[] = [];
          const run = (effect: ReturnType<SyncHarness["download"]>) =>
            Effect.gen(function* () {
              const exit = yield* driven(Effect.exit(effect));
              texts.push(JSON.stringify(exit));
              if (Exit.isFailure(exit)) texts.push(Cause.pretty(exit.cause));
              else texts.push(JSON.stringify(exit.value));
            }).pipe(Effect.provide(capture));

          harness.api.inject({
            match: (request) => request.path === `${USER}/settings`,
            answer: {
              status: 429,
              headers: { "Retry-After": "0", Backoff: "0" },
            },
          });
          harness.api.inject({
            match: (request) => request.path === `${GROUP}/deleted`,
            times: 3,
            answer: { status: 500, body: "Internal error" },
          });
          yield* run(harness.download());
          yield* run(harness.download(reversed));
          const revoked = harness.key;
          harness.api.revokeKey(revoked);
          yield* run(harness.download(revoked));
          harness.api.addKey(revoked, { user: { library: true } });
          yield* Effect.promise(() => harness.server.close());
          yield* run(harness.download(revoked));
          setLibraryLogSink(undefined);

          expect(lines.length).toBeGreaterThan(0);
          expect(
            texts.some((text) => text.includes("WebApiNetworkError")),
          ).toBe(true);
          expect(texts.some((text) => text.includes("WebApiKeyInvalid"))).toBe(
            true,
          );
          const everything = [
            ...lines,
            ...libraryLines,
            ...texts,
            JSON.stringify(harness.api.requests),
          ].join("\n");
          expect(everything.includes(revoked)).toBe(false);
          expect(everything.includes(reversed)).toBe(false);
        }),
      ),
  );
});

const require = createRequire(import.meta.url);
const sqliteWasm = await loadSqliteWasm({
  wasm: readFileSync(require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")),
  storage: "memory",
});
let wasmFiles = 0;
const openWasmReplica = (): ReplicaClient => {
  const database = openWasmClient(sqliteWasm, {
    file: `/sync-${++wasmFiles}.sqlite`,
  });
  return { db: database.db, close: () => database.close() };
};

describe("downloadReplica on the sqlite-wasm driver", () => {
  it.effect(
    "builds the replica and brings an incremental change to the readers",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness({ openReplica: openWasmReplica });
          yield* syncAndApply(harness);
          expect(data(readerView(harness.replica.db))).toEqual(
            data(readerView(harness.pair.replica.db)),
          );
          const item = firstItem(harness, "group");
          harness.api
            .library({ type: "group", id: GROUP_ID })
            .updateItem(item.key, {
              title: "Changed on the web",
            });
          yield* syncAndApply(harness);
          expect(titleIn(harness, `group:${GROUP_ID}`, item.key)).toBe(
            "Changed on the web",
          );
          expect(libraryVersions(harness.replica.db)[`group:${GROUP_ID}`]).toBe(
            harness.api.library({ type: "group", id: GROUP_ID }).version,
          );
        }),
      ),
  );
});

const isItemBatch = (request: FakeRequest) =>
  request.path === `${USER}/items` && request.query.itemKey !== undefined;

describe("downloadReplica at the edges of a pass", () => {
  it.effect("accepts any account on a replica that has none", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        const other = newApiKey();
        harness.api.addKey(
          other,
          { user: { library: true } },
          { userID: 99, username: "other" },
        );
        const report = yield* harness.download(other);
        expect(report.account).toEqual({ userID: 99, username: "other" });
        expect(report.libraries.map((library) => library.library)).toEqual([
          { type: "user", id: 99 },
        ]);
      }),
    ),
  );

  for (const [where, match] of [
    ["an object batch", isItemBatch],
    [
      "the deletion list",
      (request: FakeRequest) => request.path === `${USER}/deleted`,
    ],
  ] as const) {
    it.effect(
      `starts the pass again when ${where} shows a newer library version`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const harness = yield* syncHarness();
            yield* syncAndApply(harness);
            const item = firstItem(harness, "user");
            harness.api.user.updateItem(item.key, { title: "Before" });
            harness.api.inject({
              match,
              before: (api) =>
                api.user.updateItem(item.key, { title: "After" }),
            });
            harness.api.clearRequests();
            const { report } = yield* driven(syncAndApply(harness));
            expect(
              harness.api.requests.filter(
                (request) => request.path === `${USER}/settings`,
              ),
            ).toHaveLength(2);
            expect(report.libraries[0]).toMatchObject({
              outcome: "staged",
              version: harness.api.user.version,
            });
            expect(titleIn(harness, "user", item.key)).toBe("After");
          }),
        ),
    );
  }

  it.effect(
    "fails the library as changing after five passes, with growing waits between them",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const item = firstItem(harness, "user");
          harness.api.inject({
            match: (request) =>
              request.path === `${USER}/items` &&
              request.query.format === "versions",
            times: 5,
            before: (api) => api.user.updateItem(item.key, { title: "Busy" }),
          });
          const stamped = yield* stampedFetch();
          const signals = logSignals(stamped.mark);
          const fiber = yield* Effect.forkChild(
            signals.provide(harness.download(harness.key, stamped.fetch)),
            { startImmediately: true },
          );
          for (const [index, seconds] of [2, 4, 8, 16].entries()) {
            yield* signals.until("the pass starts again", index + 1);
            yield* stamped.waitsExactly(
              "the pass starts again",
              index + 1,
              seconds,
            );
          }
          const report = yield* Fiber.join(fiber);
          expect(report.libraries[0]).toMatchObject({
            outcome: "failed",
            error: { _tag: "WebApiProtocolError", reason: "libraryChanging" },
          });
        }),
      ),
  );

  it.effect(
    "compares the library in full when the deletion log starts after the stored version",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          const records = harness.pair.records.find(
            (record) => record.group === null,
          )!;
          const tops = records.items.filter(
            (item) => !item.data.parentItem && item.data.itemType !== "note",
          );
          const [changed, gone, trashed] = [tops[0]!, tops[1]!, tops[2]!];
          const committed = String(libraryVersions(harness.replica.db).user);
          harness.api.user.updateItem(changed.key, { title: "Reconciled" });
          harness.api.user.deleteItem(gone.key);
          harness.api.user.trashItem(trashed.key);
          harness.api.user.deleteLogStart = harness.api.user.version;
          harness.api.clearRequests();

          const { report } = yield* syncAndApply(harness);

          expect(report.libraries[0]).toMatchObject({ outcome: "staged" });
          expect(
            harness.api.requests
              .filter(
                (request) =>
                  request.path.startsWith(`${USER}/`) &&
                  request.path !== `${USER}/groups` &&
                  request.query.format === "versions",
              )
              .map((request) => request.query.since),
          ).toEqual([committed, committed, "0", "0"]);
          expect(
            harness.api.requests.some(
              (request) =>
                request.path === `${USER}/deleted` && request.status === 409,
            ),
          ).toBe(true);
          expect(
            fetchedKeys(harness.api.requests.filter(isItemBatch)).sort(),
          ).toEqual([changed.key, trashed.key].sort());
          expect(
            harness.replica.db.all(
              sql`select i.key from deletedItems d join items i using (itemID) where i.libraryID = 1 and i.key = ${trashed.key}`,
            ),
          ).toEqual([{ key: trashed.key }]);
          expect(titleIn(harness, "user", changed.key)).toBe("Reconciled");
          expect(
            harness.replica.db.all(
              sql`select key from items where libraryID = 1 and key = ${gone.key}`,
            ),
          ).toEqual([]);
          expect(libraryVersions(harness.replica.db).user).toBe(
            harness.api.user.version,
          );
        }),
      ),
  );

  it.effect(
    "fails the library when an answer holds fewer objects than Total-Results and no new one",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          harness.api.inject({ match: isItemBatch, truncate: 0 });
          const report = yield* harness.download();
          expect(report.libraries[0]).toMatchObject({
            outcome: "failed",
            error: { _tag: "WebApiProtocolError", reason: "truncated" },
          });
        }),
      ),
  );

  it.effect(
    "applies changed group metadata of an unchanged group library",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          yield* syncAndApply(harness);
          const group = harness.api.library({ type: "group", id: GROUP_ID });
          group.group = {
            ...group.group!,
            version: group.group!.version + 1,
            data: {
              ...group.group!.data,
              version: group.group!.version + 1,
              name: "Renamed group",
            },
          };
          harness.api.clearRequests();

          const { report } = yield* syncAndApply(harness);

          expect(
            harness.api.requests.find(
              (request) => request.path === `${GROUP}/settings`,
            ),
          ).toMatchObject({ status: 304 });
          expect(report.libraries[1]).toMatchObject({
            outcome: "staged",
            fetched: 0,
          });
          const view = readerView(harness.replica.db) as Record<
            string,
            { library: { name: string } }
          >;
          expect(view[`group:${GROUP_ID}`]!.library.name).toBe("Renamed group");
        }),
      ),
  );

  it.effect("fails only the group library whose record cannot be read", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        harness.api.inject({
          match: (request) => request.path === GROUP,
          answer: {
            status: 200,
            body: "{}",
            headers: { "Content-Type": "application/json" },
          },
        });
        const report = yield* harness.download();
        expect(report.libraries.map((library) => library.outcome)).toEqual([
          "staged",
          "failed",
        ]);
        expect(report.libraries[1]).toMatchObject({
          error: { _tag: "WebApiProtocolError", reason: "body" },
        });
      }),
    ),
  );

  it.effect(
    "runs a request again after a 5xx answer and after a network error",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          harness.api.inject({
            match: (request) => request.path === `${USER}/settings`,
            answer: { status: 502, body: "Bad gateway" },
          });
          let dropped = 0;
          const report = yield* driven(
            harness.download(harness.key, (url, init) =>
              url.includes("/collections") && dropped++ === 0
                ? Promise.reject(new TypeError("fetch failed"))
                : globalThis.fetch(url, init),
            ),
          );
          expect(report.libraries.map((library) => library.outcome)).toEqual([
            "staged",
            "staged",
          ]);
          expect(
            harness.api.requests
              .filter((request) => request.path === `${USER}/settings`)
              .map((request) => request.status),
          ).toEqual([502, 200]);
          expect(dropped).toBeGreaterThan(1);
        }),
      ),
  );

  it.effect(
    "refuses a key that no header can carry before any request, and names none of it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const malformed = "invented0key\nwith0newline";
          const exit = yield* Effect.exit(harness.download(malformed));
          expect(exit).toMatchObject({
            _tag: "Failure",
            cause: {
              reasons: [{ error: { _tag: "WebApiKeyInvalid" } }],
            },
          });
          expect(
            Cause.pretty((exit as Exit.Failure<unknown, unknown>).cause),
          ).not.toContain("invented0key");
          expect(harness.api.requests).toEqual([]);
        }),
      ),
  );

  it.effect("names no text of a failed request that carried the key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        const exit = yield* Effect.exit(
          driven(
            harness.download(harness.key, () =>
              Promise.reject(
                new TypeError(`Invalid header value: ${harness.key}`),
              ),
            ),
          ),
        );
        expect(exit._tag).toBe("Failure");
        const text = Cause.pretty(
          (exit as Exit.Failure<unknown, unknown>).cause,
        );
        expect(text).toContain("WebApiNetworkError");
        expect(text).toContain("TypeError");
        expect(text).not.toContain(harness.key);
      }),
    ),
  );

  it.effect(
    "refuses a redirect to another address, so the key never leaves the Zotero address",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          const received: IncomingHttpHeaders[] = [];
          const other = createServer((incoming, outgoing) => {
            received.push(incoming.headers);
            outgoing.writeHead(403).end();
          });
          yield* Effect.acquireRelease(
            Effect.promise(
              () =>
                new Promise<void>((resolve) =>
                  other.listen(0, "127.0.0.1", resolve),
                ),
            ),
            () =>
              Effect.promise(
                () =>
                  new Promise<void>((resolve) => other.close(() => resolve())),
              ),
          );
          const { port } = other.address() as AddressInfo;
          harness.api.inject({
            match: (request) => request.path === "/keys/current",
            times: 3,
            answer: {
              status: 302,
              headers: { Location: `http://127.0.0.1:${port}/keys/current` },
            },
          });

          const error = yield* Effect.flip(driven(harness.download()));

          expect(error).toMatchObject({
            _tag: "WebApiNetworkError",
            path: "/keys/current",
          });
          expect(
            harness.api.requests.filter(
              (request) => request.path === "/keys/current",
            ),
          ).toHaveLength(3);
          expect(received).toEqual([]);
        }),
      ),
  );

  it.effect("fails a library after three failed attempts of one request", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* syncHarness();
        harness.api.inject({
          match: (request) => request.path === `${USER}/settings`,
          times: 3,
          answer: { status: 500 },
        });
        const report = yield* driven(harness.download());
        expect(report.libraries[0]).toMatchObject({
          outcome: "failed",
          error: { _tag: "WebApiProtocolError", reason: "status", status: 500 },
        });
      }),
    ),
  );

  it.effect(
    "applies a library larger than one page, with children before parents, as one apply",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* syncHarness();
          for (let index = 0; index < 12; index++) {
            const parent = `Z${String(index).padStart(7, "0")}`;
            const attachment = `M${String(index).padStart(7, "0")}`;
            harness.api.user.putCollection({
              key: `Y${String(index).padStart(7, "0")}`,
              name: `Child collection ${index}`,
              parentCollection: `X${String(index).padStart(7, "0")}`,
            });
            harness.api.user.putCollection({
              key: `X${String(index).padStart(7, "0")}`,
              name: `Parent collection ${index}`,
              parentCollection: false,
            });
            harness.api.user.putItem({
              key: `A${String(index).padStart(7, "0")}`,
              ...FIXED_DATES,
              itemType: "annotation",
              parentItem: attachment,
              annotationType: "highlight",
              annotationText: `Text ${index}`,
              annotationColor: "#ffd400",
              annotationSortIndex: "00000|000000|00000",
              annotationPosition: '{"pageIndex":0,"rects":[[0,0,1,1]]}',
            });
            harness.api.user.putItem({
              key: attachment,
              ...FIXED_DATES,
              itemType: "attachment",
              parentItem: parent,
              linkMode: "imported_file",
              contentType: "application/pdf",
              filename: `file-${index}.pdf`,
            });
            harness.api.user.putItem({
              key: parent,
              ...FIXED_DATES,
              itemType: "book",
              title: `Book ${index}`,
              collections: [`Y${String(index).padStart(7, "0")}`],
            });
          }
          yield* harness.download();
          const paged = harness.apply({ pageSize: 3 });
          expect(
            paged.flatMap((library) => [
              ...library.deferred,
              ...library.skipped,
            ]),
          ).toEqual([]);
          const reference = yield* syncHarness();
          reference.api.user.version = 0;
          for (const [key, stored] of harness.api.user.items)
            reference.api.user.items.set(key, stored);
          for (const [key, stored] of harness.api.user.collections)
            reference.api.user.collections.set(key, stored);
          reference.api.user.version = harness.api.user.version;
          yield* syncAndApply(reference);
          expect(data(readerView(harness.replica.db))).toEqual(
            data(readerView(reference.replica.db)),
          );
          expect(
            harness.replica.db.all(
              sql`select count(*) as n from replicaSyncObjects`,
            ),
          ).toEqual([{ n: 0 }]);
          expect(
            Number(
              harness.replica.db.get<{ n: number }>(
                sql`select count(*) as n from itemAnnotations a join items i using (itemID) where i.key like 'A0%' and i.libraryID = 1`,
              )!.n,
            ),
          ).toBe(12);
        }),
      ),
  );
});
