import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";

import { wasmReplicaDriver } from "./replica-driver-wasm.ts";

import { describeReplicaStore } from "#__fixtures__/replica-store-suite.ts";

const require = createRequire(import.meta.url);
const wasm = readFileSync(
  require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"),
);
const engine = await loadSqliteWasm({ wasm, storage: "memory" });

describeReplicaStore("the wasm driver on memory storage", {
  driver: async () => {
    const driver = wasmReplicaDriver({ ...engine, close: () => undefined });
    let closed = false;
    const live = () => {
      if (closed) throw new Error("the replica driver is closed");
    };
    return {
      open: (file) => (live(), driver.open(file)),
      remove: (file) => (live(), driver.remove(file)),
      close: () => {
        closed = true;
      },
    };
  },
  leaveSidecars: (_driver, file) => {
    for (const name of [`${file}-journal`, `${file}-wal`]) {
      const sidecar = engine.open({ file: name });
      sidecar.exec("create table leftover (x)");
      sidecar.close();
    }
  },
  checkpointStatements: 0,
  exists: (_driver, file) => {
    try {
      engine.open({ file, readOnly: true }).close();
      return true;
    } catch {
      return false;
    }
  },
});
