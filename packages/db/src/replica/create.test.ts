import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { openPristineDatabase } from "@zotlit/db-testing/scenario";

import { createReplica, writeReplicaAccount } from "./create.ts";
import {
  REPLICA_DDL,
  REPLICA_SCHEMA_VERSIONS,
  REPLICA_TABLES,
} from "./layout.generated.ts";
import { beginLibraryPass, committedNotesAccess } from "./sync-store.ts";
import { ensureSyncTables } from "./sync-tables.ts";

import { connectClient } from "#desktop/node-client.ts";
import { checkDatabaseLayout } from "#item-query/layout.ts";
import { getZoteroDatabaseIdentity } from "#queries/account.ts";
import { getLibraries } from "#queries/libraries.ts";
import { getSchemaVersions } from "#queries/schema-version.ts";

function openReplica(seed = 7) {
  const sqlite = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: false,
  });
  const db = connectClient(sqlite);
  createReplica(db, {
    randomBytes: (length) => Uint8Array.from({ length }, (_, i) => i * seed),
  });
  return { sqlite, db };
}

describe("the replica layout", () => {
  it("holds the generated DDL equal to the pristine Zotero database", () => {
    using pristine = openPristineDatabase();
    const schema = pristine
      .prepare(
        "select type, name, tbl_name as tableName, sql from sqlite_schema where sql is not null and type in ('table', 'index') order by rowid",
      )
      .all() as {
      type: string;
      name: string;
      tableName: string;
      sql: string;
    }[];
    const tables = new Set<string>(REPLICA_TABLES);
    expect(REPLICA_DDL).toEqual(
      schema.filter((row) => tables.has(row.tableName)).map((row) => row.sql),
    );
    expect(
      schema.filter((row) => row.type === "table" && tables.has(row.name))
        .length,
    ).toBe(REPLICA_TABLES.length);
    const versions = pristine
      .prepare(
        "select schema, version from version where schema in ('userdata', 'compatibility') order by schema",
      )
      .all();
    expect(versions).toEqual([
      {
        schema: "compatibility",
        version: REPLICA_SCHEMA_VERSIONS.compatibility,
      },
      { schema: "userdata", version: REPLICA_SCHEMA_VERSIONS.userdata },
    ]);
  });

  it("gives an empty replica that the layout check of the readers accepts", () => {
    const { db } = openReplica();
    expect(() => checkDatabaseLayout(db)).not.toThrow();
    expect(getSchemaVersions(db)).toMatchObject({
      userdata: 129,
      compatibility: 9,
    });
    expect(getLibraries(db)).toEqual([
      expect.objectContaining({ libraryID: 1, type: "user", groupID: null }),
    ]);
  });

  it("has a stable database identity that differs from each Zotero file", () => {
    const { db } = openReplica();
    writeReplicaAccount(db, { userID: 7654321, username: "reader" });
    const identity = getZoteroDatabaseIdentity(db);
    expect(identity).toEqual({
      userID: 7654321,
      localUserKey: expect.stringMatching(/^replica-[0-9a-z]{16}$/),
      serverID: null,
    });
    writeReplicaAccount(db, { userID: 7654321, username: "renamed" });
    expect(getZoteroDatabaseIdentity(db)).toEqual(identity);
    using pristine = openPristineDatabase();
    const zoteroKey = getZoteroDatabaseIdentity(
      connectClient(pristine),
    ).localUserKey;
    expect(zoteroKey).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(identity.localUserKey).not.toBe(zoteroKey);
    expect(getZoteroDatabaseIdentity(openReplica(11).db).localUserKey).not.toBe(
      identity.localUserKey,
    );
  });

  it("has the vocabulary rows and IDs that Zotero gives a new database", () => {
    const { sqlite } = openReplica();
    using pristine = openPristineDatabase();
    const queries = [
      "select itemTypeID, typeName, display, custom from itemTypesCombined order by itemTypeID",
      "select itemTypeID, typeName, display from itemTypes order by itemTypeID",
      "select fieldID, fieldName, label, custom from fieldsCombined order by fieldID",
      "select creatorTypeID, creatorType from creatorTypes order by creatorTypeID",
      "select itemTypeID, creatorTypeID, primaryField from itemTypeCreatorTypes order by 1, 2",
      "select itemTypeID, baseFieldID, fieldID from baseFieldMappingsCombined order by 1, 2, 3",
      "select charsetID, charset from charsets order by charsetID",
    ];
    for (const query of queries) {
      const replica = sqlite.prepare(query).all();
      expect(replica.length, query).toBeGreaterThan(30);
      expect(replica, query).toEqual(pristine.prepare(query).all());
    }
  });
});

describe("the staging tables of a replica made before the note permission", () => {
  it("gain the columns of the note permission and the rebuild at open, with an unknown grant in each library row", () => {
    const sqlite = new DatabaseSync(":memory:");
    const db = connectClient(sqlite);
    createReplica(db);
    sqlite.exec("drop table replicaSyncLibraries");
    sqlite.exec(`create table replicaSyncLibraries (
      libraryType text not null check (libraryType in ('user', 'group')),
      remoteID integer not null,
      state text not null check (state in ('idle', 'downloading', 'complete', 'remove')),
      sinceVersion integer not null default 0,
      targetVersion integer,
      groupJSON text,
      lastSync integer,
      primary key (libraryType, remoteID)) without rowid`);
    sqlite.exec(
      "insert into replicaSyncLibraries (libraryType, remoteID, state, sinceVersion) values ('user', 7, 'idle', 3)",
    );

    ensureSyncTables(db);
    ensureSyncTables(db);

    expect(committedNotesAccess(db, { type: "user", id: 7 })).toBeNull();
    beginLibraryPass(db, {
      library: { type: "user", id: 7 },
      sinceVersion: 3,
      targetVersion: 4,
      notesAccess: false,
      rebuild: true,
    });
    expect(
      sqlite
        .prepare(
          "select targetNotesAccess, targetRebuild from replicaSyncLibraries",
        )
        .get(),
    ).toEqual({ targetNotesAccess: 0, targetRebuild: 1 });
  });
});
