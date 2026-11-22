import { beforeEach, expect, it } from "vitest";

import {
  BULK_LIBRARY,
  bulkItemKey,
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
  seedBulkAnnotations,
  seedBulkAttachments,
  seedBulkLibrary,
} from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import { SCAN_PAGE_SIZE } from "@zotlit/db/item-query";

import { ANNOTATIONS, ATTACHMENTS, collectQuery } from "./index.ts";
import type { RunEvent } from "./test-helpers.ts";
import { runEffect } from "./test-helpers.ts";
import type { CapturedLog } from "./test-helpers.ts";
import { PRODUCTION_TUNING } from "./tuning.ts";

const logs: CapturedLog[] = [];
beforeEach(() => {
  logs.length = 0;
});

const runQuery = (
  query: Parameters<typeof runEffect>[0],
  options: Parameters<typeof runEffect>[1] = {},
) => runEffect(query, { ...options, logs });

const planRecords = () =>
  logs
    .filter((record) => "plan" in record.properties)
    .map((record) => record.properties);

const candidateStatements = (events: readonly RunEvent[]) =>
  events.filter(
    (event) =>
      event.type === "statement" &&
      event.statement.reader.endsWith("candidate-set"),
  );

it.each([
  { dataset: ATTACHMENTS, returnedCount: 2 },
  { dataset: ANNOTATIONS, returnedCount: 103 },
])(
  "$dataset.id keeps a selective Parent Record leaf on candidates in a large Library",
  async ({ dataset, returnedCount }) => {
    using scenario = openScenarioDatabase(connectClient);
    seedBulkLibrary(scenario.sqlite, 5_001);
    seedBulkAttachments(scenario.sqlite, 5_001);
    seedBulkAnnotations(scenario.sqlite, 10_000);
    scenario.sqlite.exec(
      `update itemAnnotations set parentItemID = (select itemID from items where key = 'ATT22223') where itemID in (select itemID from items where key > 'ANN22255' and libraryID = 3)`,
    );
    const query = collectQuery(dataset, {
      libraries: [BULK_LIBRARY],
      filter: `item.key == "${bulkItemKey(0)}"`,
      fields: [],
      sort: [],
    });
    const actual = await runQuery(query, {
      client: scenario.db,
      tuning: { capRatio: 1 },
    });
    expect(planRecords()).toMatchObject([{ plan: "candidates", reason: null }]);
    const scan = await runQuery(query, {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(actual.exit).toEqual(scan.exit);
    expect(actual.exit).toMatchObject({
      _tag: "Success",
      value: { returnedCount },
    });
    expect(candidateStatements(actual.events).length).toBeLessThanOrEqual(3);
    expect(
      actual.events.some(
        (event) =>
          event.type === "statement" &&
          event.statement.reader.endsWith("scan-page"),
      ),
    ).toBe(false);
  },
);

it.each([
  { dataset: ATTACHMENTS, returnedCount: 4 },
  { dataset: ANNOTATIONS, returnedCount: 12 },
])(
  "$dataset.id reads matching parents and children in each Target Library",
  async ({ dataset, returnedCount }) => {
    using scenario = openScenarioDatabase(connectClient, { annotations: true });
    for (const filter of [
      'item.tags.contains("methods")',
      'item.collections.within("Thesis")',
      'item.indexedKey == "ART2FULL"',
    ]) {
      const query = collectQuery(dataset, {
        libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
        filter,
        fields: [],
      });
      const actual = await runQuery(query, {
        client: scenario.db,
        tuning: { capRatio: 1 },
      });
      const scan = await runQuery(query, {
        client: scenario.db,
        tuning: { forceScan: true },
      });
      expect(actual.exit).toEqual(scan.exit);
      expect(actual.exit).toMatchObject({
        _tag: "Success",
        value: { returnedCount },
      });
      expect(candidateStatements(actual.events).length).toBeLessThanOrEqual(4);
    }
  },
);

it("reads 100,000 tagged parents with no Attachments in one candidate statement", async () => {
  using scenario = openScenarioDatabase(connectClient);
  seedBulkLibrary(scenario.sqlite, 100_000);
  const query = collectQuery(ATTACHMENTS, {
    libraries: [BULK_LIBRARY],
    filter: 'item.tags.contains("bulk")',
    fields: [],
  });
  const actual = await runQuery(query, { client: scenario.db });
  const scan = await runQuery(query, {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(actual.exit).toEqual(scan.exit);
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 0 },
  });
  expect(candidateStatements(actual.events)).toHaveLength(1);
});

it("reads a Collection of 100,000 parents with 100 Annotations outside it in one candidate statement", async () => {
  using scenario = openScenarioDatabase(connectClient);
  seedBulkLibrary(scenario.sqlite, 100_001);
  seedBulkAnnotations(scenario.sqlite, 100);
  const collectionID = Number(
    scenario.sqlite
      .prepare(
        "insert into collections (collectionName, libraryID, key) values ('Mass', ?, 'MASS2222')",
      )
      .run(BULK_LIBRARY.libraryID).lastInsertRowid,
  );
  scenario.sqlite
    .prepare(
      "insert into collectionItems (collectionID, itemID, orderIndex) select ?, itemID, 0 from items where libraryID = ? and key != ? and itemTypeID = (select itemTypeID from itemTypesCombined where typeName = 'journalArticle')",
    )
    .run(collectionID, BULK_LIBRARY.libraryID, bulkItemKey(0));
  const query = collectQuery(ANNOTATIONS, {
    libraries: [BULK_LIBRARY],
    filter: 'item.collections.within("Mass")',
    fields: [],
  });
  const actual = await runQuery(query, { client: scenario.db });
  const scan = await runQuery(query, {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(actual.exit).toEqual(scan.exit);
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 0 },
  });
  expect(candidateStatements(actual.events)).toHaveLength(1);
});

it.each([1, 1_001])(
  "bounds parent candidate statements with %i Items",
  async (count) => {
    using scenario = openScenarioDatabase(connectClient);
    seedBulkLibrary(scenario.sqlite, count);
    seedBulkAttachments(scenario.sqlite, count);
    seedBulkAnnotations(scenario.sqlite, 100);
    for (const [filter, parents] of [
      ['item.tags.contains("bulk")', count],
      ['item.collections.within("Bulk collection")', Math.ceil(count / 5)],
      [`item.indexedKey == "${bulkItemKey(0)}g2718"`, 1],
    ] as const) {
      for (const [dataset, returnedCount] of [
        [ATTACHMENTS, parents + 1],
        [ANNOTATIONS, 100],
      ] as const) {
        const query = collectQuery(dataset, {
          libraries: [BULK_LIBRARY],
          filter,
          fields: [],
        });
        const actual = await runQuery(query, {
          client: scenario.db,
          tuning: { capRatio: 1 },
        });
        const scan = await runQuery(query, {
          client: scenario.db,
          tuning: { forceScan: true },
        });
        expect(actual.exit).toEqual(scan.exit);
        expect(actual.exit).toMatchObject({
          _tag: "Success",
          value: { returnedCount },
        });
        expect(candidateStatements(actual.events).length).toBeLessThanOrEqual(
          4,
        );
      }
    }
  },
);

it.each([ATTACHMENTS, ANNOTATIONS])(
  "$id bounds a dominant Parent Record candidate read",
  async (dataset) => {
    using scenario = openScenarioDatabase(connectClient);
    seedBulkLibrary(scenario.sqlite, 10_000);
    seedBulkAttachments(scenario.sqlite, 10_000);
    seedBulkAnnotations(scenario.sqlite, 10_000);
    const query = collectQuery(dataset, {
      libraries: [BULK_LIBRARY],
      filter: 'item.tags.contains("bulk")',
      fields: [],
      sort: [],
    });
    const actual = await runQuery(query, {
      client: scenario.db,
      tuning: { capRatio: 1 },
    });
    expect(planRecords()).toMatchObject([
      { plan: "scan", reason: "parent-page-budget-exhausted" },
    ]);
    const scan = await runQuery(query, {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(actual.exit).toEqual(scan.exit);
    expect(actual.exit._tag).toBe("Success");
    const statements = candidateStatements(actual.events);
    expect(statements).toHaveLength(1);
    expect(
      actual.events.some(
        (event) =>
          event.type === "statement" &&
          event.statement.reader.endsWith("scan-page"),
      ),
    ).toBe(true);
    const budget = PRODUCTION_TUNING.relationPageBudget * SCAN_PAGE_SIZE;
    const rowCounts = statements.flatMap((event) =>
      event.type === "statement" ? [event.statement.rows.length] : [],
    );
    expect(rowCounts).toHaveLength(1);
    expect(rowCounts[0]).toBeLessThanOrEqual(budget + 1);
  },
  20_000,
);

it("keeps other-Library children outside the Parent Record budget", async () => {
  using scenario = openScenarioDatabase(connectClient);
  seedBulkLibrary(scenario.sqlite, 4_000);
  seedBulkAttachments(scenario.sqlite, 4_000);
  const query = collectQuery(ATTACHMENTS, {
    libraries: [BULK_LIBRARY],
    filter: `item.key == "${bulkItemKey(0)}"`,
    fields: [],
    sort: [],
  });
  scenario.sqlite
    .prepare(
      "update itemAttachments set parentItemID = null where itemID in (select itemID from items where libraryID = 3 and key >= ? and key < 'ATU')",
    )
    .run(`ATT${bulkItemKey(2000).slice(3)}`);
  scenario.sqlite.exec(
    "update items set libraryID = 1 where itemID in (select itemID from itemAttachments where parentItemID is null) and libraryID = 3",
  );
  const actual = await runQuery(query, { client: scenario.db });
  expect(planRecords()).toMatchObject([{ plan: "candidates", reason: null }]);
  const scan = await runQuery(query, {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(actual.exit).toEqual(scan.exit);
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 1 },
  });
  expect(candidateStatements(actual.events)).toHaveLength(2);
});
