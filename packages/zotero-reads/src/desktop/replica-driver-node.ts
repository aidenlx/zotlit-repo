import type { ReplicaDriver, ReplicaHandle } from "#worker/replica-driver.ts";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { connectClient } from "@zotlit/db/client/node";

const JOURNAL_SIZE_LIMIT = 4 * 1024 * 1024;

const PRAGMAS = [
  "pragma locking_mode = exclusive",
  "pragma journal_mode = wal",
  "pragma synchronous = normal",
  `pragma journal_size_limit = ${JOURNAL_SIZE_LIMIT}`,
  "pragma foreign_keys = off",
  "pragma temp_store = memory",
].join("; ");

export function nodeReplicaDriver(directory: string): ReplicaDriver {
  return {
    open: (file): ReplicaHandle => {
      mkdirSync(directory, { recursive: true });
      const sqlite = new DatabaseSync(join(directory, file));
      try {
        sqlite.exec(PRAGMAS);
        sqlite.exec("begin immediate; commit");
      } catch (cause) {
        sqlite.close();
        throw cause;
      }
      let statements = 0;
      const client = () =>
        connectClient(sqlite, {
          jit: true,
          logger: { logQuery: () => void statements++ },
        });
      let database = client();
      return {
        get db() {
          return database;
        },
        statements: () => statements,
        changes: () => {
          const total = sqlite
            .prepare("select total_changes() as changes")
            .get();
          if (!total) throw new Error("SQLite returned no total of changes");
          return Number(total.changes);
        },
        inTransaction: () => sqlite.isTransaction,
        exec: (text) => {
          statements++;
          sqlite.exec(text);
        },
        checkpoint: () => {
          statements++;
          const result = sqlite
            .prepare("pragma wal_checkpoint(truncate)")
            .get();
          if (result?.busy !== 0)
            throw new Error("The write-ahead log of the replica stayed in use");
        },
        renew: () => {
          database = client();
          return database;
        },
        close: () => sqlite.close(),
      };
    },
    remove: (file) => {
      for (const name of [file, `${file}-journal`, `${file}-wal`])
        rmSync(join(directory, name), { force: true });
    },
    close: () => undefined,
  };
}
