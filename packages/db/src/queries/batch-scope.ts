import type { ZoteroDatabase } from "#client/database.ts";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, isNull, notInArray, sql } from "drizzle-orm";

import type { ParamsPlaceholder } from "./_shared.ts";
import { CHILD_ITEM_TYPES, defineQuery } from "./_shared.ts";

import {
  collectionItems,
  collections,
  deletedCollections,
  deletedItems,
  itemNotes,
  items,
  itemTypes,
} from "#drizzle/schema.ts";

interface CollectionScope {
  libraryID: number;
  collectionKey: string;
}

function collectionScopeItemIDs(
  placeholder: ParamsPlaceholder<CollectionScope>,
): SQL {
  return sql`(
    with recursive zt_subtree(collectionID) as (
      select ${collections.collectionID} from ${collections}
        where ${collections.libraryID} = ${placeholder("libraryID")}
          and ${collections.key} = ${placeholder("collectionKey")}
          and ${collections.collectionID} not in (select dc.collectionID from ${deletedCollections} dc)
      union
      select child.collectionID from ${collections} child
        join zt_subtree parent on child.parentCollectionID = parent.collectionID
        where child.collectionID not in (select dc.collectionID from ${deletedCollections} dc)
    )
    select ${collectionItems.itemID} from ${collectionItems}
      join zt_subtree on ${collectionItems.collectionID} = zt_subtree.collectionID
      where ${collectionItems.itemID} not in (select di.itemID from ${deletedItems} di)
  )`;
}

const collectionIDByKeyQuery = defineQuery<CollectionScope>()(
  (db, { placeholder }) =>
    db.query.collections.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        key: placeholder("collectionKey"),
        deletedCollection: false,
      },
      columns: { collectionID: true },
      limit: 1,
    }),
);

export function getCollectionIDByKey(
  db: ZoteroDatabase,
  scope: CollectionScope,
): number | undefined {
  return collectionIDByKeyQuery.prepared(db).all(scope)[0]?.collectionID;
}

const indexedItemIDsByCollectionQuery = defineQuery<CollectionScope>()(
  (db, { placeholder }) =>
    db
      .select({ itemID: items.itemID })
      .from(items)
      .innerJoin(itemTypes, eq(itemTypes.itemTypeID, items.itemTypeID))
      .where(
        and(
          sql`${items.itemID} in ${collectionScopeItemIDs(placeholder)}`,
          notInArray(itemTypes.typeName, [...CHILD_ITEM_TYPES]),
        ),
      )
      .orderBy(desc(items.dateModified)),
);

export function getIndexedItemIDsByCollection(
  db: ZoteroDatabase,
  scope: CollectionScope,
): number[] {
  return indexedItemIDsByCollectionQuery
    .prepared(db)
    .all(scope)
    .map((row) => row.itemID);
}

const noteItemIDsByCollectionQuery = defineQuery<CollectionScope>()(
  (db, { placeholder }) =>
    db
      .select({ itemID: itemNotes.itemID })
      .from(itemNotes)
      .leftJoin(deletedItems, eq(deletedItems.itemID, itemNotes.itemID))
      .where(
        and(
          isNull(deletedItems.itemID),
          sql`coalesce(${itemNotes.parentItemID}, ${itemNotes.itemID}) in ${collectionScopeItemIDs(placeholder)}`,
        ),
      )
      .orderBy(asc(itemNotes.itemID)),
);

export function getNoteItemIDsByCollection(
  db: ZoteroDatabase,
  scope: CollectionScope,
): number[] {
  return noteItemIDsByCollectionQuery
    .prepared(db)
    .all(scope)
    .map((row) => row.itemID);
}

const noteItemIDsByLibraryQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db
      .select({ itemID: itemNotes.itemID })
      .from(itemNotes)
      .innerJoin(items, eq(items.itemID, itemNotes.itemID))
      .leftJoin(deletedItems, eq(deletedItems.itemID, itemNotes.itemID))
      .where(
        and(
          eq(items.libraryID, placeholder("libraryID")),
          isNull(deletedItems.itemID),
          sql`(${itemNotes.parentItemID} is null or ${itemNotes.parentItemID} not in (select di.itemID from ${deletedItems} di))`,
        ),
      )
      .orderBy(asc(itemNotes.itemID)),
);

export function getNoteItemIDsByLibrary(
  db: ZoteroDatabase,
  libraryID: number,
): number[] {
  return noteItemIDsByLibraryQuery
    .prepared(db)
    .all({ libraryID })
    .map((row) => row.itemID);
}
