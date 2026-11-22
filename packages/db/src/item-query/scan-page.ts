import type { ZoteroDatabase } from "#client/database.ts";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import { Effect } from "effect";

import { defineStatement, idSlots, unindexed } from "./database.ts";
import type {
  IdSlot,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "./database.ts";

import { deletedItems, items, itemTypesCombined } from "#drizzle/schema.ts";
import { CHILD_ITEM_TYPES } from "#lib/item-types.ts";

export const SCAN_PAGE_SIZE = 500;

export interface ScanRow {
  itemID: number;
  key: string;
  itemType: string;
  dateAdded: number | null;
  dateModified: number | null;
}

function epochMilliseconds(column: AnyColumn): SQL<number | null> {
  return sql<number | null>`unixepoch(${column}) * 1000`;
}

function selectScanRows(db: ZoteroDatabase) {
  return db
    .select({
      itemID: items.itemID,
      key: items.key,
      itemType: itemTypesCombined.typeName,
      dateAdded: epochMilliseconds(items.dateAdded),
      dateModified: epochMilliseconds(items.dateModified),
    })
    .from(items)
    .innerJoin(
      itemTypesCombined,
      eq(itemTypesCombined.itemTypeID, items.itemTypeID),
    );
}

function universeTerms(db: ZoteroDatabase): SQL[] {
  return [
    notInArray(itemTypesCombined.typeName, [...CHILD_ITEM_TYPES]),
    notExists(
      db
        .select({ itemID: deletedItems.itemID })
        .from(deletedItems)
        .where(eq(deletedItems.itemID, items.itemID)),
    ),
  ];
}

const scanPageStatement = defineStatement<{
  libraryID: number;
  afterItemID: number;
  limit: number;
}>("scan-page")((db, { placeholder }) =>
  selectScanRows(db)
    .where(
      and(
        eq(unindexed(items.libraryID), placeholder("libraryID")),
        gt(items.itemID, placeholder("afterItemID")),
        ...universeTerms(db),
      ),
    )
    .orderBy(asc(items.itemID))
    .limit(placeholder("limit")),
);

export function readScanPage(page: {
  libraryID: number;
  afterItemID?: number;
  size?: number;
}): Effect.Effect<ScanRow[], ItemQueryReaderError, ItemQueryDatabase> {
  return scanPageStatement.all({
    libraryID: page.libraryID,
    afterItemID: page.afterItemID ?? 0,
    limit: Math.min(page.size ?? SCAN_PAGE_SIZE, SCAN_PAGE_SIZE),
  });
}

const ID_SLOTS = idSlots(SCAN_PAGE_SIZE);

const universeRowsStatement = defineStatement<
  Record<IdSlot, number | null> & { libraryID: number }
>("universe-rows")((db, { placeholder }) =>
  selectScanRows(db)
    .where(
      and(
        inArray(
          items.itemID,
          ID_SLOTS.names.map((slot) => placeholder(slot)),
        ),
        eq(unindexed(items.libraryID), placeholder("libraryID")),
        ...universeTerms(db),
      ),
    )
    .orderBy(asc(items.itemID)),
);

export function readUniverseRows(chunk: {
  libraryID: number;
  itemIDs: readonly number[];
}): Effect.Effect<ScanRow[], ItemQueryReaderError, ItemQueryDatabase> {
  const { libraryID, itemIDs } = chunk;
  if (itemIDs.length > SCAN_PAGE_SIZE) {
    return Effect.die(
      new RangeError(
        `A universe chunk holds at most ${SCAN_PAGE_SIZE} Item IDs, not ${itemIDs.length}.`,
      ),
    );
  }
  if (itemIDs.length === 0) return Effect.succeed([]);
  return universeRowsStatement.all({ libraryID, ...ID_SLOTS.bind(itemIDs) });
}
