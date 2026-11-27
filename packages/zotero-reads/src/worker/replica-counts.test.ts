import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";

import { wasmReplicaDriver } from "./replica-driver-wasm.ts";

import {
  countOutside,
  describeReplicaCounts,
} from "#__fixtures__/replica-counts.ts";

const require = createRequire(import.meta.url);
const wasm = readFileSync(
  require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"),
);

describeReplicaCounts("the wasm driver on memory storage", {
  driver: async () =>
    wasmReplicaDriver(await loadSqliteWasm({ wasm, storage: "memory" })),
  baseline: new URL("./replica-counts.wasm.json", import.meta.url),
});

describe("the margin of the count guards", () => {
  it("fails a count that moves more than 5% from its baseline, in either direction", () => {
    expect(countOutside(1_049, 1_000)).toBe(false);
    expect(countOutside(951, 1_000)).toBe(false);
    expect(countOutside(1_051, 1_000)).toBe(true);
    expect(countOutside(949, 1_000)).toBe(true);
  });
});
