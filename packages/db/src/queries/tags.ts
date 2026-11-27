import type { ZoteroDatabase } from "#client/database.ts";
import type { ItemTag, Tag } from "#lib/zt-tag.ts";
import { distinct } from "@std/collections";

import type { FindManyOptions } from "./_shared.ts";
import { defineQuery, defineKeyedQuery } from "./_shared.ts";

const itemTagOptions = {
  columns: { itemID: true, tagID: true, type: true },
  with: { tag: { columns: { tagID: true, name: true } } },
} satisfies FindManyOptions<"itemTags">;

const itemTagsByItemsQuery = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db.query.itemTags.findMany({
      where: {
        RAW: (itemTag) => contains(itemTag.itemID),
        item: { deletedItem: false },
      },
      ...itemTagOptions,
    }),
  {
    keyOf: (row) => row.itemID,
    orderWithinKey: (a, b) => tagName(a).localeCompare(tagName(b)),
  },
);

function tagName(row: { tagID: number; tag: Tag | null }): string {
  if (!row.tag) {
    throw new Error(`Missing tag row for tagID ${row.tagID}`);
  }
  return row.tag.name;
}

export function getTagsByItemIDs(
  db: ZoteroDatabase,
  itemIDs: readonly number[],
): ItemTag[] {
  const rows = itemTagsByItemsQuery(db, itemIDs);
  const tagsByID = new Map<number, Tag>();
  return rows.map((row) => {
    const tag = tagsByID.get(row.tagID) ?? {
      tagID: row.tagID,
      name: tagName(row),
    };
    tagsByID.set(row.tagID, tag);
    return { itemID: row.itemID, tag, type: row.type };
  });
}

export type TagMemo = Map<number, readonly ItemTag[]>;

export function resolveItemTags(
  db: ZoteroDatabase,
  itemID: number,
  memo: TagMemo,
): readonly ItemTag[] {
  return resolveItemTagsByIDs(db, [itemID], memo).get(itemID) ?? [];
}

export function resolveItemTagsByIDs(
  db: ZoteroDatabase,
  itemIDs: readonly number[],
  memo: TagMemo,
): ReadonlyMap<number, readonly ItemTag[]> {
  const result = new Map<number, readonly ItemTag[]>();
  const missing: number[] = [];
  for (const itemID of itemIDs) {
    const cached = memo.get(itemID);
    if (cached) {
      result.set(itemID, cached);
    } else {
      missing.push(itemID);
    }
  }
  if (missing.length > 0) {
    const tagsByItemID = Map.groupBy(
      getTagsByItemIDs(db, missing),
      (tag) => tag.itemID,
    );
    for (const itemID of missing) {
      const tags = tagsByItemID.get(itemID) ?? [];
      memo.set(itemID, tags);
      result.set(itemID, tags);
    }
  }
  return result;
}

const allTagNamesQuery = defineQuery<void>()((db) =>
  db.query.tags.findMany({ columns: { name: true } }),
);

export function getAllTagNames(db: ZoteroDatabase): string[] {
  return distinct(
    allTagNamesQuery
      .prepared(db)
      .all()
      .map((row) => row.name),
  ).toSorted((a, b) => a.localeCompare(b));
}

const libraryTagNamesQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db.query.itemTags.findMany({
      where: {
        item: { libraryID: placeholder("libraryID"), deletedItem: false },
      },
      columns: {},
      with: { tag: { columns: { name: true } } },
    }),
);

export function getLibraryTagNames(
  db: ZoteroDatabase,
  libraryID: number,
): string[] {
  return distinct(
    libraryTagNamesQuery
      .prepared(db)
      .all({ libraryID })
      .map((row) => row.tag.name),
  ).toSorted((a, b) => a.localeCompare(b));
}
