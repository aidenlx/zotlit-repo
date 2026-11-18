import type { NodeDatabaseClient } from "#client/node.ts";
import { and, eq, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";

import { unindexed } from "./database.ts";

// Leaf predicates shared by Item, Attachment, and Annotation candidate readers.
import { items, itemTags, tags } from "#drizzle/schema.ts";

export function candidateTag(
  db: NodeDatabaseClient,
  value: SQLWrapper,
  ordered = false,
) {
  return eq(
    sql`${ordered ? unindexed(itemTags.tagID) : itemTags.tagID}`,
    db.select({ tagID: tags.tagID }).from(tags).where(eq(tags.name, value)),
  );
}

export function candidateKeys(
  db: NodeDatabaseClient,
  libraryID: SQLWrapper,
  list: SQLWrapper,
) {
  return db
    .select({ itemID: items.itemID })
    .from(items)
    .where(
      and(
        eq(items.libraryID, libraryID),
        sql`${items.key} in (select value from json_each(${list}))`,
      ),
    );
}
