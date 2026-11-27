import type { ZoteroDatabase } from "#client/database.ts";

import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { defineQuery, defineKeyedQuery } from "./_shared.ts";
import type { Item } from "./items.ts";
import type { GroupIDMemo } from "./libraries.ts";
import { groupIDForLibrary, resolveGroupID } from "./libraries.ts";

export type ItemRef = Pick<
  Item,
  "itemID" | "libraryID" | "key" | "groupID" | "indexedKey"
>;

const itemRefByIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      columns: { key: true, libraryID: true },
      where: { itemID: placeholder("itemID"), deletedItem: false },
      limit: 1,
    }),
);

export function getItemRefByID(
  db: ZoteroDatabase,
  itemID: number,
): ItemRef | null {
  const row = itemRefByIdQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;
  const groupID = groupIDForLibrary(db, row.libraryID);
  return {
    itemID,
    key: row.key,
    libraryID: row.libraryID,
    groupID,
    indexedKey: formatIndexedKey(row.key, groupID),
  };
}

export interface ItemDisplayRef extends ItemRef {
  title: string | null;
}

const itemDisplayRefByIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      columns: { key: true, libraryID: true },
      where: { itemID: placeholder("itemID"), deletedItem: false },
      with: {
        itemData: {
          columns: {},
          with: {
            fieldsCombined: {
              columns: { fieldName: true },
              where: { fieldName: { eq: "title" } },
            },
            itemDataValue: { columns: { value: true } },
          },
        },
      },
      limit: 1,
    }),
);

export function getItemDisplayRefByID(
  db: ZoteroDatabase,
  itemID: number,
  opts?: { memo?: GroupIDMemo },
): ItemDisplayRef | null {
  const row = itemDisplayRefByIdQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;
  const groupID = opts?.memo
    ? resolveGroupID(db, row.libraryID, opts.memo)
    : groupIDForLibrary(db, row.libraryID);
  const title =
    row.itemData.find((d) => d.fieldsCombined?.fieldName === "title")
      ?.itemDataValue?.value ?? null;
  return {
    itemID,
    key: row.key,
    libraryID: row.libraryID,
    groupID,
    indexedKey: formatIndexedKey(row.key, groupID),
    title,
  };
}

const itemDisplayRefsByIdsQuery = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db.query.items.findMany({
      columns: { itemID: true, key: true, libraryID: true },
      where: { RAW: (item) => contains(item.itemID), deletedItem: false },
      with: {
        itemData: {
          columns: {},
          with: {
            fieldsCombined: {
              columns: { fieldName: true },
              where: { fieldName: { eq: "title" } },
            },
            itemDataValue: { columns: { value: true } },
          },
        },
      },
    }),
  { keyOf: (row) => row.itemID },
);

export function getItemDisplayRefsByIDs(
  db: ZoteroDatabase,
  itemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): Map<number, ItemDisplayRef> {
  const refs = new Map<number, ItemDisplayRef>();
  if (itemIDs.length === 0) return refs;
  const memo = opts?.memo ?? new Map();
  for (const row of itemDisplayRefsByIdsQuery(db, itemIDs)) {
    const groupID = resolveGroupID(db, row.libraryID, memo);
    refs.set(row.itemID, {
      itemID: row.itemID,
      key: row.key,
      libraryID: row.libraryID,
      groupID,
      indexedKey: formatIndexedKey(row.key, groupID),
      title:
        row.itemData.find((d) => d.fieldsCombined?.fieldName === "title")
          ?.itemDataValue?.value ?? null,
    });
  }
  return refs;
}

export type ItemDisplayInfo = Pick<
  Item,
  "key" | "creators" | "primaryCreatorType"
> & {
  fields: {
    title: string | null;
    citationKey: string | null;
    date: string | null;
  };
};

const itemDisplayInfoQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      columns: { key: true },
      where: { itemID: placeholder("itemID"), deletedItem: false },
      with: {
        itemType: {
          columns: {},
          with: {
            itemTypeCreatorTypes: {
              columns: {},
              where: { primaryField: { eq: 1 } },
              limit: 1,
              with: {
                creatorType: { columns: { creatorType: true } },
              },
            },
          },
        },
        itemData: {
          columns: {},
          with: {
            fieldsCombined: {
              columns: { fieldName: true },
              where: { fieldName: { in: ["title", "citationKey", "date"] } },
            },
            itemDataValue: { columns: { value: true } },
          },
        },
        itemCreators: {
          columns: {},
          orderBy: { orderIndex: "asc" },
          with: {
            creator: {
              columns: {
                firstName: true,
                lastName: true,
                fieldMode: true,
              },
            },
            creatorType: { columns: { creatorType: true } },
          },
        },
      },
      limit: 1,
    }),
);

export function getItemDisplayInfoByID(
  db: ZoteroDatabase,
  itemID: number,
): ItemDisplayInfo | null {
  const row = itemDisplayInfoQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;

  let title: string | null = null;
  let citationKey: string | null = null;
  let date: string | null = null;
  for (const data of row.itemData) {
    if (data.fieldsCombined?.fieldName === "title") {
      title = data.itemDataValue?.value ?? null;
    } else if (data.fieldsCombined?.fieldName === "citationKey") {
      citationKey = data.itemDataValue?.value ?? null;
    } else if (data.fieldsCombined?.fieldName === "date") {
      date = data.itemDataValue?.value ?? null;
    }
  }

  return {
    key: row.key,
    fields: { title, citationKey, date },
    creators: row.itemCreators.map((itemCreator) => ({
      firstName: itemCreator.creator?.firstName ?? null,
      lastName: itemCreator.creator?.lastName ?? null,
      creatorType: itemCreator.creatorType?.creatorType ?? "",
      fieldMode: itemCreator.creator?.fieldMode ?? 0,
    })),
    primaryCreatorType:
      row.itemType.itemTypeCreatorTypes[0]?.creatorType?.creatorType ?? null,
  };
}
