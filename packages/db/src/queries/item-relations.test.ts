import type { NodeDatabaseClient } from "#desktop/node-client.ts";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixtureSchema } from "@zotlit/db-testing";

import { getRelatedKeysByItemID } from "./item-relations.ts";

import { relations } from "#drizzle/relations.ts";

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  seedFixture(sqlite);
  db = drizzle({ client: sqlite, relations });
});

afterEach(() => {
  sqlite.close();
});

describe("getRelatedKeysByItemID", () => {
  it("returns dc:relation object keys for the item", () => {
    expect(getRelatedKeysByItemID(db, 1).toSorted()).toEqual([
      "RELATEDA",
      "RELATEDB",
    ]);
  });

  it("ignores non-dc:relation predicates (owl:sameAs, dc:replaces)", () => {
    expect(getRelatedKeysByItemID(db, 2)).toEqual([]);
  });

  it("is forward-only: returns only rows owned by the queried itemID", () => {
    expect(getRelatedKeysByItemID(db, 3)).toEqual(["RELATEDC"]);
    expect(getRelatedKeysByItemID(db, 5)).toEqual(["ITEM3REL"]);
  });

  it("skips object URIs that are not Zotero item URIs", () => {
    expect(getRelatedKeysByItemID(db, 4)).toEqual([]);
  });

  it("returns an empty array when the item has no relations", () => {
    expect(getRelatedKeysByItemID(db, 99)).toEqual([]);
  });
});

function seedFixture(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into relationPredicates (predicateID, predicate)
      values (1, 'dc:relation'), (2, 'owl:sameAs'), (3, 'dc:replaces');

    insert into itemRelations (itemID, predicateID, object)
      values
        (1, 1, 'http://zotero.org/users/12345/items/RELATEDA'),
        (1, 1, 'http://zotero.org/groups/9/items/RELATEDB'),
        (1, 2, 'http://zotero.org/users/12345/items/SAMEASXX'),
        (2, 2, 'http://zotero.org/users/12345/items/SAMEASYY'),
        (3, 1, 'http://zotero.org/users/12345/items/RELATEDC'),
        (4, 1, 'http://zotero.org/users/12345/collections/COLLECTN'),
        (5, 1, 'http://zotero.org/users/12345/items/ITEM3REL');
  `);
}
