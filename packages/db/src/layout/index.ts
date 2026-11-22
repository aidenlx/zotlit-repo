import type { ZoteroDatabase } from "#client/database.ts";
import { inArray, sql } from "drizzle-orm";

import { logLibrary } from "@zotlit/shared/logging";

import { version } from "#drizzle/schema.ts";
import { defineQuery } from "#queries/_shared.ts";

export const ITEM_QUERY_LAYOUT = {
  items: [
    "itemID",
    "itemTypeID",
    "libraryID",
    "key",
    "dateAdded",
    "dateModified",
  ],
  itemTypesCombined: ["itemTypeID", "typeName"],
  deletedItems: ["itemID"],
  fieldsCombined: ["fieldID", "fieldName", "custom"],
  baseFieldMappingsCombined: ["itemTypeID", "fieldID", "baseFieldID"],
  itemData: ["itemID", "fieldID", "valueID"],
  itemDataValues: ["valueID", "value"],
  creators: ["creatorID", "firstName", "lastName", "fieldMode"],
  creatorTypes: ["creatorTypeID", "creatorType"],
  itemCreators: ["itemID", "creatorID", "creatorTypeID", "orderIndex"],
  itemTypeCreatorTypes: ["itemTypeID", "creatorTypeID", "primaryField"],
  tags: ["tagID", "name"],
  itemTags: ["itemID", "tagID", "type"],
  collections: [
    "collectionID",
    "collectionName",
    "parentCollectionID",
    "libraryID",
  ],
  deletedCollections: ["collectionID"],
  collectionItems: ["itemID", "collectionID"],
  itemAttachments: [
    "itemID",
    "parentItemID",
    "lastRead",
    "linkMode",
    "contentType",
    "path",
  ],
  itemAnnotations: [
    "itemID",
    "parentItemID",
    "type",
    "text",
    "comment",
    "color",
    "pageLabel",
    "sortIndex",
    "position",
    "authorName",
  ],
  itemNotes: ["itemID", "parentItemID", "title"],
  libraries: ["libraryID", "type", "version"],
  groups: ["groupID", "libraryID", "name"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export const OPTIONAL_LAYOUT_COLUMNS = {
  libraries: ["clientVersion"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export const ZOTERO_CORE_TABLES = ["items", "libraries"] as const;

export class NotZoteroDatabaseError extends Error {
  override readonly name = "NotZoteroDatabaseError";
  constructor() {
    super(
      "This file is not a Zotero database. Check the Zotero data directory in ZotLit settings.",
    );
  }
}

export interface LayoutGap {
  readonly table: string;
  readonly column: string | null;
}

export interface LayoutVersions {
  readonly userdata: number | null;
  readonly compatibility: number | null;
}

export interface DatabaseLayout {
  readonly columns: ReadonlyMap<string, ReadonlySet<string>>;
  readonly versions: LayoutVersions;
  readonly missing: readonly LayoutGap[];
  readonly isZoteroDatabase: boolean;
  has(table: string, column: string): boolean;
}

export function findLayoutGaps(
  columns: ReadonlyMap<string, ReadonlySet<string>>,
): LayoutGap[] {
  const gaps: LayoutGap[] = [];
  for (const [table, expected] of Object.entries(ITEM_QUERY_LAYOUT)) {
    const present = columns.get(table);
    if (!present) {
      gaps.push({ table, column: null });
      continue;
    }
    for (const column of expected) {
      if (!present.has(column)) gaps.push({ table, column });
    }
  }
  return gaps;
}

export function describeLayoutGaps(missing: readonly LayoutGap[]): string {
  return missing
    .map(({ table, column }) =>
      column === null ? `the table ${table}` : `${table}.${column}`,
    )
    .join(", ");
}

/** @internal The columns of each table and view of the copy. */
export const selectLayoutColumns = (db: ZoteroDatabase) =>
  db
    .select({
      table: sql<string>`m.name`,
      column: sql<string>`c.name`,
    })
    .from(
      sql`sqlite_schema as m join pragma_table_info(m.name) as c where m.type in ('table', 'view')`,
    );

/** @internal The `userdata` and `compatibility` stamps of the copy. */
export const selectLayoutVersions = (db: ZoteroDatabase) =>
  db
    .select({ schema: version.schema, version: version.version })
    .from(version)
    .where(inArray(version.schema, ["userdata", "compatibility"]));

/** @internal A row of {@link selectLayoutColumns}. */
export interface LayoutColumnRow {
  table: string;
  column: string;
}

/** @internal A row of {@link selectLayoutVersions}. */
export interface LayoutVersionRow {
  schema: string;
  version: number;
}

const columnsQuery = defineQuery<void>()(selectLayoutColumns);
const versionsQuery = defineQuery<void>()(selectLayoutVersions);

const layouts = new WeakMap<ZoteroDatabase, DatabaseLayout>();

/** @internal The layout already read for `client`, if any. */
export function knownLayout(
  client: ZoteroDatabase,
): DatabaseLayout | undefined {
  return layouts.get(client);
}

/** @internal The columns of the copy, by table. */
export function columnsByTable(
  rows: readonly LayoutColumnRow[],
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    [...Map.groupBy(rows, (row) => row.table)].map(([table, group]) => [
      table,
      new Set(group.map((row) => row.column)),
    ]),
  );
}

/** @internal Whether the copy has a `version` table to read the stamps from. */
export function hasVersionStamps(
  columns: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const stamped = columns.get("version");
  return !!stamped?.has("schema") && !!stamped.has("version");
}

/**
 * @internal Keep the layout of `client` from the rows of its two statements
 * and log its stamps. Call it once for each copy, after
 * {@link knownLayout} gave nothing.
 */
export function recordLayout(
  client: ZoteroDatabase,
  columns: ReadonlyMap<string, ReadonlySet<string>>,
  versionRows: readonly LayoutVersionRow[],
): DatabaseLayout {
  const stamp = (schema: string) =>
    versionRows.find((row) => row.schema === schema)?.version ?? null;
  const versions: LayoutVersions = {
    userdata: stamp("userdata"),
    compatibility: stamp("compatibility"),
  };
  const missing = findLayoutGaps(columns);
  const layout: DatabaseLayout = {
    columns,
    versions,
    missing,
    isZoteroDatabase: ZOTERO_CORE_TABLES.every((table) => columns.has(table)),
    has: (table, column) => columns.get(table)?.has(column) ?? false,
  };
  layouts.set(client, layout);
  if (missing.length > 0) {
    logLibrary({
      level: "warn",
      category: ["zotlit", "db", "layout"],
      message:
        "The readers cannot read the layout of the Zotero database (userdata {userdata}, compatibility {compatibility}). Missing: {missing}",
      properties: { ...versions, missing: describeLayoutGaps(missing) },
    });
  } else {
    logLibrary({
      level: "debug",
      category: ["zotlit", "db", "layout"],
      message:
        "Read the layout of the Zotero database (userdata {userdata}, compatibility {compatibility})",
      properties: { ...versions },
    });
  }
  return layout;
}

export function readDatabaseLayout(client: ZoteroDatabase): DatabaseLayout {
  const known = knownLayout(client);
  if (known) return known;
  const columns = columnsByTable(columnsQuery.prepared(client).all());
  const versionRows = hasVersionStamps(columns)
    ? versionsQuery.prepared(client).all()
    : [];
  return recordLayout(client, columns, versionRows);
}
