import type { ZoteroDatabase } from "#client/database.ts";
import type { LibraryType } from "#drizzle/schema.ts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { defineQuery } from "./_shared.ts";

import { groups, libraries } from "#drizzle/schema.ts";
import { readDatabaseLayout } from "#layout/index.ts";

export interface Library {
  libraryID: number;
  type: LibraryType;
  version: number;
  clientVersion: number | null;
  groupID: number | null;
  name: string | null;
}

export type LibraryColumns = { clientVersion: boolean };

export function selectLibraries(
  db: ZoteroDatabase,
  columns: LibraryColumns,
  where?: SQL,
) {
  return db
    .select({
      libraryID: libraries.libraryID,
      type: libraries.type,
      version: libraries.version,
      clientVersion: columns.clientVersion
        ? sql<number | null>`${libraries.clientVersion}`.mapWith(Number)
        : sql<number | null>`null`,
      groupID: groups.groupID,
      name: groups.name,
    })
    .from(libraries)
    .leftJoin(groups, eq(groups.libraryID, libraries.libraryID))
    .where(and(inArray(libraries.type, ["user", "group"]), where))
    .orderBy(asc(libraries.libraryID));
}

function libraryColumns(db: ZoteroDatabase): LibraryColumns {
  return {
    clientVersion: readDatabaseLayout(db).has("libraries", "clientVersion"),
  };
}

const librariesQuery = defineQuery<void>()(
  (db, _operators, columns: LibraryColumns) => selectLibraries(db, columns),
);

const libraryByGroupIDQuery = defineQuery<{ groupID: number }>()(
  (db, { placeholder }, columns: LibraryColumns) =>
    selectLibraries(
      db,
      columns,
      eq(groups.groupID, placeholder("groupID")),
    ).limit(1),
);

const libraryByIDQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }, columns: LibraryColumns) =>
    selectLibraries(
      db,
      columns,
      eq(libraries.libraryID, placeholder("libraryID")),
    ).limit(1),
);

export function getLibraries(db: ZoteroDatabase): Library[] {
  return librariesQuery.prepared(db, libraryColumns(db)).all();
}

export function getLibraryByGroupID(
  db: ZoteroDatabase,
  groupID: number,
): Library | null {
  return (
    libraryByGroupIDQuery
      .prepared(db, libraryColumns(db))
      .all({ groupID })[0] ?? null
  );
}

export function groupIDForLibrary(
  db: ZoteroDatabase,
  libraryID: number,
): number | null {
  return (
    libraryByIDQuery.prepared(db, libraryColumns(db)).all({ libraryID })[0]
      ?.groupID ?? null
  );
}

export type GroupIDMemo = Map<number, number | null>;

export function resolveGroupID(
  db: ZoteroDatabase,
  libraryID: number,
  memo: GroupIDMemo,
): number | null {
  const cached = memo.get(libraryID);
  if (cached !== undefined) return cached;
  const groupID = groupIDForLibrary(db, libraryID);
  memo.set(libraryID, groupID);
  return groupID;
}
