import type { ZoteroDatabase } from "#client/database.ts";
import { and, count, eq, notExists } from "drizzle-orm";

import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { defineQuery } from "./_shared.ts";
import type { QueryRow } from "./_shared.ts";
import { groupIDForLibrary } from "./libraries.ts";

import { deletedItems, itemAnnotations } from "#drizzle/schema.ts";

export interface AnnotViewAttachment {
  itemID: number;
  indexedKey: string;
  path: string | null;
  annotCount: number;
}

const annotViewAttachmentsQuery = defineQuery<{
  key: string;
  libraryID: number;
}>()((db, { placeholder }) =>
  db.query.itemAttachments.findMany({
    where: {
      item_parentItemID: {
        key: placeholder("key"),
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
      item_itemID: { deletedItem: false },
    },
    columns: { itemID: true, path: true },
    with: { item_itemID: { columns: { key: true } } },
    extras: {
      annotCount: (table) =>
        db.$count(
          itemAnnotations,
          and(
            eq(itemAnnotations.parentItemID, table.itemID),
            notExists(
              db
                .select({ _: deletedItems.itemID })
                .from(deletedItems)
                .where(eq(deletedItems.itemID, itemAnnotations.itemID)),
            ),
          ),
        ),
    },
  }),
);

type AttachmentRow = QueryRow<typeof annotViewAttachmentsQuery>;

function toAnnotViewAttachment(
  row: AttachmentRow,
  groupID: number | null,
): AnnotViewAttachment {
  return {
    itemID: row.itemID,
    indexedKey: formatIndexedKey(row.item_itemID.key, groupID),
    path: row.path,
    annotCount: row.annotCount,
  };
}

export function getAnnotViewAttachments(
  db: ZoteroDatabase,
  itemKey: string,
  libraryID: number,
): AnnotViewAttachment[] {
  const groupID = groupIDForLibrary(db, libraryID);
  return annotViewAttachmentsQuery
    .prepared(db)
    .all({ key: itemKey, libraryID })
    .map((row) => toAnnotViewAttachment(row, groupID));
}

const annotationCountQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db
      .select({ count: count() })
      .from(itemAnnotations)
      .where(
        and(
          eq(itemAnnotations.parentItemID, placeholder("parentItemID")),
          notExists(
            db
              .select({ _: deletedItems.itemID })
              .from(deletedItems)
              .where(eq(deletedItems.itemID, itemAnnotations.itemID)),
          ),
        ),
      ),
);

export function getAttachmentAnnotationCount(
  db: ZoteroDatabase,
  attachmentItemID: number,
): number {
  const row = annotationCountQuery
    .prepared(db)
    .get({ parentItemID: attachmentItemID });
  return row?.count ?? 0;
}
