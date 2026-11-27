import type { ZoteroDatabase } from "#client/database.ts";
import type { CreatorFieldMode } from "#lib/zt-creator.ts";
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";

import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { getBaseFieldTable } from "./_base-fields.ts";
import type { BaseFieldTable } from "./_base-fields.ts";
import { CHILD_ITEM_TYPES, defineQuery, defineKeyedQuery } from "./_shared.ts";
import type { FindManyOptions, QueryRow } from "./_shared.ts";
import { groupIDForLibrary, resolveGroupID } from "./libraries.ts";
import type { GroupIDMemo } from "./libraries.ts";

import { deletedItems, items, itemTypes, libraries } from "#drizzle/schema.ts";

export interface IndexedCreator {
  firstName: string | null;
  lastName: string | null;
  fieldMode: CreatorFieldMode;
}

export interface IndexedItem {
  itemID: number;
  libraryID: number;
  key: string;
  indexedKey: string;
  dateModified: Temporal.Instant;
  lastActivity: number | null;
  itemType: string;
  primaryCreator: IndexedCreator | null;
  creators: readonly IndexedCreator[];
  language: string | null;
  title: string | null;
  publicationTitle: string | null;
  shortTitle: string | null;
  court: string | null;
  citationKey: string | null;
  date: string | null;
}

const INDEXED_FIELD_NAMES = [
  "title",
  "publicationTitle",
  "shortTitle",
  "court",
  "citationKey",
  "date",
  "language",
] as const;

type IndexedFieldName = (typeof INDEXED_FIELD_NAMES)[number];

function indexedItemRelations(indexedFieldIDs: readonly number[]) {
  return {
    columns: {
      itemID: true,
      libraryID: true,
      key: true,
      dateModified: true,
      itemTypeID: true,
    },
    with: {
      itemType: {
        columns: { typeName: true },
        with: {
          itemTypeCreatorTypes: {
            columns: { creatorTypeID: true },
            where: { primaryField: { eq: 1 } },
            limit: 1,
          },
        },
      },
      itemData: {
        columns: { fieldID: true },
        where: { fieldID: { in: [...indexedFieldIDs] } },
        with: {
          itemDataValue: { columns: { value: true } },
        },
      },
      itemCreators: {
        columns: { creatorTypeID: true },
        orderBy: { orderIndex: "asc" },
        with: {
          creator: {
            columns: { firstName: true, lastName: true, fieldMode: true },
          },
        },
      },
    },
  } satisfies FindManyOptions<"items">;
}

const indexedItemsQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }, args: { indexedFieldIDs: readonly number[] }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...indexedItemRelations(args.indexedFieldIDs),
      orderBy: { dateModified: "desc" },
    }),
);

const indexedItemIDsByLibraryQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      columns: { itemID: true },
      orderBy: { dateModified: "desc" },
    }),
);

const indexedItemRowsRangeQuery = defineQuery<{
  libraryID: number;
  from: number;
  to: number;
}>()((db, { placeholder }) =>
  db.query.items.findMany({
    where: {
      RAW: (item) =>
        sql`+${item.libraryID} = ${placeholder("libraryID")}
          and ${item.itemID} >= ${placeholder("from")}
          and ${item.itemID} < ${placeholder("to")}`,
      itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
      deletedItem: false,
    },
    columns: { itemID: true, key: true },
    extras: { dateModified: (item) => sql<string>`${item.dateModified}` },
    orderBy: { itemID: "asc" },
  }),
);

export type IndexedItemScanRow = QueryRow<typeof indexedItemRowsRangeQuery>;

export function getIndexedItemRowsRange(
  db: ZoteroDatabase,
  libraryID: number,
  { from, to }: ItemIDRange,
): IndexedItemScanRow[] {
  return indexedItemRowsRangeQuery.prepared(db).all({ libraryID, from, to });
}

const indexedItemsByIdsQuery = defineKeyedQuery<number>()(
  (
    db,
    { contains },
    args: {
      indexedFieldIDs: readonly number[];
    },
  ) =>
    db.query.items.findMany({
      where: {
        RAW: (item) => contains(item.itemID),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...indexedItemRelations(args.indexedFieldIDs),
    }),
  { keyOf: (row) => row.itemID },
);

const zoteroActivity = sql<number | null>`(select max(activity) from (
  select unixepoch(${items}."dateAdded") * 1000 as activity
  union all
  select a.lastRead * 1000 from itemAttachments a
    where a.parentItemID = ${items}."itemID" and a.linkMode in (0, 1, 2, 3)
      and not exists (select 1 from deletedItems d where d.itemID = a.itemID)
  union all
  select unixepoch(n.dateModified) * 1000 from itemNotes r join items n on n.itemID = r.itemID
    where r.parentItemID = ${items}."itemID"
      and not exists (select 1 from deletedItems d where d.itemID = n.itemID)
  union all
  select unixepoch(n.dateModified) * 1000 from itemAttachments a
    join itemAnnotations r on r.parentItemID = a.itemID join items n on n.itemID = r.itemID
    where a.parentItemID = ${items}."itemID"
      and not exists (select 1 from deletedItems d where d.itemID = a.itemID)
      and not exists (select 1 from deletedItems d where d.itemID = n.itemID)
))`.mapWith(Number);

const activityByIDs = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db
      .select({ itemID: items.itemID, lastActivity: zoteroActivity })
      .from(items)
      .where(contains(items.itemID)),
  { keyOf: (row) => row.itemID },
);

type IndexedItemRow = QueryRow<typeof indexedItemsQuery>;

export function getIndexedItemsByLibrary(
  db: ZoteroDatabase,
  libraryID: number,
): IndexedItem[] {
  const table = getBaseFieldTable(db, INDEXED_FIELD_NAMES);
  const rows = indexedItemsQuery
    .prepared(db, { indexedFieldIDs: table.fieldIDs })
    .all({ libraryID });
  const groupID = groupIDForLibrary(db, libraryID);
  const activity = new Map(
    activityByIDs(
      db,
      rows.map((row) => row.itemID),
    ).map((row) => [row.itemID, row.lastActivity]),
  );
  return rows.map((row) =>
    toIndexedItem(
      { ...row, lastActivity: activity.get(row.itemID) ?? null },
      groupID,
      table,
    ),
  );
}

export function getIndexedItemIDsByLibrary(
  db: ZoteroDatabase,
  libraryID: number,
): number[] {
  return indexedItemIDsByLibraryQuery
    .prepared(db)
    .all({ libraryID })
    .map((row) => row.itemID);
}

export function getIndexedItemsByID(
  db: ZoteroDatabase,
  itemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): IndexedItem[] {
  if (itemIDs.length === 0) return [];
  const table = getBaseFieldTable(db, INDEXED_FIELD_NAMES);
  const memo = opts?.memo ?? new Map();
  const activity = new Map(
    activityByIDs(db, itemIDs).map((row) => [row.itemID, row.lastActivity]),
  );
  return indexedItemsByIdsQuery(db, itemIDs, {
    args: { indexedFieldIDs: table.fieldIDs },
  }).map((row) =>
    toIndexedItem(
      { ...row, lastActivity: activity.get(row.itemID) ?? null },
      resolveGroupID(db, row.libraryID, memo),
      table,
    ),
  );
}

const indexedItemCountQuery = defineQuery<void>()((db) =>
  db
    .select({ count: count() })
    .from(items)
    .innerJoin(itemTypes, eq(itemTypes.itemTypeID, items.itemTypeID))
    .innerJoin(libraries, eq(libraries.libraryID, items.libraryID))
    .leftJoin(deletedItems, eq(deletedItems.itemID, items.itemID))
    .where(
      and(
        inArray(libraries.type, ["user", "group"]),
        notInArray(itemTypes.typeName, [...CHILD_ITEM_TYPES]),
        isNull(deletedItems.itemID),
      ),
    ),
);

export function getIndexedItemCount(db: ZoteroDatabase): number {
  return indexedItemCountQuery.prepared(db).get()?.count ?? 0;
}

export interface IndexSignature {
  count: number;
  checksum: number;
}

const checksumTerm = sql<number>`unixepoch(${items.dateModified})
  + coalesce(unixepoch(${items.clientDateModified}), 0)
  + ${items.itemID}
  + (coalesce(${zoteroActivity} / 1000, 0) * ((${items.itemID} % 997) + 1) % 2147483647)`;

const indexSignatureRangeQuery = defineQuery<{
  libraryID: number;
  from: number;
  to: number;
}>()((db, { placeholder }) =>
  db
    .select({
      count: count(),
      checksum: sql<number>`coalesce(sum(${checksumTerm}), 0)`,
    })
    .from(items)
    .innerJoin(itemTypes, eq(itemTypes.itemTypeID, items.itemTypeID))
    .leftJoin(deletedItems, eq(deletedItems.itemID, items.itemID))
    .where(
      and(
        sql`+${items.libraryID} = ${placeholder("libraryID")}`,
        gte(items.itemID, placeholder("from")),
        lt(items.itemID, placeholder("to")),
        notInArray(itemTypes.typeName, [...CHILD_ITEM_TYPES]),
        isNull(deletedItems.itemID),
      ),
    ),
);

const itemIDBoundsQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db
      .select({
        min: sql<number | null>`min(${items.itemID})`.mapWith(Number),
        max: sql<number | null>`max(${items.itemID})`.mapWith(Number),
      })
      .from(items)
      .where(eq(items.libraryID, placeholder("libraryID"))),
);

export function getItemIDBounds(
  db: ZoteroDatabase,
  libraryID: number,
): { min: number; max: number } | null {
  const row = itemIDBoundsQuery.prepared(db).get({ libraryID });
  if (row?.min == null || row.max == null) return null;
  return { min: row.min, max: row.max };
}

export function getIndexSignatureRange(
  db: ZoteroDatabase,
  libraryID: number,
  { from, to }: ItemIDRange,
): IndexSignature {
  const row = indexSignatureRangeQuery
    .prepared(db)
    .get({ libraryID, from, to });
  return {
    count: row?.count ?? 0,
    checksum: Number(row?.checksum ?? 0),
  };
}

export interface ItemIDRange {
  from: number;
  to: number;
}

export function* sumSignatureRanges(
  bounds: { min: number; max: number } | null,
  size: number,
): Generator<ItemIDRange, IndexSignature, IndexSignature> {
  const total: IndexSignature = { count: 0, checksum: 0 };
  if (!bounds) return total;
  for (let from = bounds.min; from <= bounds.max; from += size) {
    const part = yield { from, to: from + size };
    total.count += part.count;
    total.checksum += part.checksum;
  }
  return total;
}

const indexSignatureQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db
      .select({
        count: count(),
        checksum: sql<number>`coalesce(sum(${checksumTerm}), 0)`,
      })
      .from(items)
      .innerJoin(itemTypes, eq(itemTypes.itemTypeID, items.itemTypeID))
      .leftJoin(deletedItems, eq(deletedItems.itemID, items.itemID))
      .where(
        and(
          eq(items.libraryID, placeholder("libraryID")),
          notInArray(itemTypes.typeName, [...CHILD_ITEM_TYPES]),
          isNull(deletedItems.itemID),
        ),
      ),
);

export function getIndexSignature(
  db: ZoteroDatabase,
  libraryID: number,
): IndexSignature {
  const row = indexSignatureQuery.prepared(db).get({ libraryID });
  return {
    count: row?.count ?? 0,
    checksum: Number(row?.checksum ?? 0),
  };
}

function toIndexedItem(
  row: IndexedItemRow & { lastActivity: number | null },
  groupID: number | null,
  table: BaseFieldTable<IndexedFieldName>,
): IndexedItem {
  const item: IndexedItem = {
    itemID: row.itemID,
    libraryID: row.libraryID,
    key: row.key,
    indexedKey: formatIndexedKey(row.key, groupID),
    dateModified: row.dateModified,
    lastActivity: row.lastActivity,
    itemType: row.itemType.typeName ?? "",
    primaryCreator: null,
    creators: [],
    language: null,
    title: null,
    publicationTitle: null,
    shortTitle: null,
    court: null,
    citationKey: null,
    date: null,
  };

  for (const data of row.itemData) {
    const name = table.resolve(row.itemTypeID, data.fieldID);
    if (!name) continue;
    item[name] = data.itemDataValue?.value ?? null;
  }

  const primaryTypeID =
    row.itemType.itemTypeCreatorTypes[0]?.creatorTypeID ?? null;
  const creators: IndexedCreator[] = [];
  let primaryCreator: IndexedCreator | null = null;
  for (const ic of row.itemCreators) {
    const creator: IndexedCreator = {
      firstName: ic.creator?.firstName ?? null,
      lastName: ic.creator?.lastName ?? null,
      fieldMode: ic.creator?.fieldMode ?? 0,
    };
    creators.push(creator);
    if (
      !primaryCreator &&
      primaryTypeID != null &&
      ic.creatorTypeID === primaryTypeID
    ) {
      primaryCreator = creator;
    }
  }
  item.creators = creators;
  item.primaryCreator = primaryCreator;
  return item;
}
