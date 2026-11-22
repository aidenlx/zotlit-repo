import type { ZoteroDatabase } from "#client/database.ts";

import { logLibrary } from "@zotlit/shared/logging";

import { defineQuery } from "./_shared.ts";

export interface ZoteroUserIdentity {
  userID: number | null;
  localUserKey: string | null;
  username: string | null;
}

export interface ZoteroDatabaseIdentity {
  userID: number | null;
  localUserKey: string | null;
  serverID: string | null;
}

const identityQuery = defineQuery<void>()((db) =>
  db.query.settings.findMany({
    columns: { key: true, value: true },
    where: {
      setting: "account",
      key: { in: ["userID", "localUserKey", "username"] },
    },
  }),
);

const userIDQuery = defineQuery<void>()((db) =>
  db.query.settings.findMany({
    columns: { value: true },
    where: { setting: "account", key: "userID" },
    limit: 1,
  }),
);

const localApiIdentityQuery = defineQuery<void>()((db) =>
  db.query.settings.findMany({
    columns: { value: true },
    where: { setting: "localAPI", key: "serverID" },
    limit: 1,
  }),
);

export function getZoteroIdentity(db: ZoteroDatabase): ZoteroUserIdentity {
  const rows = identityQuery.prepared(db).all();
  const text = (key: string): string | null => {
    const value = rows.find((row) => row.key === key)?.value;
    return typeof value === "string" && value !== "" ? value : null;
  };
  const resolvedUserID = parseUserID(
    rows.find((row) => row.key === "userID")?.value,
  );
  const localUserKey = text("localUserKey");
  if (resolvedUserID == null && localUserKey == null)
    logLibrary({
      level: "warn",
      category: ["zotlit", "db", "account"],
      message:
        "Zotero database carries neither userID nor localUserKey; personal-library items have no Item URI to build",
    });
  return {
    userID: resolvedUserID,
    localUserKey,
    username: text("username"),
  };
}

export function getAccountUserID(db: ZoteroDatabase): number | null {
  return parseUserID(userIDQuery.prepared(db).all()[0]?.value);
}

function parseUserID(raw: unknown): number | null {
  const userID = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(userID) && userID > 0 ? userID : null;
}

export function getZoteroDatabaseIdentity(
  db: ZoteroDatabase,
): ZoteroDatabaseIdentity {
  const { userID, localUserKey } = getZoteroIdentity(db);
  const value = localApiIdentityQuery.prepared(db).all()[0]?.value;
  return {
    userID,
    localUserKey,
    serverID: typeof value === "string" && value !== "" ? value : null,
  };
}
