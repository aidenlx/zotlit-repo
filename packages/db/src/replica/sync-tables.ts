import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";

export const SYNC_TABLES = [
  "replicaSyncAccount",
  "replicaSyncLibraries",
  "replicaSyncObjects",
  "replicaSyncDeletions",
  "replicaSyncSettings",
  "replicaSyncMeta",
  "replicaSyncReadTimes",
] as const;

export const SYNC_DDL: readonly string[] = [
  `create index if not exists replicaCollectionOrder on collectionItems (collectionID, orderIndex)`,
  `create table if not exists replicaSyncAccount (
    account integer primary key check (account = 1),
    userID integer not null,
    username text not null)`,
  `create table if not exists replicaSyncLibraries (
    libraryType text not null check (libraryType in ('user', 'group')),
    remoteID integer not null,
    state text not null check (state in ('idle', 'downloading', 'complete', 'remove')),
    sinceVersion integer not null default 0,
    targetVersion integer,
    notesAccess integer,
    targetNotesAccess integer,
    targetRebuild integer,
    groupJSON text,
    lastSync integer,
    primary key (libraryType, remoteID)) without rowid`,
  `create table if not exists replicaSyncObjects (
    libraryType text not null,
    remoteID integer not null,
    objectType text not null check (objectType in ('collection', 'item')),
    key text not null,
    version integer not null,
    state text not null check (state in ('pending', 'deferred', 'skipped')),
    vocabularyVersion integer,
    parentKey text,
    json text not null,
    primary key (libraryType, remoteID, objectType, key)) without rowid`,
  `create index if not exists replicaSyncObjectState on replicaSyncObjects (libraryType, remoteID, state, vocabularyVersion)`,
  `create table if not exists replicaSyncDeletions (
    libraryType text not null,
    remoteID integer not null,
    objectType text not null check (objectType in ('collection', 'item')),
    key text not null,
    primary key (libraryType, remoteID, objectType, key)) without rowid`,
  `create table if not exists replicaSyncSettings (
    libraryType text not null,
    remoteID integer not null,
    key text not null,
    value integer,
    primary key (libraryType, remoteID, key)) without rowid`,
  `create table if not exists replicaSyncMeta (
    key text primary key,
    value text not null) without rowid`,
  `create table if not exists replicaSyncReadTimes (
    key text primary key,
    lastRead integer not null) without rowid`,
];

const ADDED_LIBRARY_COLUMNS = [
  "notesAccess",
  "targetNotesAccess",
  "targetRebuild",
] as const;

function hasTable(db: ZoteroDatabase, name: string): boolean {
  return (
    db.get(
      sql`select 1 from sqlite_master where type = 'table' and name = ${name}`,
    ) !== undefined
  );
}

export function ensureSyncTables(db: ZoteroDatabase): void {
  const keepsReadTimes = hasTable(db, "replicaSyncReadTimes");
  for (const statement of SYNC_DDL) db.run(sql.raw(statement));
  if (!keepsReadTimes && hasTable(db, "itemAttachments"))
    db.run(
      sql`insert into replicaSyncReadTimes (key, lastRead)
        select 'lastRead_g' || g.groupID || '_' || i.key, a.lastRead
        from itemAttachments a join items i using (itemID) join groups g using (libraryID)
        where a.lastRead is not null`,
    );
  const present = new Set(
    db
      .all<{ name: string }>(sql`pragma table_info(replicaSyncLibraries)`)
      .map((column) => column.name),
  );
  for (const column of ADDED_LIBRARY_COLUMNS)
    if (!present.has(column))
      db.run(
        sql`alter table replicaSyncLibraries add column ${sql.identifier(column)} integer`,
      );
}
