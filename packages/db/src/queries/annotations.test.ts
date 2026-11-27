import type { NodeDatabaseClient } from "#desktop/node-client.ts";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  countCompiles,
  countStatements,
  createFixtureSchema,
} from "@zotlit/db-testing";

import { getAnnotationsByKey, getAnnotationsByParent } from "./annotations.ts";

import { relations } from "#drizzle/relations.ts";
import { USER_LIBRARY_ID } from "#lib/constants.ts";
import { parseAnnotationPosition } from "#lib/zt-annot-pos.ts";

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  seed(sqlite);
  db = drizzle({ client: sqlite, relations });
});

afterEach(() => {
  sqlite.close();
});

describe("getAnnotationsByParent", () => {
  it("reads userdata 125 without local client revision columns", () => {
    sqlite.exec(`
      update version set version = 125 where schema = 'userdata';
      alter table items drop column clientVersion;
    `);

    const result = getAnnotationsByParent(db, 10);

    expect(result).toHaveLength(6);
    expect(result.every(({ version }) => version === 0)).toBe(true);
    expect(getAnnotationsByKey(db, ["XMPLANN9"], 1)).toHaveLength(1);
  });

  it("returns visible annotations sorted by sortIndex", () => {
    const result = getAnnotationsByParent(db, 10);

    expect(result).toHaveLength(6);
    expect(result.map((annotation) => annotation.key)).toEqual([
      "XMPLANN9",
      "XMPLANN2",
      "XMPLANNC",
      "XMPLANN3",
      "XMPLANN8",
      "XMPLANN7",
    ]);
    expect(new Set(result.map((annotation) => annotation.type))).toEqual(
      new Set([1, 2, 3, 4, 5, 6]),
    );
    expect(result.some((annotation) => annotation.key === "TRASHED1")).toBe(
      false,
    );
    expect(
      result.every((annotation) => annotation.parentKey === "XMPLATC4"),
    ).toBe(true);
    expect(result.every((annotation) => annotation.isExternal === false)).toBe(
      true,
    );
    expect(typeof result[0]?.dateAdded.epochMilliseconds).toBe("number");
    sqlite.exec("update items set clientVersion = 24 where key = 'XMPLANN9'");
    expect(getAnnotationsByParent(db, 10)[0]?.version).toBe(24);
  });

  it("narrows fixture PDF positions", () => {
    const result = getAnnotationsByParent(db, 10);
    const kinds = Object.fromEntries(
      result.map((annotation) => [
        annotation.key,
        parseAnnotationPosition(annotation.position, "application/pdf").kind,
      ]),
    );

    expect(kinds).toEqual({
      XMPLANN9: "pdf-rects",
      XMPLANN2: "pdf-rects",
      XMPLANNC: "pdf-rects",
      XMPLANN3: "pdf-ink",
      XMPLANN8: "pdf-text",
      XMPLANN7: "pdf-rects",
    });
  });
});

describe("getAnnotationsByParent creator", () => {
  it("reads the creator of a group item, and none where the database names none", () => {
    sqlite.exec(`
      insert into libraries (libraryID, type) values (2, 'group');
      insert into groups (groupID, libraryID) values (4711, 2);
      update items set libraryID = 2;
      insert into users (userID, name) values (7, 'me'), (9, 'colleague');
      insert into groupItems (itemID, createdByUserID)
        values (20, 7), (21, 9), (23, null);
    `);
    const creators = (client: NodeDatabaseClient) =>
      Object.fromEntries(
        getAnnotationsByParent(client, 10).map(({ key, createdByUserID }) => [
          key,
          createdByUserID,
        ]),
      );

    const expected = {
      XMPLANN9: 7,
      XMPLANNC: 9,
      XMPLANN2: null,
      XMPLANN3: null,
      XMPLANN8: null,
      XMPLANN7: null,
    };
    expect(creators(db)).toEqual(expected);

    sqlite.exec(`
      update version set version = 125 where schema = 'userdata';
      alter table items drop column clientVersion;
    `);
    expect(creators(drizzle({ client: sqlite, relations }))).toEqual(expected);
  });
});

describe("getAnnotationsByParent tags", () => {
  it("returns the annotation's tags by name, in Zotero's own order", () => {
    const result = getAnnotationsByParent(db, 10);

    const annotation = result.find((a) => a.key === "XMPLANN9");
    expect(annotation?.tags).toEqual(["first-tag", "second-tag"]);
    expect(annotation?.tagDetails).toEqual([
      { name: "first-tag", type: 0 },
      { name: "second-tag", type: 1 },
    ]);
  });
});

describe("getAnnotationsByKey", () => {
  it("returns requested visible annotation keys", () => {
    const result = getAnnotationsByKey(
      db,
      ["XMPLANN9", "XMPLANNC"],
      USER_LIBRARY_ID,
    );

    expect(result).toHaveLength(2);
    expect(result.map((annotation) => annotation.key)).toEqual([
      "XMPLANN9",
      "XMPLANNC",
    ]);
  });

  it("returns an empty array for empty keys", () => {
    expect(getAnnotationsByKey(db, [], USER_LIBRARY_ID)).toEqual([]);
  });

  it("returns keys in request order, repeating a repeated key and leaving misses out", () => {
    expect(
      getAnnotationsByKey(
        db,
        ["XMPLANNC", "TRASHED1", "MISSING", "XMPLANN9", "XMPLANNC"],
        USER_LIBRARY_ID,
      ).map((annotation) => annotation.key),
    ).toEqual(["XMPLANNC", "XMPLANN9", "XMPLANNC"]);
  });

  it("runs the same cached statements for one key as for many", () => {
    const statements = countStatements(sqlite);
    const compiles = countCompiles(sqlite);
    const cost = (keys: string[]) => {
      const before = statements();
      getAnnotationsByKey(db, keys, USER_LIBRARY_ID);
      return statements() - before;
    };
    cost(["XMPLANN9"]);
    expect(
      cost(["XMPLANN9", "XMPLANNC", "XMPLANN7", "XMPLANN2", "MISSING"]),
    ).toBe(cost(["XMPLANN9"]));
    const compiled = compiles();
    cost(["XMPLANN9", "XMPLANNC", "XMPLANN7", "XMPLANN2", "MISSING"]);
    expect(compiles()).toBe(compiled);
  });
});

function seed(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into version (schema, version) values ('userdata', 129), ('compatibility', 9);
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (10, 3, '2024-01-01 10:00:00', '2024-01-01 10:00:00', 1, 'XMPLATC4'),
        (20, 4, '2024-01-02 10:00:00', '2024-01-02 10:00:09', 1, 'XMPLANN9'),
        (21, 4, '2024-01-02 10:01:00', '2024-01-02 10:01:00', 1, 'XMPLANNC'),
        (22, 4, '2024-01-02 10:02:00', '2024-01-02 10:02:00', 1, 'XMPLANN7'),
        (23, 4, '2024-01-02 10:03:00', '2024-01-02 10:03:04', 1, 'XMPLANN2'),
        (24, 4, '2024-01-02 10:04:00', '2024-01-02 10:04:00', 1, 'XMPLANN3'),
        (25, 4, '2024-01-02 10:05:00', '2024-01-02 10:05:03', 1, 'XMPLANN8'),
        (26, 4, '2024-01-02 10:06:00', '2024-01-02 10:06:00', 1, 'TRASHED1');

    insert into itemAttachments (itemID, contentType)
      values (10, 'application/pdf');

    insert into itemAnnotations (
      itemID,
      parentItemID,
      type,
      authorName,
      text,
      comment,
      color,
      pageLabel,
      sortIndex,
      position,
      isExternal
    )
      values
        (
          20,
          10,
          1,
          null,
          'Interrogation of Responses to Stated Choice  Experiments',
          'An invented comment.',
          '#ff6666',
          '62',
          '00000|000012|00144',
          '{"pageIndex":0,"rects":[[118.25,631.5,478.75,647.5],[154.5,611.75,256.25,627.75]]}',
          0
        ),
        (
          21,
          10,
          5,
          null,
          'dents tell',
          null,
          '#ffd400',
          '62',
          '00000|000097|00183',
          '{"pageIndex":0,"rects":[[272.5,592.25,347.25,608.25]]}',
          0
        ),
        (
          22,
          10,
          3,
          null,
          null,
          null,
          '#ffd400',
          '62',
          '00000|001930|00070',
          '{"pageIndex":0,"rects":[[214.5,684.25,445.75,721.25]]}',
          0
        ),
        (
          23,
          10,
          2,
          null,
          null,
          'an invented note',
          '#ffd400',
          '62',
          '00000|000058|00133',
          '{"pageIndex":0,"rects":[[514.5,636.25,536.5,658.25]]}',
          0
        ),
        (
          24,
          10,
          4,
          null,
          null,
          null,
          '#2ea8e5',
          '62',
          '00000|000140|00203',
          '{"pageIndex":0,"width":2,"paths":[[48.5,588.25,47.75,587]]}',
          0
        ),
        (
          25,
          10,
          6,
          null,
          null,
          'an invented text box',
          null,
          '62',
          '00000|000215|00238',
          '{"pageIndex":0,"fontSize":14,"rotation":0,"rects":[[470.5,536.25,565.5,553.25]]}',
          0
        ),
        (
          26,
          10,
          1,
          null,
          'trashed highlight',
          null,
          '#ffd400',
          '62',
          '00000|000010|00010',
          '{"pageIndex":0,"rects":[[1,2,3,4]]}',
          0
        );

    insert into deletedItems (itemID, dateDeleted)
      values (26, '2024-01-02 10:06:01');

    insert into tags (tagID, name)
      values (1, 'first-tag'), (2, 'second-tag');
    insert into itemTags (itemID, tagID, type)
      values (20, 1, 0), (20, 2, 1);
  `);
}
