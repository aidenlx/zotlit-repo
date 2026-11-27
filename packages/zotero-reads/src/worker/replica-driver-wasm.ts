import { openWasmClient } from "@zotlit/db/client/wasm";
import type { SqliteWasm } from "@zotlit/drizzle-sqlite-wasm";

import type { ReplicaDriver, ReplicaHandle } from "./replica-driver.ts";

const PRAGMAS = [
  "pragma locking_mode = exclusive",
  "pragma journal_mode = truncate",
  "pragma synchronous = normal",
  "pragma foreign_keys = off",
  "pragma temp_store = memory",
].join("; ");

export function wasmReplicaDriver(engine: SqliteWasm): ReplicaDriver {
  return {
    open: (file): ReplicaHandle => {
      let statements = 0;
      let counting = true;
      const database = openWasmClient(engine, {
        file,
        jit: true,
        logger: {
          logQuery: () => {
            if (counting) statements++;
          },
        },
      });
      try {
        database.exec(PRAGMAS);
      } catch (cause) {
        database.close();
        throw cause;
      }
      return {
        get db() {
          return database.db;
        },
        statements: () => statements,
        changes: () => {
          counting = false;
          try {
            const total = database.db.get<{ changes: number }>(
              "select total_changes() as changes",
            );
            if (!total) throw new Error("SQLite returned no total of changes");
            return Number(total.changes);
          } finally {
            counting = true;
          }
        },
        inTransaction: () => database.inTransaction(),
        exec: (text) => {
          statements++;
          database.exec(text);
        },
        checkpoint: () => undefined,
        renew: () => database.renew(),
        close: () => database.close(),
      };
    },
    remove: (file) => {
      engine.remove(file);
    },
    close: () => engine.close(),
  };
}
