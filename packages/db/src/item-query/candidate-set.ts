import { and, count, eq, gt, lte, max, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { TagCandidateLeaf, KeysCandidateLeaf } from "./candidate-leaf.ts";
import { candidateTag } from "./candidate-predicates.ts";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database.ts";
import { defineStatement, unindexed } from "./database.ts";

import {
  collectionItems,
  itemData,
  itemDataValues,
  items,
  itemTags,
} from "#drizzle/schema.ts";

const libraryRowCountStatement = defineStatement<{ libraryID: number }>(
  "library-row-count",
)((db, { placeholder }) =>
  db
    .select({ rows: count() })
    .from(items)
    .where(eq(items.libraryID, placeholder("libraryID"))),
);

export function readLibraryRowCount(
  libraryID: number,
): Effect.Effect<number, ItemQueryReaderError, ItemQueryDatabase> {
  return Effect.map(
    libraryRowCountStatement.all({ libraryID }),
    (rows) => rows[0]?.rows ?? 0,
  );
}

export type CandidateLeaf = SeekCandidateLeaf | TextSweepCandidateLeaf;

export interface TextSweepCandidateLeaf {
  readonly kind: "text-sweep";
  readonly fieldIDs: readonly number[];
  readonly pattern: string;
}

export type SeekCandidateLeaf =
  | TagCandidateLeaf
  | { readonly kind: "key"; readonly key: string }
  | KeysCandidateLeaf
  | {
      readonly kind: "field";
      readonly fieldIDs: readonly number[];
      readonly value: string;
    }
  | { readonly kind: "collection"; readonly collectionIDs: readonly number[] };

interface CandidateParams extends Record<string, unknown> {
  libraryID: number;
  limit: number;
  afterItemID: number;
}

interface ValueParams extends CandidateParams {
  value: string;
}

interface FieldParams extends ValueParams {
  fieldIDs: string;
  number: number | null;
  integer: bigint | null;
}

interface CollectionParams extends CandidateParams {
  collectionIDs: string;
}

const statements = (bounded: boolean) =>
  ({
    keys: defineStatement<ValueParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
      db
        .select({ itemID: items.itemID })
        .from(items)
        .where(
          and(
            eq(items.libraryID, placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
            sql`${items.key} in (select value from json_each(${placeholder("value")}))`,
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
    tag: defineStatement<ValueParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
      db
        .select({ itemID: itemTags.itemID })
        .from(itemTags)
        .innerJoin(items, eq(items.itemID, itemTags.itemID))
        .where(
          and(
            candidateTag(db, placeholder("value")),
            eq(unindexed(items.libraryID), placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
    key: defineStatement<ValueParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
      db
        .select({ itemID: items.itemID })
        .from(items)
        .where(
          and(
            eq(items.libraryID, placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
            eq(items.key, placeholder("value")),
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
    field: defineStatement<FieldParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
      db
        .selectDistinct({ itemID: items.itemID })
        .from(itemDataValues)
        .innerJoin(
          itemData,
          eq(itemData.valueID, unindexed(itemDataValues.valueID)),
        )
        .innerJoin(items, eq(items.itemID, itemData.itemID))
        .where(
          and(
            or(
              eq(itemDataValues.value, placeholder("value")),
              eq(itemDataValues.value, placeholder("number")),
              eq(itemDataValues.value, placeholder("integer")),
            ),
            sql`${unindexed(itemData.fieldID)} in (select value from json_each(${placeholder("fieldIDs")}))`,
            eq(unindexed(items.libraryID), placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
    collection: defineStatement<CollectionParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
      db
        .selectDistinct({ itemID: items.itemID })
        .from(collectionItems)
        .innerJoin(items, eq(items.itemID, collectionItems.itemID))
        .where(
          and(
            sql`${collectionItems.collectionID} in (select value from json_each(${placeholder("collectionIDs")}))`,
            eq(unindexed(items.libraryID), placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
  }) satisfies Record<SeekCandidateLeaf["kind"], unknown>;

const candidateStatements = statements(false);
const parentStatements = statements(true);

export function storedNumberOf(value: string): number | null {
  const number = Number(value);
  return Number.isNaN(number) || String(number) !== value ? null : number;
}

export function storedIntegerOf(value: string): bigint | null {
  try {
    const integer = BigInt(value);
    if (
      String(integer) === value &&
      integer >= -(2n ** 63n) &&
      integer < 2n ** 63n
    ) {
      return integer;
    }
  } catch {
    // The text does not name an INTEGER.
  }
  return null;
}

function leafRows(
  leaf: SeekCandidateLeaf,
  scope: CandidateParams,
  statements = candidateStatements,
): Effect.Effect<
  { itemID: number }[],
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  switch (leaf.kind) {
    case "tag":
      return statements.tag.all({ ...scope, value: leaf.value });
    case "keys":
      return statements.keys.all({
        ...scope,
        value: JSON.stringify(leaf.keys),
      });
    case "key":
      return statements.key.all({ ...scope, value: leaf.key });
    case "field":
      return statements.field.all({
        ...scope,
        value: leaf.value,
        number: storedNumberOf(leaf.value),
        integer: storedIntegerOf(leaf.value),
        fieldIDs: JSON.stringify(leaf.fieldIDs),
      });
    case "collection":
      return statements.collection.all({
        ...scope,
        collectionIDs: JSON.stringify(leaf.collectionIDs),
      });
  }
}

export function readCandidateSet(candidates: {
  libraryID: number;
  leaf: SeekCandidateLeaf;
  limit: number;
  afterItemID?: number;
}): Effect.Effect<number[], ItemQueryReaderError, ItemQueryDatabase> {
  const { libraryID, leaf, limit, afterItemID = 0 } = candidates;
  return Effect.map(leafRows(leaf, { libraryID, limit, afterItemID }), (rows) =>
    rows.map((row) => row.itemID),
  );
}

export function readBoundedCandidateSet(candidates: {
  libraryID: number;
  leaf: SeekCandidateLeaf;
  limit: number;
}) {
  const { libraryID, leaf, limit } = candidates;
  return Effect.map(
    leafRows(leaf, { libraryID, limit, afterItemID: 0 }, parentStatements),
    (rows) => rows.map((row) => row.itemID),
  );
}

export const TEXT_SWEEP_WINDOW_SIZE = 2_000;

const maxItemIDStatement = defineStatement<Record<string, never>>(
  "max-item-id",
)((db) => db.select({ itemID: max(items.itemID) }).from(items));

export const readMaxItemID = Effect.map(
  maxItemIDStatement.all({}),
  (rows) => rows[0]?.itemID ?? 0,
);

const textSweepStatement = defineStatement<{
  libraryID: number;
  afterItemID: number;
  throughItemID: number;
  fieldIDs: string;
  pattern: string;
  limit: number;
}>("text-sweep-window")((db, { placeholder: p }) =>
  db
    .selectDistinct({ itemID: itemData.itemID })
    .from(itemData)
    .crossJoin(itemDataValues)
    .crossJoin(items)
    .where(
      and(
        gt(itemData.itemID, p("afterItemID")),
        lte(itemData.itemID, p("throughItemID")),
        sql`${unindexed(itemData.fieldID)} in (select value from json_each(${p("fieldIDs")}))`,
        eq(itemDataValues.valueID, itemData.valueID),
        sql`(typeof(${itemDataValues.value}) <> 'text' OR instr(${itemDataValues.value}, char(0)) > 0 OR ${itemDataValues.value} LIKE ${p("pattern")})`,
        eq(items.itemID, itemData.itemID),
        eq(unindexed(items.libraryID), p("libraryID")),
      ),
    )
    .orderBy(itemData.itemID)
    .limit(p("limit")),
);

export function readTextSweepWindow({
  leaf,
  ...page
}: {
  libraryID: number;
  leaf: TextSweepCandidateLeaf;
  afterItemID: number;
  limit: number;
}) {
  return Effect.map(
    textSweepStatement.all({
      ...page,
      throughItemID: page.afterItemID + TEXT_SWEEP_WINDOW_SIZE,
      fieldIDs: JSON.stringify(leaf.fieldIDs),
      pattern: leaf.pattern,
    }),
    (rows) => rows.map((row) => row.itemID!),
  );
}
