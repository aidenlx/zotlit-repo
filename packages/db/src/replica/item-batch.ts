import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";

import type { ReplicaOrphans } from "./apply.ts";

export class ItemBatch {
  readonly collections = new Map<number, readonly number[]>();
  readonly fields: [itemID: number, fieldID: number, value: string][] = [];
  readonly creators: [
    itemID: number,
    firstName: string,
    lastName: string,
    fieldMode: number,
    creatorTypeID: number,
    orderIndex: number,
  ][] = [];
  readonly tags: [itemID: number, name: string, type: number][] = [];
  readonly replacedValues = new Set<string>();
  readonly noRelations: number[] = [];
  readonly noChildRows: number[] = [];
  readonly untrashed: number[] = [];
  write(db: ZoteroDatabase, orphans: ReplicaOrphans): void {
    const ids = sql`(select value from json_each(${JSON.stringify([...this.collections.keys()])}))`;
    for (const [table, column, candidates] of [
      ["itemData", "valueID", orphans.valueIDs],
      ["itemCreators", "creatorID", orphans.creatorIDs],
      ["itemTags", "tagID", orphans.tagIDs],
    ] as const) {
      for (const row of db.all<{ id: number }>(
        sql`delete from ${sql.identifier(table)} where itemID in ${ids} returning ${sql.identifier(column)} as id`,
      ))
        candidates.add(Number(row.id));
    }
    if (this.fields.length) {
      const rows = JSON.stringify(this.fields);
      db.run(sql`insert into itemDataValues (value)
        select value ->> 2 from json_each(${rows}) where true on conflict(value) do nothing`);
      db.run(sql`insert into itemData (itemID, fieldID, valueID)
        select j.value ->> 0, j.value ->> 1, v.valueID from json_each(${rows}) j
        join itemDataValues v on v.value = j.value ->> 2 where true
        on conflict(itemID, fieldID) do update set valueID = excluded.valueID`);
      if (this.replacedValues.size) {
        for (const row of db.all<{
          valueID: number;
        }>(sql`select valueID from itemDataValues
          where value in (select value from json_each(${JSON.stringify([...this.replacedValues])}))`))
          orphans.valueIDs.add(Number(row.valueID));
      }
    }
    if (this.creators.length) {
      const rows = JSON.stringify(this.creators);
      db.run(sql`insert into creators (firstName, lastName, fieldMode)
        select value ->> 1, value ->> 2, value ->> 3 from json_each(${rows}) where true
        on conflict(lastName, firstName, fieldMode) do nothing`);
      const insert = sql`insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex)
        select j.value ->> 0, c.creatorID, j.value ->> 4, j.value ->> 5 from json_each(${rows}) j
        join creators c on c.firstName = j.value ->> 1 and c.lastName = j.value ->> 2 and c.fieldMode = j.value ->> 3`;
      if (orphans.creatorIDs.size) {
        for (const { creatorID } of db.all<{ creatorID: number }>(
          sql`${insert} returning creatorID`,
        ))
          orphans.creatorIDs.delete(Number(creatorID));
      } else db.run(insert);
    }
    if (this.tags.length) {
      const rows = JSON.stringify(this.tags);
      db.run(sql`insert into tags (name) select value ->> 1 from json_each(${rows})
        where true on conflict(name) do nothing`);
      db.run(sql`insert into itemTags (itemID, tagID, type)
        select j.value ->> 0, t.tagID, j.value ->> 2 from json_each(${rows}) j
        join tags t on t.name = j.value ->> 1 where true
        on conflict(itemID, tagID) do update set type = excluded.type`);
    }
    for (const [table, items] of [
      ["itemRelations", this.noRelations],
      ["itemNotes", this.noChildRows],
      ["itemAnnotations", this.noChildRows],
      ["itemAttachments", this.noChildRows],
      ["deletedItems", this.untrashed],
    ] as const) {
      if (items.length)
        db.run(sql`delete from ${sql.identifier(table)} where itemID in
          (select value from json_each(${JSON.stringify(items)}))`);
    }
    writeCollections(db, this.collections);
  }
}

function writeCollections(
  db: ZoteroDatabase,
  collections: ReadonlyMap<number, readonly number[]>,
): void {
  const existing = new Map<number, Set<number>>();
  for (const { itemID, collectionID } of db.all<{
    itemID: number;
    collectionID: number;
  }>(
    sql`select itemID, collectionID from collectionItems where itemID in (select value from json_each(${JSON.stringify([...collections.keys()])}))`,
  )) {
    const ids = existing.get(itemID);
    if (ids) ids.add(collectionID);
    else existing.set(itemID, new Set([collectionID]));
  }
  const additions: [number, number][] = [];
  const append = () => {
    if (!additions.length) return;
    const next = new Map(
      db
        .all<{ id: number; next: number }>(sql`select value as id,
      (select coalesce(max(orderIndex) + 1, 0) from collectionItems where collectionID = j.value) as next
      from json_each(${JSON.stringify([...new Set(additions.map(([id]) => id))])}) j`)
        .map((row) => [row.id, row.next]),
    );
    const rows = additions.map(([id, item]) => {
      const order = next.get(id)!;
      next.set(id, order + 1);
      return [id, item, order];
    });
    db.run(sql`insert into collectionItems (collectionID, itemID, orderIndex)
      select value ->> 0, value ->> 1, value ->> 2 from json_each(${JSON.stringify(rows)})`);
    additions.length = 0;
  };
  for (const [itemID, ids] of collections) {
    const stored = existing.get(itemID);
    const removed = stored && [...stored].filter((id) => !ids.includes(id));
    if (removed?.length) {
      append();
      db.run(sql`delete from collectionItems where itemID = ${itemID}
        and collectionID in (select value from json_each(${JSON.stringify(removed)}))`);
    }
    for (const id of new Set(ids)) {
      if (!stored?.has(id)) additions.push([id, itemID]);
    }
  }
  append();
}
