import type { CreatorFieldMode } from "#lib/zt-creator.ts";
import type { TagType } from "#lib/zt-tag.ts";
import type { BaseFieldTable } from "#queries/_base-fields.ts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { CollectionPaths } from "./collection-paths.ts";
import { defineStatement, idSlots } from "./database.ts";
import type {
  IdSlot,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "./database.ts";

import {
  baseFieldMappingsCombined,
  collectionItems,
  creators,
  creatorTypes,
  fieldsCombined,
  itemCreators,
  itemData,
  itemDataValues,
  items,
  itemTags,
  itemTypeCreatorTypes,
  tags,
} from "#drizzle/schema.ts";
import { buildTable } from "#queries/_base-fields.ts";

export const HYDRATE_CHUNK_SIZE = 250;

export interface FieldVocabulary {
  readonly customFieldNames: readonly string[];
  readonly fieldIDsOf: (name: string) => readonly number[];
  /** @internal The base-field table of one built-in field name. */
  readonly tableOf: (name: string) => BaseFieldTable<string>;
  /** @internal */
  readonly builtInID: ReadonlyMap<string, number>;
  /** @internal */
  readonly customID: ReadonlyMap<string, number>;
}

export interface HydrateFields {
  readonly builtIn: readonly string[];
  readonly custom: readonly string[];
}

export type HydrateRelation = "creators" | "tags" | "collections";

export interface HydratedCreator {
  readonly firstName: string;
  readonly lastName: string;
  readonly fieldMode: CreatorFieldMode;
  readonly creatorType: string;
  readonly primary: boolean;
}

export interface HydratedTag {
  readonly name: string;
  readonly type: TagType;
}

export interface HydratedItem {
  readonly fields: ReadonlyMap<string, string>;
  readonly custom: ReadonlyMap<string, string>;
  readonly creators?: readonly HydratedCreator[];
  readonly tags?: readonly HydratedTag[];
  readonly collections?: readonly (readonly string[])[];
}

const fieldsStatement = defineStatement<Record<string, never>>(
  "field-vocabulary",
)((db) =>
  db
    .select({
      fieldID: fieldsCombined.fieldID,
      fieldName: fieldsCombined.fieldName,
      custom: fieldsCombined.custom,
    })
    .from(fieldsCombined)
    .orderBy(fieldsCombined.fieldID),
);

const baseField = alias(fieldsCombined, "baseField");

const baseFieldMappingsStatement = defineStatement<Record<string, never>>(
  "field-vocabulary",
)((db) =>
  db
    .select({
      itemTypeID: baseFieldMappingsCombined.itemTypeID,
      fieldID: baseFieldMappingsCombined.fieldID,
      baseFieldName: baseField.fieldName,
    })
    .from(baseFieldMappingsCombined)
    .innerJoin(
      baseField,
      eq(baseField.fieldID, baseFieldMappingsCombined.baseFieldID),
    ),
);

export function readFieldVocabulary(): Effect.Effect<
  FieldVocabulary,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const fields = yield* fieldsStatement.all({});
    const mappings = yield* baseFieldMappingsStatement.all({});
    return yield* Effect.sync(() => {
      const builtIn = fields.filter((row) => row.custom === 0);
      const custom = fields.filter((row) => row.custom !== 0);
      const tables = new Map<string, BaseFieldTable<string>>();
      const tableOf = (name: string) => {
        let table = tables.get(name);
        if (!table) {
          table = buildTable(
            builtIn,
            mappings
              .filter((row) => row.baseFieldName === name)
              .map((row) => ({
                itemTypeID: row.itemTypeID,
                fieldID: row.fieldID,
                baseField: { fieldName: name },
              })),
            [name],
          );
          tables.set(name, table);
        }
        return table;
      };
      return {
        customFieldNames: custom.map((row) => row.fieldName),
        fieldIDsOf: (name: string) => tableOf(name).fieldIDs,
        builtInID: new Map(builtIn.map((row) => [row.fieldName, row.fieldID])),
        customID: new Map(custom.map((row) => [row.fieldName, row.fieldID])),
        tableOf,
      };
    });
  });
}

const ID_SLOTS = idSlots(HYDRATE_CHUNK_SIZE);

interface LoadingItem {
  fields: Map<string, string>;
  custom: Map<string, string>;
  creators?: HydratedCreator[];
  tags?: HydratedTag[];
  collections?: (readonly string[])[];
}

const fieldValuesStatement = defineStatement<
  Record<string, number | string | null>
>("hydrate-chunk")((db, { placeholder }) =>
  db
    .select({
      itemID: itemData.itemID,
      itemTypeID: items.itemTypeID,
      fieldID: itemData.fieldID,
      value: sql<
        string | number | null
      >`case typeof(${itemDataValues.value}) when 'integer' then cast(${itemDataValues.value} as text) else ${itemDataValues.value} end`,
    })
    .from(itemData)
    .innerJoin(items, eq(items.itemID, itemData.itemID))
    .innerJoin(itemDataValues, eq(itemDataValues.valueID, itemData.valueID))
    .where(
      and(
        inArray(
          itemData.itemID,
          ID_SLOTS.names.map((slot) => placeholder(slot)),
        ),
        sql`${itemData.fieldID} in (select value from json_each(${placeholder("fieldIDs")}))`,
      ),
    ),
);

const creatorsStatement = defineStatement<Record<IdSlot, number | null>>(
  "hydrate-chunk",
)((db, { placeholder }) =>
  db
    .select({
      itemID: itemCreators.itemID,
      firstName: creators.firstName,
      lastName: creators.lastName,
      fieldMode: creators.fieldMode,
      creatorType: creatorTypes.creatorType,
      primary: sql<number>`coalesce(${itemTypeCreatorTypes.primaryField}, 0)`,
    })
    .from(itemCreators)
    .innerJoin(creators, eq(creators.creatorID, itemCreators.creatorID))
    .innerJoin(
      creatorTypes,
      eq(creatorTypes.creatorTypeID, itemCreators.creatorTypeID),
    )
    .innerJoin(items, eq(items.itemID, itemCreators.itemID))
    .leftJoin(
      itemTypeCreatorTypes,
      and(
        eq(itemTypeCreatorTypes.itemTypeID, items.itemTypeID),
        eq(itemTypeCreatorTypes.creatorTypeID, itemCreators.creatorTypeID),
      ),
    )
    .where(
      inArray(
        itemCreators.itemID,
        ID_SLOTS.names.map((slot) => placeholder(slot)),
      ),
    )
    .orderBy(asc(itemCreators.itemID), asc(itemCreators.orderIndex)),
);

const tagsStatement = defineStatement<Record<IdSlot, number | null>>(
  "hydrate-chunk",
)((db, { placeholder }) =>
  db
    .select({ itemID: itemTags.itemID, name: tags.name, type: itemTags.type })
    .from(itemTags)
    .innerJoin(tags, eq(tags.tagID, itemTags.tagID))
    .where(
      inArray(
        itemTags.itemID,
        ID_SLOTS.names.map((slot) => placeholder(slot)),
      ),
    ),
);

const membershipsStatement = defineStatement<Record<IdSlot, number | null>>(
  "hydrate-chunk",
)((db, { placeholder }) =>
  db
    .select({
      itemID: collectionItems.itemID,
      collectionID: collectionItems.collectionID,
    })
    .from(collectionItems)
    .where(
      inArray(
        collectionItems.itemID,
        ID_SLOTS.names.map((slot) => placeholder(slot)),
      ),
    ),
);

export function readHydrateChunk(chunk: {
  vocabulary: FieldVocabulary;
  itemIDs: readonly number[];
  fields: HydrateFields;
  relations?: readonly HydrateRelation[];
  collectionPaths?: CollectionPaths;
}): Effect.Effect<
  ReadonlyMap<number, HydratedItem>,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  const { vocabulary, itemIDs, fields, relations = [] } = chunk;
  if (itemIDs.length > HYDRATE_CHUNK_SIZE) {
    return Effect.die(
      new RangeError(
        `A hydrate chunk holds at most ${HYDRATE_CHUNK_SIZE} Items, not ${itemIDs.length}.`,
      ),
    );
  }
  return Effect.gen(function* () {
    const result = new Map<number, LoadingItem>();
    for (const id of itemIDs) {
      const item: LoadingItem = { fields: new Map(), custom: new Map() };
      if (relations.includes("creators")) item.creators = [];
      if (relations.includes("tags")) item.tags = [];
      if (relations.includes("collections")) item.collections = [];
      result.set(id, item);
    }
    if (itemIDs.length === 0) return result;
    const slots = ID_SLOTS.bind(itemIDs);

    const tables = fields.builtIn.map(
      (name) => [name, vocabulary.tableOf(name)] as const,
    );
    const customByID = new Map<number, string>();
    for (const name of fields.custom) {
      const id = vocabulary.customID.get(name);
      if (id !== undefined) customByID.set(id, name);
    }
    const fieldIDs = new Set<number>(customByID.keys());
    for (const [, table] of tables) {
      for (const id of table.fieldIDs) fieldIDs.add(id);
    }
    if (fieldIDs.size > 0) {
      const rows = yield* fieldValuesStatement.all({
        ...slots,
        fieldIDs: JSON.stringify([...fieldIDs]),
      });
      yield* Effect.sync(() => {
        for (const row of rows) {
          const item = result.get(row.itemID!);
          if (!item || row.fieldID === null || row.value == null) continue;
          const value = String(row.value);
          const custom = customByID.get(row.fieldID);
          if (custom !== undefined) item.custom.set(custom, value);
          for (const [name, table] of tables) {
            if (table.resolve(row.itemTypeID, row.fieldID) !== name) continue;
            const isOwnField = vocabulary.builtInID.get(name) === row.fieldID;
            if (isOwnField && item.fields.has(name)) continue;
            item.fields.set(name, value);
          }
        }
      });
    }

    if (relations.includes("creators")) {
      const rows = yield* creatorsStatement.all(slots);
      yield* Effect.sync(() => {
        for (const { itemID, ...creator } of rows) {
          result.get(itemID)?.creators?.push({
            firstName: creator.firstName ?? "",
            lastName: creator.lastName ?? "",
            fieldMode: creator.fieldMode ?? 0,
            creatorType: creator.creatorType ?? "",
            primary: creator.primary === 1,
          });
        }
      });
    }

    if (relations.includes("tags")) {
      const rows = yield* tagsStatement.all(slots);
      yield* Effect.sync(() => {
        for (const { itemID, name, type } of rows) {
          result.get(itemID)?.tags?.push({ name, type });
        }
      });
    }

    if (relations.includes("collections")) {
      const paths = chunk.collectionPaths;
      if (!paths) {
        return yield* Effect.die(
          new TypeError("Loading collections needs the Collection paths."),
        );
      }
      const rows = yield* membershipsStatement.all(slots);
      yield* Effect.sync(() => {
        for (const { itemID, collectionID } of rows) {
          const path = paths.get(collectionID);
          if (path) result.get(itemID)?.collections?.push(path);
        }
      });
    }

    return result;
  });
}
