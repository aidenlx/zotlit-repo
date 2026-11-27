import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import { fillMissing } from "@zotlit/plugin-kernel/worker/fills.ts";

const require = createRequire(import.meta.url);
const wasm = await readFile(
  require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"),
);

const captureStackTrace = Reflect.get(Error, "captureStackTrace") as unknown;
const restoreCaptureStackTrace = () =>
  Reflect.set(Error, "captureStackTrace", captureStackTrace);
afterEach(restoreCaptureStackTrace);

describe("the Web Worker root on Safari 16.4", () => {
  it("gives a DrizzleQueryError for a failed query where Error.captureStackTrace is missing", async () => {
    Reflect.deleteProperty(Error, "captureStackTrace");
    await fillMissing(globalThis, { temporal: () => {} });
    const engine = await loadSqliteWasm({ wasm, storage: "memory" });
    using database = engine.open({ file: "floor.sqlite" });
    let failure: unknown;
    try {
      database.db.all("select * from missing");
    } catch (error) {
      failure = error;
    }
    engine.close();
    restoreCaptureStackTrace();
    expect(failure).toMatchObject({
      name: "DrizzleQueryError",
      cause: { code: "SQLITE_ERROR" },
    });
  });
});
