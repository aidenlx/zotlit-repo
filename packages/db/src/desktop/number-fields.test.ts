import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import {
  openScenarioDatabase,
  SCENARIO_ITEMS,
  SCENARIO_LIBRARIES,
} from "@zotlit/db-testing/scenario";
import type { ScenarioItemName } from "@zotlit/db-testing/scenario";

import type { NodeDatabaseClient } from "./node-client.ts";
import { connectClient } from "./node-client.ts";

import {
  ItemQueryDatabase,
  readAnnotationScanPage,
  readAttachmentHydrateChunk,
  readAttachmentScanPage,
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
  readItemNotes,
  readScanPage,
} from "#item-query/index.ts";
import {
  getCitekeyByItemKey,
  getCitekeysByLibrary,
  getCitekeyWindow,
  getLastItemID,
} from "#queries/citekey.ts";
import {
  getIndexedItemsByLibrary,
  getItemIDBounds,
} from "#queries/index-items.ts";
import { getItemDisplayInfoByID } from "#queries/item-ref.ts";
import { getLibraries } from "#queries/libraries.ts";

const LAST_READ_SECONDS = 1_800_000_000;
const CLIENT_VERSION = 42;

const ms = (instant: string) =>
  Temporal.Instant.from(instant).epochMilliseconds;

const STAMPS = {
  article: {
    dateAdded: ms("2020-03-16T09:30:00Z"),
    dateModified: ms("2024-06-01T10:00:00Z"),
  },
  attachment: {
    dateAdded: ms("2020-03-16T09:31:00Z"),
    dateModified: ms("2020-03-16T09:31:00Z"),
  },
  annotation: {
    dateAdded: ms("2020-03-16T09:40:00Z"),
    dateModified: ms("2020-03-16T09:40:00Z"),
  },
  note: {
    dateAdded: ms("2020-03-16T09:50:00Z"),
    dateModified: ms("2020-03-16T09:50:00Z"),
  },
};

function findBigInt(value: unknown, path = "$"): string | undefined {
  if (typeof value === "bigint") return path;
  if (value instanceof Map) return findBigInt(Object.fromEntries(value), path);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findBigInt(item, `${path}[${index}]`);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const found = findBigInt(item, `${path}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
}

function runOk<A, E>(
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
): A {
  const exit = Effect.runSyncExit(
    Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  return exit.value;
}

function itemID(
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  name: ScenarioItemName,
): number {
  const { key, library } = SCENARIO_ITEMS[name];
  const row = scenario.sqlite
    .prepare("select itemID from items where key = ? and libraryID = ?")
    .get(key, SCENARIO_LIBRARIES[library].libraryID) as { itemID: number };
  return row.itemID;
}

function openScenario(jit: boolean) {
  const scenario = openScenarioDatabase(
    (sqlite) => connectClient(sqlite, { jit }),
    { annotations: true, layout: "highest" },
  );
  scenario.sqlite.exec(`
    update itemAttachments set lastRead = ${LAST_READ_SECONDS}
      where itemID = (select itemID from items where key = '${SCENARIO_ITEMS.liveAttachment.key}');
    update libraries set clientVersion = ${CLIENT_VERSION} where libraryID = 1;
    insert into itemDataValues (value) values ('lovelace2020exact');
    insert into itemData (itemID, fieldID, valueID)
      select i.itemID, f.fieldID, v.valueID
      from items i, fieldsCombined f, itemDataValues v
      where i.key = '${SCENARIO_ITEMS.fullDateArticle.key}'
        and f.fieldName = 'citationKey' and v.value = 'lovelace2020exact';
  `);
  return scenario;
}

const article = SCENARIO_ITEMS.fullDateArticle;
const attachment = SCENARIO_ITEMS.liveAttachment;
const annotation = SCENARIO_ITEMS.highlightAnnotation;
const note = SCENARIO_ITEMS.childNote;
const { personal } = SCENARIO_LIBRARIES;

describe.each([false, true])(
  "number fields on the Node client (jit: %s)",
  (jit) => {
    it("reads the timestamps of a scan row as numbers", () => {
      using scenario = openScenario(jit);
      const rows = runOk(
        scenario,
        readScanPage({ libraryID: personal.libraryID }),
      );
      expect(findBigInt(rows)).toBeUndefined();
      expect(rows.find((row) => row.key === article.key)).toMatchObject({
        dateAdded: STAMPS.article.dateAdded,
        dateModified: STAMPS.article.dateModified,
      });
    });

    it("reads the timestamps of an Attachment row and its parent as numbers", () => {
      using scenario = openScenario(jit);
      const rows = runOk(
        scenario,
        readAttachmentScanPage({ libraryID: personal.libraryID }),
      );
      expect(findBigInt(rows)).toBeUndefined();
      expect(rows.find((row) => row.key === attachment.key)).toMatchObject({
        dateAdded: STAMPS.attachment.dateAdded,
        dateModified: STAMPS.attachment.dateModified,
        lastRead: LAST_READ_SECONDS * 1000,
        parent: {
          dateAdded: STAMPS.article.dateAdded,
          dateModified: STAMPS.article.dateModified,
        },
      });
    });

    it("reads the timestamps of an Annotation row, its Attachment and its parent as numbers", () => {
      using scenario = openScenario(jit);
      const rows = runOk(
        scenario,
        readAnnotationScanPage({ libraryID: personal.libraryID }),
      );
      expect(findBigInt(rows)).toBeUndefined();
      expect(rows.find((row) => row.key === annotation.key)).toMatchObject({
        dateAdded: STAMPS.annotation.dateAdded,
        dateModified: STAMPS.annotation.dateModified,
        attachmentLastRead: LAST_READ_SECONDS * 1000,
        attachmentDateAdded: STAMPS.attachment.dateAdded,
        attachmentDateModified: STAMPS.attachment.dateModified,
        parent: {
          dateAdded: STAMPS.article.dateAdded,
          dateModified: STAMPS.article.dateModified,
        },
      });
    });

    it("reads an integer-stored title and URL of an Attachment as text", () => {
      using scenario = openScenario(jit);
      scenario.sqlite.exec(`
        insert into itemDataValues (value) values (1984), (2001);
        update itemData set valueID = (select valueID from itemDataValues where value = 1984)
          where itemID = ${itemID(scenario, "liveAttachment")}
            and fieldID = (select fieldID from fieldsCombined where fieldName = 'title');
        insert into itemData (itemID, fieldID, valueID)
          select ${itemID(scenario, "liveAttachment")}, f.fieldID, v.valueID
          from fieldsCombined f, itemDataValues v
          where f.fieldName = 'url' and v.value = 2001;
      `);
      const rows = runOk(
        scenario,
        readAttachmentScanPage({ libraryID: personal.libraryID }),
      ).filter((row) => row.key === attachment.key);
      const hydrated = runOk(
        scenario,
        readAttachmentHydrateChunk({ rows, details: true }),
      );
      expect(findBigInt(hydrated)).toBeUndefined();
      expect(hydrated.get(rows[0]!.itemID)?.details).toMatchObject({
        title: "1984",
        url: "2001",
      });
    });

    it("keeps an absent last-read time as null", () => {
      using scenario = openScenario(jit);
      scenario.sqlite.exec("update itemAttachments set lastRead = null");
      const rows = runOk(
        scenario,
        readAttachmentScanPage({ libraryID: personal.libraryID }),
      );
      expect(
        rows.find((row) => row.key === attachment.key)?.lastRead,
      ).toBeNull();
    });

    it("reads the timestamps of a child note and its parent as numbers", () => {
      using scenario = openScenario(jit);
      const rows = runOk(
        scenario,
        readItemNotes([itemID(scenario, "fullDateArticle")]),
      );
      expect(findBigInt(rows)).toBeUndefined();
      expect(rows.find((row) => row.key === note.key)).toMatchObject({
        dateAdded: STAMPS.note.dateAdded,
        dateModified: STAMPS.note.dateModified,
        parent: {
          dateAdded: STAMPS.article.dateAdded,
          dateModified: STAMPS.article.dateModified,
        },
      });
    });

    it("marks the primary Creator of a hydrated Item", () => {
      using scenario = openScenario(jit);
      const id = itemID(scenario, "fullDateArticle");
      const hydrated = runOk(
        scenario,
        Effect.gen(function* () {
          const vocabulary = yield* readFieldVocabulary;
          const collectionPaths = yield* readCollectionPaths(personal);
          return yield* readHydrateChunk({
            vocabulary,
            itemIDs: [id],
            fields: { builtIn: [], custom: [] },
            relations: ["creators"],
            collectionPaths,
          });
        }),
      );
      expect(
        hydrated.get(id)?.creators?.map((creator) => creator.primary),
      ).toEqual([true, true]);
    });

    it("reads citation key Item IDs and the last Item ID as numbers", () => {
      using scenario = openScenario(jit);
      const last = getLastItemID(scenario.db);
      expect(typeof last).toBe("number");
      const rows = getCitekeyWindow(scenario.db, {
        afterItemID: 0,
        throughItemID: last,
      });
      expect(findBigInt(rows)).toBeUndefined();
      expect(rows).toContainEqual(
        expect.objectContaining({
          itemID: itemID(scenario, "fullDateArticle"),
          citekey: "lovelace2020exact",
        }),
      );
    });

    it("reads an all-digit citation key as the same string in every reader", () => {
      using scenario = openScenario(jit);
      const article = itemID(scenario, "fullDateArticle");
      scenario.sqlite.exec(`
        insert into itemDataValues (value) values (2020);
        update itemData set valueID = (select valueID from itemDataValues where value = 2020)
          where itemID = ${article}
            and fieldID = (select fieldID from fieldsCombined where fieldName = 'citationKey');
      `);
      expect([
        getCitekeyWindow(scenario.db, {
          afterItemID: 0,
          throughItemID: getLastItemID(scenario.db),
        }).find((row) => row.itemID === article)?.citekey,
        getCitekeyByItemKey(
          scenario.db,
          personal.libraryID,
          SCENARIO_ITEMS.fullDateArticle.key,
        ),
        getCitekeysByLibrary(scenario.db, personal.libraryID).find(
          (row) => row.itemID === article,
        )?.citekey,
        getIndexedItemsByLibrary(scenario.db, personal.libraryID).find(
          (item) => item.itemID === article,
        )?.citationKey,
        getItemDisplayInfoByID(scenario.db, article)?.fields.citationKey,
      ]).toEqual(["2020", "2020", "2020", "2020", "2020"]);
    });

    it("reads the client version of a Library as a number", () => {
      using scenario = openScenario(jit);
      const libraries = getLibraries(scenario.db);
      expect(findBigInt(libraries)).toBeUndefined();
      expect(
        libraries.find((library) => library.libraryID === personal.libraryID)
          ?.clientVersion,
      ).toBe(CLIENT_VERSION);
    });

    it("reads the last activity of an indexed Item as a number", () => {
      using scenario = openScenario(jit);
      const items = getIndexedItemsByLibrary(scenario.db, personal.libraryID);
      expect(findBigInt(items)).toBeUndefined();
      expect(items.find((item) => item.key === article.key)?.lastActivity).toBe(
        LAST_READ_SECONDS * 1000,
      );
    });

    it("reads the Item ID bounds of a Library as numbers", () => {
      using scenario = openScenario(jit);
      const bounds = getItemIDBounds(scenario.db, personal.libraryID);
      const ids = scenario.sqlite
        .prepare(
          "select min(itemID) as min, max(itemID) as max from items where libraryID = 1",
        )
        .get() as { min: number; max: number };
      expect(bounds).toEqual({ min: ids.min, max: ids.max });
    });
  },
);
