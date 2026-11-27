import { Effect, Stream } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getIndexedItemIDsByLibrary, getIndexedItemsByID } from "@zotlit/db";
import type { ZoteroDatabase } from "@zotlit/db";
import { findLibraryID } from "@zotlit/db/replica";
import { openParityPair } from "@zotlit/db/replica/parity-pair";
import type { ParityPair } from "@zotlit/db/replica/parity-pair";

import { buildEngineIndex, searchEngineIndex } from "./engine.ts";
import { layerSegmenterNone } from "./segmenter.ts";

let pair: ParityPair;
let marked: ParityPair;

beforeAll(() => {
  pair = openParityPair();
  marked = openParityPair({ withSentinels: true });
});

afterAll(() => {
  pair?.[Symbol.dispose]();
  marked?.[Symbol.dispose]();
});

function search(db: ZoteroDatabase, query: string): Promise<string[]> {
  const libraries = [
    findLibraryID(db, { type: "user" })!,
    findLibraryID(db, { type: "group", groupID: 4815 })!,
  ];
  const items = libraries.flatMap((libraryID) =>
    getIndexedItemsByID(db, getIndexedItemIDsByLibrary(db, libraryID)),
  );
  return Effect.gen(function* () {
    const index = yield* buildEngineIndex(Stream.make(items), { libraries });
    const hits = yield* searchEngineIndex(index, query, { limit: 50 });
    return hits.map((hit) => hit.indexedKey);
  }).pipe(Effect.provide(layerSegmenterNone), Effect.runPromise);
}

describe("item search on the Web Library Replica", () => {
  it.each([
    ["", 12],
    ["methods", 3],
    ["Lovelace", 3],
    ["2019", 1],
    ["气候", 1],
    ["eclair", 1],
    ["Group", 2],
    ["Hopper sampling", 1],
  ])("ranks %j as the desktop database does", async (query, count) => {
    const desktop = await search(pair.desktop.db, query);
    expect(desktop.length).toBe(count);
    expect(await search(pair.replica.db, query)).toEqual(desktop);
    expect(await search(marked.replica.db, query)).toEqual(desktop);
  });
});
