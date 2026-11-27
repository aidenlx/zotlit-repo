import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";

import { ZOTERO_VOCABULARY } from "@zotlit/zotero-types/vocabulary";
import type { ZoteroVocabulary } from "@zotlit/zotero-types/vocabulary";

export function writeVocabulary(
  db: ZoteroDatabase,
  vocabulary: ZoteroVocabulary = ZOTERO_VOCABULARY,
): void {
  const fieldIDs = new Map<string, number>();
  const creatorTypeIDs = new Map<string, number>();
  for (const { fields, creatorTypes } of vocabulary.itemTypes) {
    for (const { field, baseField } of fields) {
      for (const name of baseField ? [field, baseField] : [field]) {
        if (!fieldIDs.has(name)) fieldIDs.set(name, fieldIDs.size + 1);
      }
    }
    for (const { creatorType } of creatorTypes) {
      if (!creatorTypeIDs.has(creatorType)) {
        creatorTypeIDs.set(creatorType, creatorTypeIDs.size + 1);
      }
    }
  }
  for (const [name, id] of fieldIDs) {
    db.run(
      sql`insert into fieldsCombined (fieldID, fieldName, label, fieldFormatID, custom) values (${id}, ${name}, null, null, 0)`,
    );
  }
  for (const [name, id] of creatorTypeIDs) {
    db.run(
      sql`insert into creatorTypes (creatorTypeID, creatorType) values (${id}, ${name})`,
    );
  }
  for (const [
    index,
    { itemType, fields, creatorTypes },
  ] of vocabulary.itemTypes.entries()) {
    const itemTypeID = index + 1;
    db.run(
      sql`insert into itemTypes (itemTypeID, typeName, templateItemTypeID, display) values (${itemTypeID}, ${itemType}, null, 1)`,
    );
    db.run(
      sql`insert into itemTypesCombined (itemTypeID, typeName, display, custom) values (${itemTypeID}, ${itemType}, 1, 0)`,
    );
    for (const { field, baseField } of fields) {
      if (!baseField) continue;
      db.run(
        sql`insert into baseFieldMappingsCombined (itemTypeID, baseFieldID, fieldID) values (${itemTypeID}, ${fieldIDs.get(baseField)!}, ${fieldIDs.get(field)!})`,
      );
    }
    for (const { creatorType, primary } of creatorTypes) {
      db.run(
        sql`insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField) values (${itemTypeID}, ${creatorTypeIDs.get(creatorType)!}, ${primary ? 1 : 0})`,
      );
    }
  }
}

export interface ReplicaVocabulary {
  itemTypeID(name: string): number | undefined;
  creatorTypeID(name: string): number | undefined;
  creatorTypeForItem(
    itemType: string,
    creatorType: string,
  ): { id: number; valid: boolean } | undefined;
  fieldForType(
    itemType: string,
    field: string,
  ): { id: number; name: string } | undefined;
  isField(field: string): boolean;
  isDateField(field: string): boolean;
}

const vocabularies = new WeakMap<ZoteroDatabase, ReplicaVocabulary>();

export function readVocabulary(
  db: ZoteroDatabase,
  vocabulary: ZoteroVocabulary = ZOTERO_VOCABULARY,
): ReplicaVocabulary {
  const known = vocabularies.get(db);
  if (known) return known;
  const ids = (rows: { name: string; id: number }[]) =>
    new Map(rows.map((row) => [row.name, Number(row.id)]));
  const itemTypeIDs = ids(
    db.all(
      sql`select typeName as name, itemTypeID as id from itemTypesCombined where custom = 0`,
    ),
  );
  const fieldIDs = ids(
    db.all(
      sql`select fieldName as name, fieldID as id from fieldsCombined where custom = 0`,
    ),
  );
  const creatorTypeIDs = ids(
    db.all(
      sql`select creatorType as name, creatorTypeID as id from creatorTypes`,
    ),
  );

  const typeCreators = new Map<
    string,
    { names: Set<string>; primary: string | undefined }
  >();
  for (const { itemType, creatorTypes } of vocabulary.itemTypes) {
    typeCreators.set(itemType, {
      names: new Set(creatorTypes.map((type) => type.creatorType)),
      primary: creatorTypes.find((type) => type.primary)?.creatorType,
    });
  }
  const typeFields = new Map<string, Map<string, string>>();
  for (const { itemType, fields } of vocabulary.itemTypes) {
    const byName = new Map<string, string>();
    for (const { field, baseField } of fields) {
      byName.set(field, field);
      if (baseField) byName.set(baseField, field);
    }
    typeFields.set(itemType, byName);
  }
  const dateFields = new Set(vocabulary.dateFields);
  const allFields = new Set(
    [...typeFields.values()].flatMap((m) => [...m.keys()]),
  );

  const model: ReplicaVocabulary = {
    itemTypeID: (name) => itemTypeIDs.get(name),
    creatorTypeID: (name) => creatorTypeIDs.get(name),
    creatorTypeForItem: (itemType, creatorType) => {
      const types = typeCreators.get(itemType);
      if (types?.names.has(creatorType)) {
        const id = creatorTypeIDs.get(creatorType);
        if (id !== undefined) return { id, valid: true };
      }
      const id =
        types?.primary === undefined
          ? undefined
          : creatorTypeIDs.get(types.primary);
      return id === undefined ? undefined : { id, valid: false };
    },
    fieldForType: (itemType, field) => {
      const name = typeFields.get(itemType)?.get(field);
      const id = name === undefined ? undefined : fieldIDs.get(name);
      return id === undefined || name === undefined ? undefined : { id, name };
    },
    isField: (field) => allFields.has(field),
    isDateField: (field) => dateFields.has(field),
  };
  vocabularies.set(db, model);
  return model;
}
