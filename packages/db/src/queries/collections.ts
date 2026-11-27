import type { ZoteroDatabase } from "#client/database.ts";

import type { QueryRow } from "./_shared.ts";
import { defineQuery } from "./_shared.ts";

export const collectionIDsByItemQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.collectionItems.findMany({
      where: {
        itemID: placeholder("itemID"),
        item: { deletedItem: false },
        collection: { deletedCollection: false },
      },
      columns: { collectionID: true },
    }),
);

export const collectionNodesByLibraryQuery = defineQuery<{
  libraryID: number;
}>()((db, { placeholder }) =>
  db.query.collections.findMany({
    where: {
      libraryID: placeholder("libraryID"),
      deletedCollection: false,
    },
    columns: {
      collectionID: true,
      collectionName: true,
      parentCollectionID: true,
      key: true,
    },
  }),
);

export type CollectionNode = QueryRow<typeof collectionNodesByLibraryQuery>;

export function getCollectionNodesByLibrary(
  db: ZoteroDatabase,
  libraryID: number,
): CollectionNode[] {
  return collectionNodesByLibraryQuery.prepared(db).all({ libraryID });
}

export function getCollectionIDsByItem(
  db: ZoteroDatabase,
  itemID: number,
): number[] {
  return collectionIDsByItemQuery
    .prepared(db)
    .all({ itemID })
    .map((row) => row.collectionID);
}
