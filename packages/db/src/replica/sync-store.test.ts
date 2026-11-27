import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { WebApiItem } from "@zotlit/zotero-types/web-api";

import { openNodeReplica, openParityPair } from "./__fixtures__/parity.ts";
import { stagingViolations } from "./__fixtures__/staging-invariants.ts";
import { createReplica } from "./create.ts";
import {
  applyStagedPasses,
  applyStagedSteps,
  beginLibraryPass,
  completeLibraryPass,
  readSyncStatus,
  ReplicaLanguageMismatch,
  replicaLocale,
  stageObjects,
  stageSettings,
  storedGroupLastReadSettings,
} from "./sync-store.ts";
import { ensureSyncTables, SYNC_TABLES } from "./sync-tables.ts";

import { checkDatabaseLayout } from "#item-query/layout.ts";

const NOW = Temporal.Instant.from("2026-11-26T12:00:00Z");

function stageUserLibrary(pair: ReturnType<typeof openParityPair>) {
  const { db } = pair.replica;
  const user = pair.records.find((record) => record.group === null)!;
  const library = { type: "user", id: user.library.id } as const;
  beginLibraryPass(db, { library, sinceVersion: 0, targetVersion: 99 });
  stageObjects(db, library, {
    collections: user.collections.map((collection) => ({
      ...collection,
      version: 99,
      data: { ...collection.data, version: 99 },
    })),
    items: user.items.slice(0, -1).map((item) => ({
      ...item,
      version: 99,
      data: { ...item.data, version: 99 },
    })),
  });
  completeLibraryPass(db, library, {
    collections: [],
    items: [user.items.at(-1)!.key],
  });
  return user.collections.length + user.items.length;
}

function snapshot(db: ReturnType<typeof openParityPair>["replica"]["db"]) {
  return {
    items: db.all(sql`select key, version from items order by key`),
    values: db.all(sql`select count(*) as n from itemData`),
    library: db.get(sql`select version from libraries where libraryID = 1`),
    staged: db.all(
      sql`select objectType, key, state from replicaSyncObjects order by objectType, key`,
    ),
    deletions: db.all(sql`select key from replicaSyncDeletions order by key`),
    passes: db.all(sql`select remoteID, state from replicaSyncLibraries`),
  };
}

describe("the sync staging of a replica", () => {
  it("adds tables that the layout check of the readers accepts", () => {
    using pair = openParityPair();
    const { db } = pair.replica;
    const tables = db
      .all<{ name: string }>(
        sql`select name from sqlite_schema where type = 'table' and name like 'replicaSync%' order by name`,
      )
      .map((row) => row.name);
    expect(tables).toEqual([...SYNC_TABLES].sort());
    expect(() => checkDatabaseLayout(db)).not.toThrow();
  });

  it("rolls back every library of an apply that fails", () => {
    using pair = openParityPair();
    const { db } = pair.replica;
    const user = pair.records.find((record) => record.group === null)!;
    const item = user.items.find(
      (entry) => typeof entry.data.title === "string",
    )!;
    const library = { type: "user", id: user.library.id } as const;
    beginLibraryPass(db, { library, sinceVersion: 0, targetVersion: 99 });
    stageObjects(db, library, {
      items: [
        {
          ...item,
          version: 99,
          data: { ...item.data, version: 99, title: "Staged title" },
        },
      ],
    });
    completeLibraryPass(db, library, {
      collections: [],
      items: [user.items.at(-1)!.key],
    });
    const unknownGroup = { type: "group", id: 999 } as const;
    beginLibraryPass(db, {
      library: unknownGroup,
      sinceVersion: 0,
      targetVersion: 5,
    });
    completeLibraryPass(db, unknownGroup, { collections: [], items: [] });
    const count = () =>
      Number(db.get<{ n: number }>(sql`select count(*) as n from items`)!.n);
    const before = count();

    expect(() => applyStagedPasses(db, { now: NOW })).toThrow(/group 999/);
    expect(stagingViolations(db)).toEqual([
      { rule: "group-pass-has-record", library: unknownGroup },
    ]);

    expect(
      db.get(sql`select version from libraries where libraryID = 1`),
    ).toEqual({ version: 0 });
    expect(count()).toBe(before);
    expect(
      db.get(
        sql`select state from replicaSyncLibraries where libraryType = 'user'`,
      ),
    ).toEqual({ state: "complete" });
  });

  it("applies the staged passes in steps that report the applied objects of the total, with the result of one call", () => {
    using stepped = openParityPair();
    using whole = openParityPair();
    const total = stageUserLibrary(stepped);
    stageUserLibrary(whole);
    const { db } = stepped.replica;

    const steps: { applied: number; total: number }[] = [];
    const result = db.transaction(() => {
      const run = applyStagedSteps(db, { now: NOW, pageSize: 2 });
      for (;;) {
        const next = run.next();
        if (next.done) return next.value;
        steps.push(next.value);
        expect(stagingViolations(db)).toEqual([]);
      }
    });
    expect(stagingViolations(db, { afterApply: true })).toEqual([]);

    expect(steps.length).toBeGreaterThan(2);
    expect(steps.every((step) => step.total === total)).toBe(true);
    expect(steps.map((step) => step.applied)).toEqual(
      steps.map((step) => step.applied).toSorted((a, b) => a - b),
    );
    expect(steps.at(-1)!.applied).toBe(total);
    expect(result).toEqual(
      applyStagedPasses(whole.replica.db, { now: NOW, pageSize: 2 }),
    );
    expect(snapshot(db)).toEqual(snapshot(whole.replica.db));
  });

  it("plans the order of a parent with 130,000 staged children in bounded steps", () => {
    using pair = openParityPair();
    const { db } = pair.replica;
    const user = pair.records.find((record) => record.group === null)!;
    const library = { type: "user", id: user.library.id } as const;
    beginLibraryPass(db, { library, sinceVersion: 0, targetVersion: 99 });
    db.run(
      sql`with recursive n(i) as (select 0 union all select i + 1 from n where i < 130000)
        insert into replicaSyncObjects (libraryType, remoteID, objectType, key, version, state, parentKey, json)
        select 'user', ${library.id}, 'item', printf('K%07d', i), 99, 'pending',
          case when i = 0 then null else 'K0000000' end,
          json_object('key', printf('K%07d', i), 'version', 99, 'data', json_object('key', printf('K%07d', i), 'version', 99,
            'itemType', 'note', 'note', '', 'parentItem', case when i = 0 then json('false') else 'K0000000' end))
        from n`,
    );
    completeLibraryPass(db, library, { collections: [], items: [] });
    db.run(sql`begin`);
    const steps = applyStagedSteps(db, { now: NOW, pageSize: 1 });
    let planning = 0;
    for (;;) {
      const next = steps.next();
      if (next.done || next.value.applied > 0) break;
      planning++;
    }
    db.run(sql`rollback`);
    expect(planning).toBeGreaterThan(130000 / 5000);
  });

  it("refuses a page size that is not a positive integer", () => {
    using pair = openParityPair();
    stageUserLibrary(pair);
    for (const pageSize of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        applyStagedPasses(pair.replica.db, { now: NOW, pageSize }),
      ).toThrow(RangeError);
    }
  });

  it("keeps the old replica and the staging when the caller rolls back between steps, and a later apply finishes from the staging", () => {
    using pair = openParityPair();
    using whole = openParityPair();
    stageUserLibrary(pair);
    stageUserLibrary(whole);
    const { db } = pair.replica;
    const before = snapshot(db);

    db.run(sql`begin immediate`);
    const run = applyStagedSteps(db, { now: NOW, pageSize: 2 });
    run.next();
    expect(stagingViolations(db)).toEqual([]);
    run.next();
    expect(stagingViolations(db)).toEqual([]);
    run.return([]);
    db.run(sql`rollback`);

    expect(stagingViolations(db)).toEqual([]);
    expect(snapshot(db)).toEqual(before);
    expect(applyStagedPasses(db, { now: NOW })).toEqual(
      applyStagedPasses(whole.replica.db, { now: NOW }),
    );
    expect(stagingViolations(db, { afterApply: true })).toEqual([]);
    expect(snapshot(db)).toEqual(snapshot(whole.replica.db));
  });

  it("leaves no orphan value, creator or tag after an apply in pages that replaces them", () => {
    using pair = openParityPair();
    const { db } = pair.replica;
    stageUserLibrary(pair);
    applyStagedPasses(db, { now: NOW, pageSize: 2 });
    const before = {
      creators: Number(
        db.get<{ n: number }>(sql`select count(*) as n from itemCreators`)!.n,
      ),
    };
    const user = pair.records.find((record) => record.group === null)!;
    const library = { type: "user", id: user.library.id } as const;
    beginLibraryPass(db, { library, sinceVersion: 99, targetVersion: 100 });
    stageObjects(db, library, {
      items: user.items.slice(0, -1).map((item) => ({
        ...item,
        version: 100,
        data: {
          ...item.data,
          version: 100,
          ...(typeof item.data.title === "string"
            ? { title: `${item.data.title} again` }
            : {}),
          creators: [],
          tags: [],
        },
      })),
    });
    completeLibraryPass(db, library, { collections: [], items: [] });

    applyStagedPasses(db, { now: NOW, pageSize: 2 });

    const count = (query: ReturnType<typeof sql>) =>
      Number(db.get<{ n: number }>(query)!.n);
    expect(count(sql`select count(*) as n from itemCreators`)).toBeLessThan(
      before.creators,
    );
    expect(
      count(
        sql`select count(*) as n from itemDataValues where valueID not in (select valueID from itemData)`,
      ),
    ).toBe(0);
    expect(
      count(
        sql`select count(*) as n from creators where creatorID not in (select creatorID from itemCreators)`,
      ),
    ).toBe(0);
    expect(
      count(
        sql`select count(*) as n from tags where tagID not in (select tagID from itemTags)`,
      ),
    ).toBe(0);
  });

  it("keeps the read times of group attachments of a replica made before the committed read times, so the next apply writes them again", () => {
    using pair = openParityPair();
    const { db } = pair.replica;
    const library = {
      type: "user",
      id: pair.records.find((record) => record.group === null)!.library.id,
    } as const;
    const lastRead = () =>
      db.get<{ lastRead: number | null }>(
        sql`select a.lastRead from itemAttachments a join items i using (itemID)
          join groups g using (libraryID) where g.groupID = 4815 and i.key = 'PDF2GRUP'`,
      )!.lastRead;
    db.run(sql`drop table replicaSyncReadTimes`);
    db.run(
      sql`update itemAttachments set lastRead = 1700000300 where itemID = (
        select i.itemID from items i join groups g using (libraryID) where g.groupID = 4815 and i.key = 'PDF2GRUP')`,
    );

    ensureSyncTables(db);
    beginLibraryPass(db, { library, sinceVersion: 0, targetVersion: 0 });
    completeLibraryPass(db, library, { collections: [], items: [] });
    applyStagedPasses(db, { now: NOW });

    expect(storedGroupLastReadSettings(db)).toEqual([
      "lastRead_g4815_PDF2GRUP",
    ]);
    expect(lastRead()).toBe(1700000300);
  });

  it("reports a pass that changes only the read time of a group attachment, and stores 0 as no read time", () => {
    using pair = openParityPair();
    const { db } = pair.replica;
    const library = {
      type: "user",
      id: pair.records.find((record) => record.group === null)!.library.id,
    } as const;
    const lastRead = () =>
      db.get<{ lastRead: number | null }>(
        sql`select a.lastRead from itemAttachments a join items i using (itemID)
          join groups g using (libraryID) where g.groupID = 4815 and i.key = 'PDF2GRUP'`,
      )!.lastRead;
    const pass = (value: number | null) => {
      beginLibraryPass(db, { library, sinceVersion: 0, targetVersion: 0 });
      stageSettings(db, library, {
        lastRead_g4815_PDF2GRUP: value,
        lastRead_g4815_ABSENT22: 5,
      });
      completeLibraryPass(db, library, { collections: [], items: [] });
      return applyStagedPasses(db, { now: NOW }).map(
        ({ applied, removed }) => ({ applied, removed }),
      );
    };
    expect(pass(1700000000)).toEqual([{ applied: 1, removed: 0 }]);
    expect(lastRead()).toBe(1700000000);
    expect(pass(1700000000)).toEqual([{ applied: 0, removed: 0 }]);
    expect(pass(0)).toEqual([{ applied: 1, removed: 0 }]);
    expect(lastRead()).toBeNull();
    expect(db.get(sql`select count(*) as n from replicaSyncSettings`)).toEqual({
      n: 0,
    });
  });

  it("removes a group library in steps of one page each, with no orphan row, also an item with an empty key", () => {
    using pair = openParityPair();
    const { db } = pair.replica;
    db.run(
      sql`insert into replicaSyncLibraries (libraryType, remoteID, state) values ('group', 4815, 'remove')`,
    );
    db.run(
      sql`update items set key = '' where itemID = (select min(itemID) from items where libraryID != 1)`,
    );
    const objects = Number(
      db.get<{ n: number }>(
        sql`select (select count(*) from items where libraryID != 1) + (select count(*) from collections where libraryID != 1) as n`,
      )!.n,
    );
    let steps = 0;
    const [removed] = db.transaction(() => {
      const run = applyStagedSteps(db, { now: NOW, pageSize: 1 });
      for (;;) {
        const next = run.next();
        if (next.done) return next.value;
        steps++;
        expect(stagingViolations(db)).toEqual([]);
      }
    });
    expect(stagingViolations(db, { afterApply: true })).toEqual([]);
    expect(steps).toBeGreaterThanOrEqual(objects);
    expect(removed).toMatchObject({ outcome: "removed" });
    expect(removed!.removed).toBeGreaterThan(0);
    expect(db.all(sql`select * from groups`)).toEqual([]);
    expect(db.all(sql`select libraryID from libraries`)).toEqual([
      { libraryID: 1 },
    ]);
    expect(db.all(sql`select 1 from items where libraryID != 1`)).toEqual([]);
    expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);
    expect(
      db.all(
        sql`select 1 from itemDataValues where valueID not in (select valueID from itemData)`,
      ),
    ).toEqual([]);
  });

  it("reads each two-digit year of a stepped apply by the year of its time, in every slice", () => {
    const replica = openNodeReplica();
    const { db } = replica;
    try {
      createReplica(db);
      const library = { type: "user", id: 7 } as const;
      const keys = ["YEAR0001", "YEAR0002", "YEAR0003"];
      beginLibraryPass(db, { library, sinceVersion: 0, targetVersion: 5 });
      stageObjects(db, library, {
        items: keys.map((key) => ({
          key,
          version: 5,
          library: { type: "user", id: 7, name: "user" },
          data: { key, version: 5, itemType: "book", date: "1/1/30" },
        })),
      });
      completeLibraryPass(db, library, { collections: [], items: [] });
      applyStagedPasses(db, {
        now: Temporal.Instant.from("2031-06-01T00:00:00Z"),
        pageSize: 1,
      });
      expect(
        db.all(
          sql`select v.value from items i join itemData d using (itemID)
            join fieldsCombined f using (fieldID) join itemDataValues v using (valueID)
            where f.fieldName = 'date' order by i.key`,
        ),
      ).toEqual(keys.map(() => ({ value: "2030-01-01 1/1/30" })));
    } finally {
      replica.close();
    }
  });

  it("records the language of the first apply, also the default one, and refuses an apply in another language with no change", () => {
    const replica = openNodeReplica();
    const { db } = replica;
    try {
      createReplica(db);
      const stage = (key: string) => {
        const library = { type: "user", id: 7 } as const;
        beginLibraryPass(db, { library, sinceVersion: 0, targetVersion: 5 });
        stageObjects(db, library, {
          items: [
            {
              key,
              version: 5,
              library: { type: "user", id: 7, name: "user" },
              data: { key, version: 5, itemType: "book", date: "01/02/2020" },
            },
          ],
        });
        completeLibraryPass(db, library, { collections: [], items: [] });
      };
      const dates = () =>
        db.all(
          sql`select i.key, v.value from items i join itemData d using (itemID)
            join fieldsCombined f using (fieldID) join itemDataValues v using (valueID)
            where f.fieldName = 'date' order by i.key`,
        );
      stage("DATE0001");
      applyStagedPasses(db, { now: NOW });
      expect(replicaLocale(db)).toBe("en-US");
      stage("DATE0002");
      const before = dates();
      expect(() =>
        applyStagedPasses(db, { now: NOW, locale: "en-GB" }),
      ).toThrow(ReplicaLanguageMismatch);
      expect(stagingViolations(db)).toEqual([]);
      expect(dates()).toEqual(before);
      expect(replicaLocale(db)).toBe("en-US");
      applyStagedPasses(db, { now: NOW, locale: "en-US" });
      expect(dates()).toEqual([
        { key: "DATE0001", value: "2020-01-02 01/02/2020" },
        { key: "DATE0002", value: "2020-01-02 01/02/2020" },
      ]);
    } finally {
      replica.close();
    }
  });

  it("keeps a deferred and a skipped object staged and applies each when it can", () => {
    const replica = openNodeReplica();
    const { db } = replica;
    try {
      createReplica(db);
      const library = { type: "user", id: 7 } as const;
      const item = (
        key: string,
        version: number,
        data: Record<string, unknown>,
      ): WebApiItem => ({
        key,
        version,
        library: { type: "user", id: 7, name: "user" },
        data: { key, version, itemType: "book", ...data },
      });
      const pass = (
        targetVersion: number,
        items: WebApiItem[],
        deleted: string[] = [],
      ) => {
        beginLibraryPass(db, { library, sinceVersion: 0, targetVersion });
        stageObjects(db, library, { items });
        completeLibraryPass(db, library, { collections: [], items: deleted });
        const [applied] = applyStagedPasses(db, { now: NOW });
        expect(stagingViolations(db, { afterApply: true })).toEqual([]);
        return applied!;
      };
      const staged = () =>
        db.all<{
          key: string;
          state: string;
          vocabularyVersion: number | null;
        }>(
          sql`select key, state, vocabularyVersion from replicaSyncObjects order by key`,
        );
      const vocabulary = Number(
        db.get<{ version: number }>(
          sql`select version from version where schema = 'globalSchema'`,
        )!.version,
      );

      const first = pass(3, [
        item("CHILD001", 2, {
          itemType: "note",
          note: "<p>A note</p>",
          parentItem: "PARENT01",
        }),
        item("UNKNOWN1", 3, { itemType: "spaceship" }),
        item("DOOMED01", 3, {
          itemType: "note",
          note: "<p>B</p>",
          parentItem: "ABSENT01",
        }),
      ]);
      expect(first.deferred.map((problem) => problem.key).sort()).toEqual([
        "CHILD001",
        "DOOMED01",
      ]);
      expect(first.skipped.map((problem) => problem.key)).toEqual(["UNKNOWN1"]);
      expect(staged()).toEqual([
        { key: "CHILD001", state: "deferred", vocabularyVersion: null },
        { key: "DOOMED01", state: "deferred", vocabularyVersion: null },
        { key: "UNKNOWN1", state: "skipped", vocabularyVersion: vocabulary },
      ]);
      expect(
        db.get(sql`select version from libraries where libraryID = 1`),
      ).toEqual({ version: 3 });
      expect(readSyncStatus(db)[0]!.retained).toEqual({
        deferred: 2,
        skipped: 1,
      });

      const second = pass(
        5,
        [item("PARENT01", 5, { title: "A parent" })],
        ["DOOMED01"],
      );
      expect(second.skipped).toEqual([]);
      expect(second.deferred).toEqual([]);
      expect(db.all(sql`select key from items order by key`)).toEqual([
        { key: "CHILD001" },
        { key: "PARENT01" },
      ]);
      expect(staged()).toEqual([
        { key: "UNKNOWN1", state: "skipped", vocabularyVersion: vocabulary },
      ]);
      expect(
        db.get(sql`select version from libraries where libraryID = 1`),
      ).toEqual({ version: 5 });
    } finally {
      replica.close();
    }
  });

  it("defers the collections of a parent cycle and applies the rest", () => {
    const replica = openNodeReplica();
    const { db } = replica;
    try {
      createReplica(db);
      const library = { type: "user", id: 7 } as const;
      const collection = (key: string, parentCollection: string | false) => ({
        key,
        version: 2,
        library: { type: "user" as const, id: 7, name: "user" },
        data: { key, version: 2, name: key, parentCollection },
      });
      beginLibraryPass(db, { library, sinceVersion: 0, targetVersion: 2 });
      stageObjects(db, library, {
        collections: [
          collection("CYCLEAAA", "CYCLEBBB"),
          collection("CYCLEBBB", "CYCLEAAA"),
          collection("UNDERAAA", "CYCLEAAA"),
          collection("PLAINAAA", false),
        ],
      });
      completeLibraryPass(db, library, { collections: [], items: [] });

      const [applied] = applyStagedPasses(db, { now: NOW, pageSize: 2 });

      expect(applied!.applied).toBe(1);
      expect(applied!.deferred.map((problem) => problem.key).sort()).toEqual([
        "CYCLEAAA",
        "CYCLEBBB",
        "UNDERAAA",
      ]);
      expect(db.all(sql`select key from collections`)).toEqual([
        { key: "PLAINAAA" },
      ]);
      expect(
        db.all(sql`select key, state from replicaSyncObjects order by key`),
      ).toEqual([
        { key: "CYCLEAAA", state: "deferred" },
        { key: "CYCLEBBB", state: "deferred" },
        { key: "UNDERAAA", state: "deferred" },
      ]);
    } finally {
      replica.close();
    }
  });
});
