import type { ZoteroDatabase } from "#client/database.ts";

import type { QueryRow } from "./_shared.ts";
import { defineQuery } from "./_shared.ts";

export interface BaseFieldTable<TName extends string> {
  readonly fieldIDs: readonly number[];
  resolve(itemTypeID: number, fieldID: number | null): TName | null;
}

const canonicalFieldsQuery = defineQuery<void>()(
  (db, _operators, args: { names: readonly string[] }) =>
    db.query.fieldsCombined.findMany({
      where: { fieldName: { in: [...args.names] } },
      columns: { fieldID: true, fieldName: true },
    }),
);

const aliasFieldsQuery = defineQuery<void>()(
  (db, _operators, args: { names: readonly string[] }) =>
    db.query.baseFieldMappingsCombined.findMany({
      where: { baseField: { fieldName: { in: [...args.names] } } },
      columns: { itemTypeID: true, fieldID: true },
      with: { baseField: { columns: { fieldName: true } } },
    }),
);

type CanonicalFieldRow = QueryRow<typeof canonicalFieldsQuery>;
type AliasFieldRow = QueryRow<typeof aliasFieldsQuery>;

const tablesByClient = new WeakMap<
  object,
  Map<string, BaseFieldTable<string>>
>();

export function getBaseFieldTable<TName extends string>(
  db: ZoteroDatabase,
  names: readonly TName[],
): BaseFieldTable<TName> {
  const cached = readCache<TName>(db, names);
  if (cached) return cached;
  const args = { names: [...names] };
  return writeCache(
    db,
    names,
    buildTable(
      canonicalFieldsQuery.prepared(db, args).all(),
      aliasFieldsQuery.prepared(db, args).all(),
      names,
    ),
  );
}

function cacheKey(names: readonly string[]): string {
  return [...names].sort().join(" ");
}

function readCache<TName extends string>(
  db: object,
  names: readonly TName[],
): BaseFieldTable<TName> | null {
  return (tablesByClient.get(db)?.get(cacheKey(names)) ??
    null) as BaseFieldTable<TName> | null;
}

function writeCache<TName extends string>(
  db: object,
  names: readonly TName[],
  table: BaseFieldTable<TName>,
): BaseFieldTable<TName> {
  let perDb = tablesByClient.get(db);
  if (!perDb) {
    perDb = new Map();
    tablesByClient.set(db, perDb);
  }
  perDb.set(cacheKey(names), table);
  return table;
}

export function buildTable<TName extends string>(
  canonicalRows: readonly CanonicalFieldRow[],
  aliasRows: readonly AliasFieldRow[],
  names: readonly TName[],
): BaseFieldTable<TName> {
  const tracked = new Set<string>(names);
  const isTracked = (value: string | undefined | null): value is TName =>
    value != null && tracked.has(value);

  const canonicalByFieldID = new Map<number, TName>();
  for (const row of canonicalRows) {
    if (isTracked(row.fieldName)) {
      canonicalByFieldID.set(row.fieldID, row.fieldName);
    }
  }

  const aliasByTypeAndField = new Map<string, TName>();
  const fieldIDs = new Set<number>(canonicalByFieldID.keys());
  for (const row of aliasRows) {
    if (row.fieldID == null) continue;
    fieldIDs.add(row.fieldID);
    if (row.itemTypeID == null) continue;
    const canonical = row.baseField?.fieldName;
    if (!isTracked(canonical)) continue;
    aliasByTypeAndField.set(`${row.itemTypeID}:${row.fieldID}`, canonical);
  }

  return {
    fieldIDs: [...fieldIDs],
    resolve(itemTypeID, fieldID) {
      if (fieldID == null) return null;
      return (
        aliasByTypeAndField.get(`${itemTypeID}:${fieldID}`) ??
        canonicalByFieldID.get(fieldID) ??
        null
      );
    },
  };
}
