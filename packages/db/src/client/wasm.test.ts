import type { ZoteroDatabase } from "#index.ts";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_ITEMS,
  SCENARIO_LIBRARIES,
} from "@zotlit/db-testing/scenario";
import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";

import { openWasmClient } from "./wasm.ts";

import { connectClient } from "#desktop/node-client.ts";
import {
  ItemQueryDatabase,
  readAnnotationScanPage,
  readAttachmentScanPage,
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
  readItemNotes,
  readScanPage,
} from "#item-query/index.ts";
import { getCitekeysByLibrary } from "#queries/citekey.ts";
import { getIndexedItemsByLibrary } from "#queries/index-items.ts";
import { getItemDisplayInfoByID } from "#queries/item-ref.ts";
import { getLibraries } from "#queries/libraries.ts";

const driverRequire = createRequire(
  createRequire(import.meta.url).resolve("@zotlit/drizzle-sqlite-wasm"),
);
const wasm = readFileSync(
  driverRequire.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"),
);
const sqlite = await loadSqliteWasm({ wasm, storage: "memory" });

const { personal } = SCENARIO_LIBRARIES;

function readAll(db: ZoteroDatabase, articleID: number) {
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>): A =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: db }),
    );
  const scan = { libraryID: personal.libraryID };
  return {
    libraries: getLibraries(db),
    indexed: getIndexedItemsByLibrary(db, personal.libraryID),
    citekeys: getCitekeysByLibrary(db, personal.libraryID),
    display: getItemDisplayInfoByID(db, articleID),
    scan: run(readScanPage(scan)),
    attachments: run(readAttachmentScanPage(scan)),
    annotations: run(readAnnotationScanPage(scan)),
    notes: run(readItemNotes([articleID])),
    hydrated: run(
      Effect.gen(function* () {
        const vocabulary = yield* readFieldVocabulary();
        const collectionPaths = yield* readCollectionPaths(personal);
        return yield* readHydrateChunk({
          vocabulary,
          itemIDs: [articleID],
          fields: { builtIn: [], custom: [] },
          relations: ["creators"],
          collectionPaths,
        });
      }),
    ),
  };
}

describe.each([false, true])("the wasm client (jit: %s)", (jit) => {
  it("gives the readers the same results as the Node client on an imported scenario database", () => {
    using scenario = openScenarioDatabase(
      (database) => connectClient(database, { jit }),
      { annotations: true, layout: "highest" },
    );
    const { itemID } = scenario.sqlite
      .prepare("select itemID from items where key = ?")
      .get(SCENARIO_ITEMS.fullDateArticle.key) as { itemID: number };
    using client = openWasmClient(sqlite, { file: "/zotero.sqlite", jit });
    client.import(scenario.sqlite.serialize());

    const expected = readAll(scenario.db, itemID);
    expect(expected.scan.length).toBeGreaterThan(0);
    expect(expected.annotations.length).toBeGreaterThan(0);
    expect(readAll(client.db, itemID)).toEqual(expected);
  });
});
