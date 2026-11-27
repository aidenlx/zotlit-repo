import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";

import { ZOTERO_VOCABULARY } from "@zotlit/zotero-types/vocabulary";

import {
  REPLICA_CHARSETS,
  REPLICA_DDL,
  REPLICA_SCHEMA_VERSIONS,
} from "./layout.generated.ts";
import { ensureSyncTables } from "./sync-tables.ts";
import { writeVocabulary } from "./vocabulary.ts";

import { USER_LIBRARY_ID } from "#lib/constants.ts";

export interface CreateReplicaOptions {
  randomBytes?: (length: number) => Uint8Array;
}

const LOCAL_USER_KEY_PREFIX = "replica-";
const LOCAL_USER_KEY_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const LOCAL_USER_KEY_LENGTH = 16;

export function createReplica(
  db: ZoteroDatabase,
  { randomBytes = defaultRandomBytes }: CreateReplicaOptions = {},
): void {
  for (const statement of REPLICA_DDL) db.run(sql.raw(statement));
  for (const [schema, version] of Object.entries({
    ...REPLICA_SCHEMA_VERSIONS,
    globalSchema: ZOTERO_VOCABULARY.version,
  })) {
    db.run(
      sql`insert into version (schema, version) values (${schema}, ${version})`,
    );
  }
  writeVocabulary(db);
  for (const [charsetID, charset] of REPLICA_CHARSETS) {
    db.run(
      sql`insert into charsets (charsetID, charset) values (${charsetID}, ${charset})`,
    );
  }
  db.run(
    sql`insert into libraries (libraryID, type, editable, filesEditable) values (${USER_LIBRARY_ID}, 'user', 0, 0)`,
  );
  const bytes = randomBytes(LOCAL_USER_KEY_LENGTH);
  const key =
    LOCAL_USER_KEY_PREFIX +
    Array.from(
      bytes,
      (byte) => LOCAL_USER_KEY_ALPHABET[byte % LOCAL_USER_KEY_ALPHABET.length],
    ).join("");
  db.run(
    sql`insert into settings (setting, key, value) values ('account', 'localUserKey', ${key})`,
  );
  ensureSyncTables(db);
}

function defaultRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export interface ReplicaAccount {
  readonly userID: number;
  readonly username: string;
}

export function writeReplicaAccount(
  db: ZoteroDatabase,
  { userID, username }: ReplicaAccount,
): void {
  for (const [key, value] of [
    ["userID", userID],
    ["username", username],
  ] as const) {
    db.run(
      sql`insert into settings (setting, key, value) values ('account', ${key}, ${value}) on conflict (setting, key) do update set value = excluded.value`,
    );
  }
}
