import { Effect, Layer, Stream } from "effect";

import {
  getIndexedItemsByID,
  getIndexSignatureRange,
  getItemIDBounds,
  sumSignatureRanges,
} from "@zotlit/db";
import type { GroupIDMemo, ZoteroDatabase } from "@zotlit/db";
import { ItemSource, SourceUnavailable } from "@zotlit/item-lookup";
import type { PinnedItemSource, SourceChanged } from "@zotlit/item-lookup";

import { borrowSame, Connection, toDbUnavailable } from "./connection.ts";
import type { ReadWith } from "./item-scan.ts";
import { scanIndexedItemPages } from "./item-scan.ts";
import { itemsByIndexedKeys } from "./items-by-indexed-keys.ts";

function read<A>(
  client: ZoteroDatabase,
  f: (client: ZoteroDatabase) => A,
): Effect.Effect<A, SourceUnavailable> {
  return Effect.try({
    try: () => f(client),
    catch: (cause) =>
      new SourceUnavailable({ message: toDbUnavailable(cause).message }),
  });
}

const SIGNATURE_RANGE = 10_000;

const signatureOf = <E>(readWith: ReadWith<E>, libraryID: number) =>
  Effect.gen(function* () {
    const ranges = sumSignatureRanges(
      yield* readWith((c) => getItemIDBounds(c, libraryID)),
      SIGNATURE_RANGE,
    );
    let step = ranges.next();
    while (!step.done) {
      yield* Effect.yieldNow;
      const range = step.value;
      step = ranges.next(
        yield* readWith((c) => getIndexSignatureRange(c, libraryID, range)),
      );
    }
    return step.value;
  });

const itemsOf = <E>(
  readWith: ReadWith<E>,
  libraryID: number,
  memo: GroupIDMemo,
) =>
  scanIndexedItemPages(readWith, libraryID, (c, rows) =>
    getIndexedItemsByID(
      c,
      rows.map((row) => row.itemID),
      { memo },
    ),
  );

export const layerConnectionItemSource: Layer.Layer<
  ItemSource,
  never,
  Connection
> = Layer.effect(ItemSource)(
  Effect.gen(function* () {
    const connection = yield* Connection;
    return {
      generation: connection.changes.pipe(
        Stream.filter(
          (event) => event._tag === "changed" || event._tag === "degraded",
        ),
        Stream.as(undefined),
      ),
      pinned: Effect.gen(function* () {
        const client = yield* connection.borrow.pipe(
          Effect.mapError(
            (error) => new SourceUnavailable({ message: error.message }),
          ),
        );
        const readWith: ReadWith<SourceUnavailable> = (f) => read(client, f);
        const memo: GroupIDMemo = new Map();
        return {
          generation: connection.databaseGeneration(client),
          items: (libraryID) => itemsOf(readWith, libraryID, memo),
          signature: (libraryID) => signatureOf(readWith, libraryID),
          itemsByIndexedKey: (indexedKeys) =>
            read(client, (c) => itemsByIndexedKeys(c, indexedKeys)),
          whileCurrent: (publish) => publish,
        } satisfies PinnedItemSource;
      }),
    };
  }),
);

export const layerUnpinnedConnectionItemSource: Layer.Layer<
  ItemSource,
  never,
  Connection
> = Layer.effect(ItemSource)(
  Effect.gen(function* () {
    const connection = yield* Connection;
    const borrow = connection.borrow.pipe(
      Effect.mapError(
        (error) => new SourceUnavailable({ message: error.message }),
      ),
    );
    return {
      generation: connection.changes.pipe(
        Stream.filter(
          (event) => event._tag === "changed" || event._tag === "degraded",
        ),
        Stream.as(undefined),
      ),
      pinned: Effect.gen(function* () {
        const client = yield* Effect.scoped(borrow);
        const readWith: ReadWith<SourceUnavailable | SourceChanged> = (f) =>
          borrowSame(borrow, client, (current) => read(current, f));
        const memo: GroupIDMemo = new Map();
        return {
          generation: connection.databaseGeneration(client),
          items: (libraryID) => itemsOf(readWith, libraryID, memo),
          signature: (libraryID) => signatureOf(readWith, libraryID),
          itemsByIndexedKey: (indexedKeys) =>
            readWith((c) => itemsByIndexedKeys(c, indexedKeys)),
          whileCurrent: (publish) => borrowSame(borrow, client, () => publish),
        } satisfies PinnedItemSource;
      }),
    };
  }),
);
