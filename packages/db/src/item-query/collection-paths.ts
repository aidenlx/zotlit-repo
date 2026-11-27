import { and, eq, notExists } from "drizzle-orm";
import { Effect } from "effect";

import type { ItemQueryDatabase, ItemQueryReaderError } from "./database.ts";
import { defineStatement } from "./database.ts";

import { collections, deletedCollections } from "#drizzle/schema.ts";

export type CollectionPaths = ReadonlyMap<number, readonly string[]>;

const liveCollectionsStatement = defineStatement<{ libraryID: number }>(
  "collection-paths",
)((db, { placeholder }) =>
  db
    .select({
      collectionID: collections.collectionID,
      name: collections.collectionName,
      parentID: collections.parentCollectionID,
    })
    .from(collections)
    .where(
      and(
        eq(collections.libraryID, placeholder("libraryID")),
        notExists(
          db
            .select({ collectionID: deletedCollections.collectionID })
            .from(deletedCollections)
            .where(
              eq(deletedCollections.collectionID, collections.collectionID),
            ),
        ),
      ),
    ),
);

export function readCollectionPaths(library: {
  libraryID: number;
}): Effect.Effect<CollectionPaths, ItemQueryReaderError, ItemQueryDatabase> {
  return Effect.gen(function* () {
    const rows = yield* liveCollectionsStatement.all(library);
    return yield* Effect.sync(() => {
      const nodes = new Map(rows.map((row) => [row.collectionID, row]));
      const paths = new Map<number, readonly string[] | null>();
      const pathOf = (collectionID: number): readonly string[] | null => {
        const known = paths.get(collectionID);
        if (known !== undefined) return known;
        const node = nodes.get(collectionID);
        let path: readonly string[] | null = null;
        if (node) {
          const parent = node.parentID === null ? [] : pathOf(node.parentID);
          path = parent && [...parent, node.name];
        }
        paths.set(collectionID, path);
        return path;
      };
      const live = new Map<number, readonly string[]>();
      for (const collectionID of nodes.keys()) {
        const path = pathOf(collectionID);
        if (path) live.set(collectionID, path);
      }
      return live;
    });
  });
}
