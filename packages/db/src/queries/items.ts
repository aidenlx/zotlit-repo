import type { ZoteroDatabase } from "#client/database.ts";
import type { CreatorFieldMode } from "#lib/zt-creator.ts";
import type { ItemBaseFieldName, ItemBaseFields } from "#lib/zt-venue.ts";

import type { ItemFields } from "@zotlit/zotero-types";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import type { BaseFieldTable } from "./_base-fields.ts";
import { getBaseFieldTable } from "./_base-fields.ts";
import type { FindManyOptions, QueryRow } from "./_shared.ts";
import { CHILD_ITEM_TYPES, defineQuery, defineKeyedQuery } from "./_shared.ts";
import type { GroupIDMemo } from "./libraries.ts";
import { groupIDForLibrary, resolveGroupID } from "./libraries.ts";

import {
  EMPTY_ITEM_BASE_FIELDS,
  ITEM_BASE_FIELDS,
  resolveVenue,
} from "#lib/zt-venue.ts";

export interface Creator {
  firstName: string | null;
  lastName: string | null;
  creatorType: string;
  fieldMode: CreatorFieldMode;
}

export interface BaseItem {
  itemID: number;
  libraryID: number;
  key: string;
  indexedKey: string;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;
  creators: Creator[];
  primaryCreatorType: string | null;
  customFields: ReadonlyMap<string, string | null>;
}

export type Item = BaseItem & {
  fields: ItemFields;
  baseFields: ItemBaseFields;
  venue: string | null;
  groupID: number | null;
};

const itemFindOptions = {
  columns: {
    itemID: true,
    libraryID: true,
    key: true,
    dateAdded: true,
    dateModified: true,
    itemTypeID: true,
  },
  with: {
    itemType: {
      columns: { typeName: true },
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
          columns: { fieldID: true, fieldName: true, custom: true },
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
} satisfies FindManyOptions<"items">;

const itemsByLibraryQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...itemFindOptions,
      orderBy: { dateModified: "desc" },
    }),
);

const itemsByIdsQuery = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db.query.items.findMany({
      where: {
        RAW: (item) => contains(item.itemID),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...itemFindOptions,
    }),
  { keyOf: (row) => row.itemID },
);

const itemsByKeysQuery = defineKeyedQuery<string, { libraryID: number }>()(
  (db, { placeholder, contains }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        RAW: (item) => contains(item.key),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...itemFindOptions,
    }),
  { keyOf: (row) => row.key },
);

const itemTypeByKeyQuery = defineQuery<{
  libraryID: number;
  key: string;
}>()((db, { placeholder }) =>
  db.query.items.findMany({
    columns: {},
    with: { itemType: { columns: { typeName: true } } },
    where: {
      libraryID: placeholder("libraryID"),
      key: placeholder("key"),
      deletedItem: false,
    },
    limit: 1,
  }),
);

type ItemRow = QueryRow<typeof itemsByLibraryQuery>;

function toFields(
  row: Pick<ItemRow, "itemData" | "itemTypeID">,
  baseFieldTable: BaseFieldTable<ItemBaseFieldName>,
) {
  const namedProps: Record<string, string | null> = {};
  const customFields = new Map<string, string | null>();
  const baseFields: Record<ItemBaseFieldName, string | null> = {
    ...EMPTY_ITEM_BASE_FIELDS,
  };
  for (const d of row.itemData) {
    if (!d.fieldsCombined) continue;
    const name = d.fieldsCombined.fieldName;
    const value = d.itemDataValue?.value ?? null;
    if (d.fieldsCombined.custom === 1) {
      customFields.set(name, value);
    } else {
      namedProps[name] = value;
    }
    const baseName = baseFieldTable.resolve(
      row.itemTypeID,
      d.fieldsCombined.fieldID,
    );
    if (baseName && value !== null) baseFields[baseName] = value;
  }
  return { namedProps, customFields, baseFields };
}

function toItem(
  row: ItemRow,
  groupID: number | null,
  baseFieldTable: BaseFieldTable<ItemBaseFieldName>,
): Item {
  const { namedProps, customFields, baseFields } = toFields(
    row,
    baseFieldTable,
  );
  const creators: Creator[] = row.itemCreators.map((ic) => ({
    firstName: ic.creator?.firstName ?? null,
    lastName: ic.creator?.lastName ?? null,
    creatorType: ic.creatorType?.creatorType ?? "",
    fieldMode: ic.creator?.fieldMode ?? 0,
  }));
  const primaryCreatorType =
    row.itemType.itemTypeCreatorTypes[0]?.creatorType?.creatorType ?? null;
  return {
    itemID: row.itemID,
    libraryID: row.libraryID,
    key: row.key,
    indexedKey: formatIndexedKey(row.key, groupID),
    groupID,
    dateAdded: row.dateAdded,
    dateModified: row.dateModified,
    creators,
    primaryCreatorType,
    customFields,
    fields: { itemType: row.itemType.typeName, ...namedProps } as ItemFields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}

export function getItemsByLibrary(
  db: ZoteroDatabase,
  libraryID: number,
): Item[] {
  const groupId = groupIDForLibrary(db, libraryID);
  const baseFieldTable = getBaseFieldTable(db, ITEM_BASE_FIELDS);
  return itemsByLibraryQuery
    .prepared(db)
    .all({ libraryID })
    .map((r) => toItem(r, groupId, baseFieldTable));
}

export function getItemsByID(
  db: ZoteroDatabase,
  itemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): Item[] {
  if (itemIDs.length === 0) return [];

  const memo = opts?.memo ?? new Map();
  const baseFieldTable = getBaseFieldTable(db, ITEM_BASE_FIELDS);
  return itemsByIdsQuery(db, itemIDs).map((row) =>
    toItem(row, resolveGroupID(db, row.libraryID, memo), baseFieldTable),
  );
}

export function getItemTypeByKey(
  db: ZoteroDatabase,
  libraryID: number,
  key: string,
): string | null {
  return (
    itemTypeByKeyQuery.prepared(db).all({ libraryID, key })[0]?.itemType
      .typeName ?? null
  );
}

export function getItemsByKey(
  db: ZoteroDatabase,
  keys: readonly string[],
  opts: { libraryID: number; memo?: GroupIDMemo },
): Item[] {
  if (keys.length === 0) return [];

  const { libraryID } = opts;
  const rows = itemsByKeysQuery(db, keys, { params: { libraryID } });
  if (rows.length === 0) return [];
  const groupId = resolveGroupID(db, libraryID, opts.memo ?? new Map());
  const baseFieldTable = getBaseFieldTable(db, ITEM_BASE_FIELDS);
  return rows.map((row) => toItem(row, groupId, baseFieldTable));
}
