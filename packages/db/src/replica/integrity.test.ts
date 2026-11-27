import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import { exportWebApiLibraries } from "@zotlit/db-testing/web-api";
import type { WebApiLibraryExport } from "@zotlit/db-testing/web-api";
import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import type { WebApiItem } from "@zotlit/zotero-types/web-api";

import { openNodeReplica } from "./__fixtures__/parity.ts";
import type { ReplicaClient } from "./__fixtures__/parity.ts";
import { applyRecords, upsertGroupLibrary } from "./apply.ts";
import { createReplica } from "./create.ts";

import { connectClient } from "#desktop/node-client.ts";
import { relations } from "#drizzle/relations.ts";

const require = createRequire(import.meta.url);
const sqliteWasm = await loadSqliteWasm({
  wasm: readFileSync(require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")),
  storage: "memory",
});

const CLIENTS: readonly [string, () => ReplicaClient][] = [
  ["node:sqlite", () => openNodeReplica()],
  [
    "sqlite-wasm",
    () => {
      const database = sqliteWasm.open({
        file: "/integrity.sqlite",
        relations,
      });
      return { db: database.db, close: () => database.close() };
    },
  ],
];

function scenarioRecords(): WebApiLibraryExport[] {
  using desktop = openScenarioDatabase(connectClient, { annotations: true });
  desktop.sqlite.exec(
    `update itemNotes set note = '<div class="zotero-note znv1">' || note || '</div>'`,
  );
  return exportWebApiLibraries(desktop.sqlite, {
    userID: 7654321,
    username: "reader",
  });
}

function renamed(item: WebApiItem): WebApiItem {
  const { data } = item;
  return {
    ...item,
    version: item.version + 1,
    data: {
      ...data,
      version: data.version + 1,
      ...(typeof data.title === "string" ? { title: `${data.title} 2` } : {}),
      creators: data.creators?.map((creator) =>
        "name" in creator
          ? { ...creator, name: `${creator.name} 2` }
          : { ...creator, lastName: `${creator.lastName ?? ""} 2` },
      ),
      tags: data.tags?.map((tag) => ({ ...tag, tag: `${tag.tag} 2` })),
    },
  };
}

function count(db: ZoteroDatabase, query: string): number {
  return Number(db.get<{ n: number }>(sql.raw(query))!.n);
}

describe.each(CLIENTS)(
  "a replica on %s with foreign keys off",
  (_, openReplica) => {
    it("keeps no orphan row after re-apply, replacement and deletion", () => {
      const client = openReplica();
      const { db } = client;
      try {
        expect(db.get(sql`pragma foreign_keys`)).toEqual({ foreign_keys: 0 });
        createReplica(db);
        const libraries = scenarioRecords();
        const libraryIDs = libraries.map((library) =>
          library.group ? upsertGroupLibrary(db, library.group) : 1,
        );
        const apply = (
          pick: (
            library: WebApiLibraryExport,
          ) => Parameters<typeof applyRecords>[1],
        ) => {
          for (const library of libraries) {
            const result = applyRecords(db, pick(library));
            expect([...result.deferred, ...result.skipped]).toEqual([]);
          }
        };
        const changes = (library: WebApiLibraryExport) => ({
          libraryID: libraryIDs[libraries.indexOf(library)]!,
        });

        apply((library) => ({
          ...changes(library),
          collections: library.collections,
          items: library.items,
        }));
        apply((library) => ({
          ...changes(library),
          collections: library.collections,
          items: library.items,
        }));
        apply((library) => ({
          ...changes(library),
          items: library.items.map(renamed),
        }));

        const parentKeys = new Set(
          libraries.flatMap((library) =>
            library.items.flatMap((item) =>
              item.data.parentItem ? [item.data.parentItem] : [],
            ),
          ),
        );
        const parentCollections = new Set(
          libraries.flatMap((library) =>
            library.collections.flatMap((collection) =>
              collection.data.parentCollection
                ? [collection.data.parentCollection]
                : [],
            ),
          ),
        );
        const before = count(db, "select count(*) as n from items");
        apply((library) => ({
          ...changes(library),
          deleted: {
            items: library.items
              .filter(
                (item) =>
                  parentKeys.has(item.key) ||
                  (item.data.collections ?? []).length > 0,
              )
              .slice(0, 6)
              .map((item) => item.key),
          },
        }));
        apply((library) => ({
          ...changes(library),
          deleted: {
            collections: library.collections
              .filter((collection) => parentCollections.has(collection.key))
              .map((collection) => collection.key),
          },
        }));
        expect(count(db, "select count(*) as n from items")).toBeLessThan(
          before,
        );
        expect(
          count(
            db,
            "select count(*) as n from collections where parentCollectionID is not null",
          ),
        ).toBe(0);

        expect(
          db.all(
            sql`select value from itemDataValues where valueID not in (select valueID from itemData where valueID is not null)`,
          ),
        ).toEqual([]);
        expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);
        expect(
          count(
            db,
            "select count(*) as n from creators where creatorID not in (select creatorID from itemCreators)",
          ),
        ).toBe(0);
        expect(
          count(
            db,
            "select count(*) as n from tags where tagID not in (select tagID from itemTags)",
          ),
        ).toBe(0);
      } finally {
        client.close();
      }
    });
  },
);
