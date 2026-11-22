import type { ZoteroDatabase } from "#client/database.ts";

import { defineQuery } from "./_shared.ts";

import { parseItemUri } from "#lib/zt-note-mark.ts";

const RELATED_ITEM_PREDICATE = "dc:relation";

const relatedObjectsByItemQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemRelations.findMany({
      where: {
        itemID: placeholder("itemID"),
        predicate: { predicate: RELATED_ITEM_PREDICATE },
      },
      columns: { object: true },
    }),
);

export function getRelatedKeysByItemID(
  db: ZoteroDatabase,
  itemID: number,
): string[] {
  return relatedObjectsByItemQuery
    .prepared(db)
    .all({ itemID })
    .flatMap((row) => {
      const ref = parseItemUri(row.object);
      return ref ? [ref.key] : [];
    });
}
