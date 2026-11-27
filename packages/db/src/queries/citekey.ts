import type { ZoteroDatabase } from "#client/database.ts";
import { eq, sql } from "drizzle-orm";

import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import type { QueryRow } from "./_shared.ts";
import { defineQuery } from "./_shared.ts";
import { groupIDForLibrary } from "./libraries.ts";

import {
  itemData,
  items,
  itemDataValues,
  fieldsCombined,
  deletedItems,
} from "#drizzle/schema.ts";

const CITEKEY_FIELD = "citationKey";

const itemIDByCitekeyQuery = defineQuery<{
  libraryID: number;
  citekey: string;
}>()((db, { placeholder }) =>
  db.query.itemData.findMany({
    where: {
      fieldsCombined: { fieldName: CITEKEY_FIELD },
      itemDataValue: { value: placeholder("citekey") },
      item: {
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
    },
    columns: { itemID: true },
    limit: 1,
  }),
);

export function getItemIDByCitekey(
  db: ZoteroDatabase,
  libraryID: number,
  citekey: string,
): number | null {
  return (
    itemIDByCitekeyQuery.prepared(db).all({ libraryID, citekey })[0]?.itemID ??
    null
  );
}

const citekeyByItemKeyQuery = defineQuery<{
  libraryID: number;
  key: string;
}>()((db, { placeholder }) =>
  db.query.itemData.findMany({
    where: {
      fieldsCombined: { fieldName: CITEKEY_FIELD },
      item: {
        key: placeholder("key"),
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
    },
    columns: {},
    with: { itemDataValue: { columns: { value: true } } },
    limit: 1,
  }),
);

export function getCitekeyByItemKey(
  db: ZoteroDatabase,
  libraryID: number,
  key: string,
): string | null {
  return (
    citekeyByItemKeyQuery.prepared(db).all({ libraryID, key })[0]?.itemDataValue
      ?.value ?? null
  );
}

export interface LibraryCitekey {
  itemID: number;
  libraryID: number;
  key: string;
  indexedKey: string;
  citekey: string;
}

const citekeysByLibraryQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db.query.itemData.findMany({
      where: {
        fieldsCombined: { fieldName: CITEKEY_FIELD },
        item: {
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      columns: { itemID: true },
      with: {
        item: { columns: { key: true } },
        itemDataValue: { columns: { value: true } },
      },
      orderBy: { itemID: "asc" },
    }),
);

const citekeyWindowQuery = defineQuery<{
  afterItemID: number;
  throughItemID: number;
}>()((db, { placeholder }) =>
  db
    .select({
      itemID: sql<number>`${itemData.itemID}`.mapWith(Number),
      libraryID: items.libraryID,
      key: items.key,
      citekey: sql<string>`${itemDataValues.value}`.mapWith(
        itemDataValues.value,
      ),
    })
    .from(itemData)
    .innerJoin(items, eq(items.itemID, itemData.itemID))
    .innerJoin(itemDataValues, eq(itemDataValues.valueID, itemData.valueID))
    .where(sql`
      ${itemData.itemID} > ${placeholder("afterItemID")}
      and ${itemData.itemID} <= ${placeholder("throughItemID")}
      and ${itemDataValues.value} <> ''
      and not exists (select 1 from ${deletedItems} where ${deletedItems.itemID} = ${itemData.itemID})
      and +${itemData.fieldID} = (select ${fieldsCombined.fieldID} from ${fieldsCombined} where ${fieldsCombined.fieldName} = ${CITEKEY_FIELD})
    `)
    .orderBy(itemData.itemID),
);

export type CitekeyRow = QueryRow<typeof citekeyWindowQuery>;

export function getCitekeyWindow(
  db: ZoteroDatabase,
  window: { afterItemID: number; throughItemID: number },
): CitekeyRow[] {
  return citekeyWindowQuery.prepared(db).all(window);
}

export function getCitekeysByLibrary(
  db: ZoteroDatabase,
  libraryID: number,
): LibraryCitekey[] {
  return toLibraryCitekeys(
    citekeysByLibraryQuery.prepared(db).all({ libraryID }),
    libraryID,
    groupIDForLibrary(db, libraryID),
  );
}

function toLibraryCitekeys(
  rows: readonly QueryRow<typeof citekeysByLibraryQuery>[],
  libraryID: number,
  groupID: number | null,
): LibraryCitekey[] {
  const citekeys: LibraryCitekey[] = [];
  for (const row of rows) {
    const citekey = row.itemDataValue?.value;
    if (!citekey) continue;
    const key = row.item?.key;
    if (!key) continue;
    if (row.itemID == null) continue;
    citekeys.push({
      itemID: row.itemID,
      libraryID,
      key,
      indexedKey: formatIndexedKey(key, groupID),
      citekey,
    });
  }
  return citekeys;
}

const lastItemIDQuery = defineQuery<void>()((db) =>
  db
    .select({
      itemID: sql<number>`coalesce(max(${items.itemID}), 0)`.mapWith(Number),
    })
    .from(items),
);

export function getLastItemID(db: ZoteroDatabase): number {
  return lastItemIDQuery.prepared(db).all()[0]!.itemID;
}
