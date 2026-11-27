import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WebApiLibraryExport } from "@zotlit/db-testing/web-api";
import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";

import {
  CITATION_KEYS,
  openParityPair,
  PARITY_LEAVES_OUT,
  PARITY_LEAVES_OUT_SENTINELS,
  PARITY_USER,
  openNodeReplica,
} from "./__fixtures__/parity.ts";
import type { ParityPair, ReplicaClient } from "./__fixtures__/parity.ts";
import type { ApplyResult } from "./apply.ts";

import { relations } from "#drizzle/relations.ts";
import { ITEM_QUERY_LAYOUT } from "#layout/index.ts";
import { fetchNoteSource } from "#lib/context/note-context.ts";
import { CollectionCache } from "#lib/zt-collection.ts";
import { getZoteroIdentity } from "#queries/account.ts";
import { getAnnotViewAttachments } from "#queries/annot-view.ts";
import {
  getAnnotationParentKeys,
  getAnnotationsByKey,
  getAnnotationsByParent,
} from "#queries/annotations.ts";
import {
  getAttachmentsByKey,
  getAttachmentsByParents,
} from "#queries/attachments.ts";
import {
  getIndexedItemIDsByCollection,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
} from "#queries/batch-scope.ts";
import {
  getCitekeyByItemKey,
  getCitekeysByLibrary,
  getItemIDByCitekey,
} from "#queries/citekey.ts";
import { getCollectionNodesByLibrary } from "#queries/collections.ts";
import {
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getIndexedItemsByLibrary,
} from "#queries/index-items.ts";
import { getItemDisplayRefsByIDs } from "#queries/item-ref.ts";
import { getRelatedKeysByItemID } from "#queries/item-relations.ts";
import { getItemsByKey, getItemsByLibrary } from "#queries/items.ts";
import { getLibraries } from "#queries/libraries.ts";
import { getChildNotesByParentIDs, getNotesByKey } from "#queries/notes.ts";
import { getAllTagNames, getLibraryTagNames } from "#queries/tags.ts";

interface Side {
  readonly db: ZoteroDatabase;
  readonly items: Map<number, string>;
  readonly itemIDs: Map<string, number>;
  readonly libraries: Map<number, string>;
  readonly libraryIDs: Map<string, number>;
  readonly collections: Map<number, string>;
}

function describeSide(db: ZoteroDatabase): Side {
  const libraries = new Map(
    db
      .all<{ libraryID: number; groupID: number | null }>(
        sql`select l.libraryID, g.groupID from libraries l left join groups g using (libraryID)`,
      )
      .map((row) => [
        Number(row.libraryID),
        row.groupID === null ? "user" : `group:${Number(row.groupID)}`,
      ]),
  );
  const items = new Map(
    db
      .all<{ itemID: number; libraryID: number; key: string }>(
        sql`select itemID, libraryID, key from items`,
      )
      .map((row) => [
        Number(row.itemID),
        `${libraries.get(Number(row.libraryID))}/${row.key}`,
      ]),
  );
  const collections = new Map(
    db
      .all<{ collectionID: number; libraryID: number; key: string }>(
        sql`select collectionID, libraryID, key from collections`,
      )
      .map((row) => [
        Number(row.collectionID),
        `${libraries.get(Number(row.libraryID))}/collections/${row.key}`,
      ]),
  );
  return {
    db,
    items,
    itemIDs: new Map([...items].map(([id, key]) => [key, id])),
    libraries,
    libraryIDs: new Map([...libraries].map(([id, ref]) => [ref, id])),
    collections,
  };
}

const LOCAL_ID_FIELDS = new Set(["tagID", "creatorID", "valueID"]);

const KEPT_ID_FIELDS = new Set([
  "groupID",
  "itemTypeID",
  "fieldID",
  "creatorTypeID",
  "userID",
]);

function byKey(side: Side, value: unknown, field?: string): unknown {
  const id = (map: Map<number, string>, raw: unknown) =>
    raw === null || raw === undefined
      ? raw
      : (map.get(Number(raw)) ?? `missing:${JSON.stringify(raw)}`);
  if (field === "itemID" || field === "parentItemID" || field === "parentID") {
    return id(side.items, value);
  }
  if (field === "libraryID") return id(side.libraries, value);
  if (field === "collectionID" || field === "parentCollectionID") {
    return id(side.collections, value);
  }
  if (
    field?.endsWith("ID") &&
    !KEPT_ID_FIELDS.has(field) &&
    typeof value === "number"
  ) {
    if (!LOCAL_ID_FIELDS.has(field))
      throw new Error(`no key for the ID field ${field}`);
    return "local";
  }
  if (value instanceof Temporal.Instant) return value.toString();
  if (value instanceof Map) {
    return [...value].map(([key, entry]) => [
      typeof key === "number" ? id(side.items, key) : key,
      byKey(side, entry),
    ]);
  }
  if (Array.isArray(value)) return value.map((entry) => byKey(side, entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        byKey(side, entry, key),
      ]),
    );
  }
  return value;
}

let desktop: Side;
let replica: Side;
let exported: WebApiLibraryExport[];
let applied: ApplyResult[];

let pair: ParityPair;

const require = createRequire(import.meta.url);
const sqliteWasm = await loadSqliteWasm({
  wasm: readFileSync(require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")),
  storage: "memory",
});
let wasmFiles = 0;

const CLIENTS: readonly [string, () => ReplicaClient][] = [
  ["node:sqlite", () => openNodeReplica()],
  [
    "sqlite-wasm",
    () => {
      const database = sqliteWasm.open({
        file: `/replica-${++wasmFiles}.sqlite`,
        relations,
      });
      return { db: database.db, close: () => database.close() };
    },
  ],
];

function expectSame(read: (side: Side) => unknown, count: number): void {
  const expected = byKey(desktop, read(desktop));
  const actual = byKey(replica, read(replica));
  const size = (value: unknown) =>
    Array.isArray(value)
      ? value.length
      : value === null || value === undefined
        ? 0
        : 1;
  expect(size(expected)).toBe(count);
  expect(actual).toEqual(expected);
}

const LIBRARIES = ["user", "group:4815"] as const;
const lib = (side: Side, ref: string) => side.libraryIDs.get(ref)!;
const keysOf = (side: Side, ref: string, where: string) =>
  side.db
    .all<{ key: string }>(
      sql`select key from items where libraryID = ${lib(side, ref)} and ${sql.raw(where)} order by key`,
    )
    .map((row) => row.key);
const idsOf = (side: Side, ref: string, where: string) =>
  keysOf(side, ref, where).map((key) => side.itemIDs.get(`${ref}/${key}`)!);
const ITEM_TYPE = (name: string) =>
  `itemTypeID = (select itemTypeID from itemTypesCombined where typeName = '${name}')`;

function readAll(side: Side): unknown {
  const reads: Record<string, unknown> = {
    libraries: getLibraries(side.db),
    identity: getZoteroIdentity(side.db),
    annotView: getAnnotViewAttachments(side.db, "ART2FULL", 1),
    tags: getAllTagNames(side.db),
    relations: getRelatedKeysByItemID(
      side.db,
      side.itemIDs.get("user/ART2FULL")!,
    ),
  };
  for (const ref of LIBRARIES) {
    const id = lib(side, ref);
    const all = idsOf(side, ref, "1");
    const keys = keysOf(side, ref, "1");
    const annotations = keysOf(side, ref, ITEM_TYPE("annotation"));
    reads[ref] = {
      items: getItemsByLibrary(side.db, id),
      itemsByKey: getItemsByKey(side.db, keys, { libraryID: id }),
      citekeys: getCitekeysByLibrary(side.db, id),
      indexed: getIndexedItemsByLibrary(side.db, id),
      indexedIDs: getIndexedItemIDsByLibrary(side.db, id),
      indexedByID: getIndexedItemsByID(side.db, all),
      annotations: getAnnotationsByKey(side.db, annotations, id),
      annotationParents: getAnnotationParentKeys(side.db, annotations, id),
      annotationsByParent: idsOf(side, ref, ITEM_TYPE("attachment")).flatMap(
        (attachment) => getAnnotationsByParent(side.db, attachment),
      ),
      attachments: getAttachmentsByKey(
        side.db,
        id,
        keysOf(side, ref, ITEM_TYPE("attachment")),
      ),
      attachmentsByParents: getAttachmentsByParents(side.db, all),
      notes: getNotesByKey(side.db, id, keysOf(side, ref, ITEM_TYPE("note"))),
      childNotes: getChildNotesByParentIDs(side.db, all),
      noteIDs: getNoteItemIDsByLibrary(side.db, id),
      collections: getCollectionNodesByLibrary(side.db, id),
      tags: getLibraryTagNames(side.db, id),
      displayRefs: getItemDisplayRefsByIDs(side.db, all),
      noteSources: getItemsByLibrary(side.db, id).map((item) =>
        fetchNoteSource(side.db, item, {
          username: PARITY_USER.username,
          collectionCache: new CollectionCache(),
        }),
      ),
    };
  }
  reads.citekeys = CITATION_KEYS.map(([key, libraryID, citationKey]) => {
    const ref = libraryID === 1 ? "user" : "group:4815";
    return [
      getCitekeyByItemKey(side.db, lib(side, ref), key),
      side.items.get(
        getItemIDByCitekey(side.db, lib(side, ref), citationKey) ?? 0,
      ),
    ];
  });
  for (const collectionKey of ["CL2THSIS", "CL2TCHNG"]) {
    reads[collectionKey] = [
      getIndexedItemIDsByCollection(side.db, { libraryID: 1, collectionKey }),
      getNoteItemIDsByCollection(side.db, { libraryID: 1, collectionKey }),
    ];
  }
  return byKey(side, reads);
}

describe("the columns that the replica fills differently from the client", () => {
  it.each(Object.entries(PARITY_LEAVES_OUT_SENTINELS))(
    "reach no reader output: %s",
    (column, sentinel) => {
      using local = openParityPair();
      const side = describeSide(local.replica.db);
      const before = readAll(side);
      const [table, name] = column.split(".") as [string, string];
      const changed = local.replica.db.run(
        sql`update ${sql.identifier(table)} set ${sql.identifier(name)} = ${sentinel}`,
      );
      expect(Number((changed as { changes: number }).changes)).toBeGreaterThan(
        0,
      );
      expect(readAll(describeSide(local.replica.db))).toEqual(before);
    },
  );

  it("names every column of the parity list that has one", () => {
    expect(
      Object.keys(PARITY_LEAVES_OUT).filter((entry) => entry.includes(".")),
    ).toEqual(Object.keys(PARITY_LEAVES_OUT_SENTINELS));
  });
});

describe.each(CLIENTS)(
  "the replica built from Web API records of the scenario database, on %s",
  (_, openReplica) => {
    beforeAll(() => {
      pair = openParityPair({ openReplica });
      desktop = describeSide(pair.desktop.db);
      replica = describeSide(pair.replica.db);
      exported = [...pair.records];
      applied = [...pair.results];
    });

    afterAll(() => pair?.[Symbol.dispose]());

    it.each(Object.entries(PARITY_LEAVES_OUT))(
      "leaves out %s, which the reader layout lacks: %s",
      (column) => {
        const [table, name] = column.split(".") as [string, string | undefined];
        const read: Readonly<Record<string, readonly string[]>> =
          ITEM_QUERY_LAYOUT;
        const columns = read[table] ?? [];
        expect(
          name === undefined ? columns.length : columns.includes(name),
        ).toBe(name === undefined ? 0 : false);
      },
    );

    it("stores each exported record", () => {
      const records = exported.flatMap((library) =>
        library.items.map((item) => item.key),
      );
      expect(records.length).toBe(43);
      expect(
        applied.flatMap((result) => [...result.deferred, ...result.skipped]),
      ).toEqual([]);
      expect(
        applied.flatMap((result) => result.applied.items).toSorted(),
      ).toEqual(records.toSorted());
      expect(
        applied.flatMap((result) => result.applied.collections).length,
      ).toBe(7);
    });

    it("gives the same libraries and account", () => {
      expectSame((side) => getLibraries(side.db), 2);
      const identity = (side: Side) => {
        const { userID, username } = getZoteroIdentity(side.db);
        return { userID, username };
      };
      expect(identity(replica)).toEqual(identity(desktop));
    });

    it.each([
      ["user", 10],
      ["group:4815", 2],
    ])("gives the same items of the %s library", (ref, count) => {
      expectSame((side) => getItemsByLibrary(side.db, lib(side, ref)), count);
      expectSame(
        (side) =>
          getItemsByKey(side.db, keysOf(side, ref, "1"), {
            libraryID: lib(side, ref),
          }),
        count,
      );
    });

    it.each([
      ["user", 2],
      ["group:4815", 1],
    ])("gives the same citation keys of the %s library", (ref, count) => {
      expectSame(
        (side) => getCitekeysByLibrary(side.db, lib(side, ref)),
        count,
      );
    });

    it("finds items by citation key, a key of digits included", () => {
      for (const [key, libraryID, citationKey] of CITATION_KEYS) {
        const ref = libraryID === 1 ? "user" : "group:4815";
        expectSame(
          (side) => getCitekeyByItemKey(side.db, lib(side, ref), key),
          1,
        );
        for (const side of [desktop, replica]) {
          expect(
            side.items.get(
              getItemIDByCitekey(side.db, lib(side, ref), citationKey) ?? 0,
            ),
          ).toBe(`${ref}/${key}`);
        }
      }
    });

    it.each([
      ["user", 10],
      ["group:4815", 2],
    ])("gives the same search index inputs of the %s library", (ref, count) => {
      expectSame(
        (side) => getIndexedItemsByLibrary(side.db, lib(side, ref)),
        count,
      );
      expectSame(
        (side) =>
          getIndexedItemIDsByLibrary(side.db, lib(side, ref)).map((id) =>
            side.items.get(id),
          ),
        count,
      );
      expectSame(
        (side) => getIndexedItemsByID(side.db, idsOf(side, ref, "1")),
        count,
      );
    });

    it.each([
      ["user", 14],
      ["group:4815", 1],
    ])("gives the same annotations of the %s library", (ref, count) => {
      const annotations = (side: Side) =>
        keysOf(side, ref, ITEM_TYPE("annotation"));
      expectSame(
        (side) =>
          getAnnotationsByKey(side.db, annotations(side), lib(side, ref)),
        count,
      );
      expectSame(
        (side) =>
          getAnnotationParentKeys(side.db, annotations(side), lib(side, ref)),
        count,
      );
      expectSame(
        (side) =>
          idsOf(side, ref, ITEM_TYPE("attachment")).flatMap((id) =>
            getAnnotationsByParent(side.db, id),
          ),
        count,
      );
    });

    it.each([
      ["user", 8, 7],
      ["group:4815", 1, 1],
    ])(
      "gives the same attachments of the %s library",
      (ref, count, childCount) => {
        expectSame(
          (side) =>
            getAttachmentsByKey(
              side.db,
              lib(side, ref),
              keysOf(side, ref, ITEM_TYPE("attachment")),
            ),
          count,
        );
        expectSame(
          (side) => getAttachmentsByParents(side.db, idsOf(side, ref, "1")),
          childCount,
        );
      },
    );

    it.each([
      ["user", 1],
      ["group:4815", 1],
    ])("gives the same notes of the %s library", (ref, count) => {
      expectSame(
        (side) =>
          getNotesByKey(
            side.db,
            lib(side, ref),
            keysOf(side, ref, ITEM_TYPE("note")),
          ),
        count,
      );
      expectSame(
        (side) => getChildNotesByParentIDs(side.db, idsOf(side, ref, "1")),
        count,
      );
      expectSame(
        (side) =>
          getNoteItemIDsByLibrary(side.db, lib(side, ref)).map((id) =>
            side.items.get(id),
          ),
        count,
      );
    });

    it.each([
      ["user", 5],
      ["group:4815", 1],
    ])("gives the same collections of the %s library", (ref, count) => {
      expectSame(
        (side) => getCollectionNodesByLibrary(side.db, lib(side, ref)),
        count,
      );
    });

    it("gives the same items of a collection and its subcollections", () => {
      for (const [collectionKey, count, noteCount] of [
        ["CL2THSIS", 2, 1],
        ["CL2TCHNG", 1, 0],
      ] as const) {
        expectSame(
          (side) =>
            getIndexedItemIDsByCollection(side.db, {
              libraryID: 1,
              collectionKey,
            }).map((id) => side.items.get(id)),
          count,
        );
        expectSame(
          (side) =>
            getNoteItemIDsByCollection(side.db, {
              libraryID: 1,
              collectionKey,
            }).map((id) => side.items.get(id)),
          noteCount,
        );
      }
    });

    it("gives the same tags", () => {
      expectSame((side) => getAllTagNames(side.db), 10);
      for (const [ref, count] of [
        ["user", 9],
        ["group:4815", 3],
      ] as const) {
        expectSame(
          (side) => getLibraryTagNames(side.db, lib(side, ref)),
          count,
        );
      }
    });

    it("gives the same relations", () => {
      expectSame(
        (side) =>
          getRelatedKeysByItemID(side.db, side.itemIDs.get("user/ART2FULL")!),
        2,
      );
    });

    it("gives the same display references and annotation view", () => {
      for (const [ref, count] of [
        ["user", 33],
        ["group:4815", 5],
      ] as const) {
        expectSame(
          (side) => getItemDisplayRefsByIDs(side.db, idsOf(side, ref, "1")),
          count,
        );
      }
      expectSame((side) => getAnnotViewAttachments(side.db, "ART2FULL", 1), 4);
    });

    it("gives the same literature note data", () => {
      for (const ref of LIBRARIES) {
        for (const item of getItemsByLibrary(desktop.db, lib(desktop, ref))) {
          const read = (side: Side) => {
            const [same] = getItemsByKey(side.db, [item.key], {
              libraryID: lib(side, ref),
            });
            return fetchNoteSource(side.db, same!, {
              username: PARITY_USER.username,
              collectionCache: new CollectionCache(),
            });
          };
          expectSame(read, 1);
        }
      }
    });
  },
);
