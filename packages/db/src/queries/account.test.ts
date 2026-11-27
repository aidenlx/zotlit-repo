import type { NodeDatabaseClient } from "#desktop/node-client.ts";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createFixtureSchema } from "@zotlit/db-testing";

import {
  getAccountUserID,
  getZoteroDatabaseIdentity,
  getZoteroIdentity,
} from "./account.ts";

import { relations } from "#drizzle/relations.ts";

function withFixture(
  test: (sqlite: DatabaseSync, db: NodeDatabaseClient) => void,
): void {
  using sqlite = new DatabaseSync(":memory:");
  createFixtureSchema(sqlite);
  const db = drizzle({ client: sqlite, relations });
  test(sqlite, db);
}

describe("getZoteroIdentity: username", () => {
  it("reads the username from the settings row", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'username', 'sample-reader');",
      );

      expect(getZoteroIdentity(db).username).toBe("sample-reader");
    });
  });

  it("returns null when the account never synced (no row)", () => {
    withFixture((_, db) => {
      expect(getZoteroIdentity(db).username).toBeNull();
    });
  });

  it("returns null when the value is an empty string", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'username', '');",
      );

      expect(getZoteroIdentity(db).username).toBeNull();
    });
  });
});

describe("getZoteroDatabaseIdentity", () => {
  it("reads the exact Local API database id when Zotero initialized it", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(`
        insert into settings (setting, key, value)
        values ('account', 'localUserKey', 'XmplKey8'),
               ('localAPI', 'serverID', 'XmplSrv00Id1');
      `);

      expect(getZoteroDatabaseIdentity(db)).toEqual({
        userID: null,
        localUserKey: "XmplKey8",
        serverID: "XmplSrv00Id1",
      });
    });
  });

  it("leaves the server id null before Local API initialization", () => {
    withFixture((_, db) => {
      expect(getZoteroDatabaseIdentity(db).serverID).toBeNull();
    });
  });
});

describe("getZoteroIdentity: account ids", () => {
  it("reads both account ids from the settings rows", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'userID', 654321), ('account', 'localUserKey', 'XmplKey8');",
      );

      expect(getZoteroIdentity(db)).toEqual({
        userID: 654321,
        localUserKey: "XmplKey8",
        username: null,
      });
    });
  });

  it("leaves userID null for a never-synced account", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'localUserKey', 'XmplKey8');",
      );

      expect(getZoteroIdentity(db)).toEqual({
        userID: null,
        localUserKey: "XmplKey8",
        username: null,
      });
    });
  });

  it("reads a userID stored as text", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'userID', '654321');",
      );

      expect(getZoteroIdentity(db).userID).toBe(654321);
    });
  });

  it("rejects a userID that is not a positive integer", () => {
    withFixture((sqlite, db) => {
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'userID', 'nope');",
      );

      expect(getZoteroIdentity(db).userID).toBeNull();
    });
  });

  it("returns both null on an empty settings table", () => {
    withFixture((_, db) => {
      expect(getZoteroIdentity(db)).toEqual({
        userID: null,
        localUserKey: null,
        username: null,
      });
    });
  });
});

describe("getAccountUserID", () => {
  it("reads the user ID stored as text, and null for a database that never synced", () => {
    withFixture((sqlite, db) => {
      expect(getAccountUserID(db)).toBeNull();
      sqlite.exec(
        "insert into settings (setting, key, value) values ('account', 'userID', '654321');",
      );
      expect(getAccountUserID(db)).toBe(654321);
    });
  });
});
