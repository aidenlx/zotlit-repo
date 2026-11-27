import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { IdSlot } from "./database.ts";
import { defineStatement, idSlots } from "./database.ts";
import { HYDRATE_CHUNK_SIZE } from "./hydrate-chunk.ts";
import { recordUniverse } from "./record-universe.ts";
import type { ScanRow } from "./scan-page.ts";
import { epochMilliseconds, SCAN_PAGE_SIZE } from "./scan-page.ts";

import { itemNotes, items, itemTypesCombined } from "#drizzle/schema.ts";

const parent = alias(items, "noteParent");

export interface NoteScanRow extends ScanRow {
  libraryID: number;
  title: string | null;
  parent: ScanRow;
}

const slots = idSlots(HYDRATE_CHUNK_SIZE);
const itemNotesStatement = defineStatement<
  Record<IdSlot, number | null> & { afterKey: string; afterItemID: number }
>("item-notes")((db, { placeholder }) =>
  db
    .select({
      itemID: items.itemID,
      key: items.key,
      itemType: sql<string>`'note'`,
      dateAdded: epochMilliseconds(items.dateAdded),
      dateModified: epochMilliseconds(items.dateModified),
      libraryID: items.libraryID,
      title: itemNotes.title,
      parent: {
        itemID: parent.itemID,
        key: parent.key,
        itemType: itemTypesCombined.typeName,
        dateAdded: epochMilliseconds(parent.dateAdded),
        dateModified: epochMilliseconds(parent.dateModified),
      },
    })
    .from(items)
    .innerJoin(itemNotes, eq(itemNotes.itemID, items.itemID))
    .innerJoin(parent, eq(parent.itemID, itemNotes.parentItemID))
    .innerJoin(
      itemTypesCombined,
      eq(itemTypesCombined.itemTypeID, parent.itemTypeID),
    )
    .where(
      and(
        inArray(
          parent.itemID,
          slots.names.map((name) => placeholder(name)),
        ),
        sql`(${items.key}, ${items.itemID}) > (${placeholder("afterKey")}, ${placeholder("afterItemID")})`,
        ...recordUniverse(db, [items, parent], false),
      ),
    )
    .orderBy(asc(items.key), asc(items.itemID))
    .limit(SCAN_PAGE_SIZE),
);

export function readItemNotes(itemIDs: readonly number[], after?: NoteScanRow) {
  if (itemIDs.length > HYDRATE_CHUNK_SIZE)
    return Effect.die(
      new RangeError("A relation chunk holds at most 250 parent IDs."),
    );
  if (!itemIDs.length) return Effect.succeed([] as NoteScanRow[]);
  return itemNotesStatement.all({
    ...slots.bind(itemIDs),
    afterKey: after?.key ?? "",
    afterItemID: after?.itemID ?? 0,
  });
}
