import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { openNodeReplica } from "./__fixtures__/parity.ts";
import { stagingViolations } from "./__fixtures__/staging-invariants.ts";
import { createReplica, writeReplicaAccount } from "./create.ts";
import {
  applyStagedPasses,
  beginLibraryPass,
  completeLibraryPass,
  stageAccount,
  stageLibraryRemoval,
  stageObjects,
  stageSettings,
} from "./sync-store.ts";

const NOW = Temporal.Instant.from("2026-11-26T12:00:00Z");
const USER = { type: "user", id: 7 } as const;
const GROUP = { type: "group", id: 4815 } as const;

function withReplica(test: (db: ZoteroDatabase) => void) {
  const replica = openNodeReplica();
  try {
    createReplica(replica.db);
    test(replica.db);
  } finally {
    replica.close();
  }
}

function stageItem(db: ZoteroDatabase, key: string, version = 5) {
  stageObjects(db, USER, {
    items: [
      {
        key,
        version,
        library: { type: "user", id: 7, name: "user" },
        data: { key, version, itemType: "book", title: key },
      },
    ],
  });
}

describe("the invariants of the sync staging", () => {
  it("finds no violation in a replica with no staging, in a staged pass, or after its apply", () => {
    withReplica((db) => {
      expect(stagingViolations(db)).toEqual([]);
      stageAccount(db, { userID: 7, username: "reader" });
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 5,
      });
      stageItem(db, "ITEM0001");
      expect(stagingViolations(db)).toEqual([]);
      completeLibraryPass(db, USER, { collections: [], items: ["GONE0001"] });
      stageLibraryRemoval(db, GROUP);
      expect(stagingViolations(db)).toEqual([]);

      applyStagedPasses(db, { now: NOW });

      expect(stagingViolations(db, { afterApply: true })).toEqual([]);
    });
  });

  it("names a complete or downloading pass with no target version or no note permission", () => {
    withReplica((db) => {
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 0,
      });
      expect(stagingViolations(db)).toEqual([]);
      db.run(sql`update replicaSyncLibraries set targetNotesAccess = null`);
      expect(stagingViolations(db)).toEqual([
        { rule: "pass-has-target", library: USER },
      ]);
      db.run(
        sql`update replicaSyncLibraries set targetVersion = null, targetNotesAccess = 1`,
      );
      expect(stagingViolations(db)).toEqual([
        { rule: "pass-has-target", library: USER },
      ]);
      completeLibraryPass(db, USER, { collections: [], items: [] });
      expect(stagingViolations(db)).toEqual([
        { rule: "pass-has-target", library: USER },
      ]);
    });
  });

  it("names an idle library with a target version or a staged group record", () => {
    withReplica((db) => {
      db.run(
        sql`insert into replicaSyncLibraries (libraryType, remoteID, state, targetVersion) values ('user', 7, 'idle', 5),
          ('group', 4815, 'idle', null)`,
      );
      db.run(
        sql`update replicaSyncLibraries set groupJSON = '{}' where libraryType = 'group'`,
      );
      expect(stagingViolations(db)).toEqual([
        { rule: "idle-has-no-pass", library: GROUP },
        { rule: "idle-has-no-pass", library: USER },
      ]);
    });
  });

  it("names a staged deletion under a library that is neither complete nor waiting for removal", () => {
    withReplica((db) => {
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 5,
      });
      completeLibraryPass(db, USER, { collections: [], items: ["GONE0001"] });
      db.run(
        sql`insert into replicaSyncDeletions (libraryType, remoteID, objectType, key) values ('group', 99, 'item', 'GONE0002')`,
      );
      expect(stagingViolations(db)).toEqual([
        {
          rule: "deletion-under-pass",
          library: { type: "group", id: 99 },
          objectType: "item",
          key: "GONE0002",
        },
      ]);
      db.run(
        sql`update replicaSyncLibraries set state = 'idle', targetVersion = null, targetNotesAccess = null, targetRebuild = null`,
      );
      expect(stagingViolations(db)).toContainEqual({
        rule: "deletion-under-pass",
        library: USER,
        objectType: "item",
        key: "GONE0001",
      });
    });
  });

  it("names a pending object under an idle or absent library, and keeps a deferred and a skipped one under an idle library", () => {
    withReplica((db) => {
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 5,
      });
      stageItem(db, "ITEM0001");
      stageItem(db, "ITEM0002");
      stageItem(db, "ITEM0003");
      db.run(
        sql`update replicaSyncLibraries set state = 'idle', targetVersion = null, targetNotesAccess = null, targetRebuild = null`,
      );
      db.run(
        sql`update replicaSyncObjects set state = 'deferred' where key = 'ITEM0002'`,
      );
      db.run(
        sql`update replicaSyncObjects set state = 'skipped', vocabularyVersion = 1 where key = 'ITEM0003'`,
      );
      expect(stagingViolations(db)).toEqual([
        {
          rule: "pending-under-pass",
          library: USER,
          objectType: "item",
          key: "ITEM0001",
        },
      ]);
      db.run(sql`delete from replicaSyncLibraries`);
      expect(stagingViolations(db)).toEqual([
        {
          rule: "pending-under-pass",
          library: USER,
          objectType: "item",
          key: "ITEM0001",
        },
      ]);
    });
  });

  it("names a skipped object with no vocabulary version and any other object with one", () => {
    withReplica((db) => {
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 5,
      });
      stageItem(db, "ITEM0001");
      stageItem(db, "ITEM0002");
      db.run(
        sql`update replicaSyncObjects set state = 'skipped' where key = 'ITEM0001'`,
      );
      db.run(
        sql`update replicaSyncObjects set vocabularyVersion = 3 where key = 'ITEM0002'`,
      );
      expect(stagingViolations(db)).toEqual([
        {
          rule: "skipped-records-vocabulary",
          library: USER,
          objectType: "item",
          key: "ITEM0001",
        },
        {
          rule: "skipped-records-vocabulary",
          library: USER,
          objectType: "item",
          key: "ITEM0002",
        },
      ]);
    });
  });

  it("names a complete group pass with no staged group record and no committed group", () => {
    withReplica((db) => {
      const unknown = { type: "group", id: 999 } as const;
      beginLibraryPass(db, {
        library: unknown,
        sinceVersion: 0,
        targetVersion: 5,
      });
      expect(stagingViolations(db)).toEqual([]);
      completeLibraryPass(db, unknown, { collections: [], items: [] });
      expect(stagingViolations(db)).toEqual([
        { rule: "group-pass-has-record", library: unknown },
      ]);
      db.run(
        sql`update replicaSyncLibraries set groupJSON = '{}' where remoteID = 999`,
      );
      expect(stagingViolations(db)).toEqual([]);
    });
  });

  it("names a staged setting outside a downloading or complete pass of the personal library", () => {
    withReplica((db) => {
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 5,
      });
      stageSettings(db, USER, { lastRead_g4815_PDF2GRUP: 1 });
      expect(stagingViolations(db)).toEqual([]);
      completeLibraryPass(db, USER, { collections: [], items: [] });
      expect(stagingViolations(db)).toEqual([]);
      db.run(
        sql`update replicaSyncLibraries set state = 'idle', targetVersion = null, targetNotesAccess = null, targetRebuild = null`,
      );
      stageSettings(db, GROUP, { lastRead_g4815_PDF3GRUP: 1 });
      expect(stagingViolations(db)).toEqual([
        {
          rule: "setting-under-pass",
          library: GROUP,
          key: "lastRead_g4815_PDF3GRUP",
        },
        {
          rule: "setting-under-pass",
          library: USER,
          key: "lastRead_g4815_PDF2GRUP",
        },
      ]);
    });
  });

  it("after a download names a pass of a library that the key does not read and a removal of one that it reads", () => {
    withReplica((db) => {
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 5,
      });
      beginLibraryPass(db, {
        library: GROUP,
        sinceVersion: 0,
        targetVersion: 5,
      });
      completeLibraryPass(db, GROUP, { collections: [], items: [] });
      db.run(
        sql`update replicaSyncLibraries set groupJSON = '{}' where remoteID = 4815`,
      );
      stageLibraryRemoval(db, { type: "group", id: 900 });
      expect(stagingViolations(db, { listed: [USER, GROUP] })).toEqual([]);
      expect(
        stagingViolations(db, { listed: [USER, { type: "group", id: 900 }] }),
      ).toEqual([
        { rule: "pass-is-listed", library: GROUP },
        { rule: "removal-is-unlisted", library: { type: "group", id: 900 } },
      ]);
    });
  });

  it("after a download names a pass made under another note permission or as another kind of pass than the sync", () => {
    withReplica((db) => {
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 5,
        notesAccess: true,
      });
      beginLibraryPass(db, {
        library: GROUP,
        sinceVersion: 0,
        targetVersion: 5,
        rebuild: true,
      });
      expect(
        stagingViolations(db, {
          listed: [
            { ...USER, notesAccess: false },
            { ...GROUP, notesAccess: true },
          ],
          rebuild: false,
        }),
      ).toEqual([
        { rule: "pass-is-current", library: GROUP },
        { rule: "pass-is-current", library: USER },
      ]);
      expect(
        stagingViolations(db, {
          listed: [{ ...USER, notesAccess: true }],
          rebuild: true,
        }),
      ).toEqual([
        { rule: "pass-is-current", library: USER },
        { rule: "pass-is-listed", library: GROUP },
      ]);
    });
  });

  it("names a staged account row equal to the account of the replica", () => {
    withReplica((db) => {
      writeReplicaAccount(db, { userID: 7, username: "reader" });
      stageAccount(db, { userID: 7, username: "renamed" });
      expect(stagingViolations(db)).toEqual([]);
      db.run(sql`update replicaSyncAccount set username = 'reader'`);
      expect(stagingViolations(db)).toEqual([
        { rule: "account-differs", library: null },
      ]);
    });
  });

  it("after an apply names a complete or removed pass, an account row, a staged deletion and a missing language marker", () => {
    withReplica((db) => {
      expect(stagingViolations(db, { afterApply: true })).toEqual([
        { rule: "apply-records-language", library: null },
      ]);
      stageAccount(db, { userID: 7, username: "reader" });
      beginLibraryPass(db, {
        library: USER,
        sinceVersion: 0,
        targetVersion: 5,
      });
      completeLibraryPass(db, USER, { collections: [], items: ["GONE0001"] });
      stageLibraryRemoval(db, GROUP);
      expect(stagingViolations(db)).toEqual([]);
      expect(stagingViolations(db, { afterApply: true })).toEqual([
        { rule: "apply-leaves-no-account", library: null },
        {
          rule: "apply-leaves-no-deletion",
          library: USER,
          objectType: "item",
          key: "GONE0001",
        },
        { rule: "apply-leaves-no-pass", library: GROUP },
        { rule: "apply-leaves-no-pass", library: USER },
        { rule: "apply-records-language", library: null },
      ]);
    });
  });
});
