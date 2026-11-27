import { Effect, Layer, Stream } from "effect";

import {
  getIndexedItemsByID,
  getIndexSignatureRange,
  getItemIDBounds,
  sumSignatureRanges,
} from "@zotlit/db";
import type { GroupIDMemo, ZoteroDatabase } from "@zotlit/db";
import { ItemSource, SourceUnavailable } from "@zotlit/item-lookup";
import type { PinnedItemSource } from "@zotlit/item-lookup";

import { Connection, toDbUnavailable } from "./connection.ts";
import { scanIndexedItems } from "./item-scan.ts";
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

const signatureOf = (client: ZoteroDatabase, libraryID: number) =>
  Effect.gen(function* () {
    const ranges = sumSignatureRanges(
      yield* read(client, (c) => getItemIDBounds(c, libraryID)),
      SIGNATURE_RANGE,
    );
    let step = ranges.next();
    while (!step.done) {
      yield* Effect.yieldNow;
      const range = step.value;
      step = ranges.next(
        yield* read(client, (c) => getIndexSignatureRange(c, libraryID, range)),
      );
    }
    return step.value;
  });

const itemsOf = (
  client: ZoteroDatabase,
  libraryID: number,
  memo: GroupIDMemo,
) =>
  scanIndexedItems(client, libraryID).pipe(
    Stream.mapError(
      (error) => new SourceUnavailable({ message: error.message }),
    ),
    Stream.mapEffect((rows) =>
      read(client, (c) =>
        getIndexedItemsByID(
          c,
          rows.map((row) => row.itemID),
          { memo },
        ),
      ),
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
        const memo: GroupIDMemo = new Map();
        return {
          generation: connection.databaseGeneration(client),
          items: (libraryID) => itemsOf(client, libraryID, memo),
          signature: (libraryID) => signatureOf(client, libraryID),
          itemsByIndexedKey: (indexedKeys) =>
            read(client, (c) => itemsByIndexedKeys(c, indexedKeys)),
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
        const generation = yield* Effect.scoped(
          Effect.map(borrow, (client) => connection.databaseGeneration(client)),
        );
        const memo: GroupIDMemo = new Map();
        return {
          generation,
          items: (libraryID) =>
            Stream.unwrap(
              Effect.map(borrow, (client) => itemsOf(client, libraryID, memo)),
            ),
          signature: (libraryID) =>
            Effect.scoped(
              Effect.flatMap(borrow, (client) =>
                signatureOf(client, libraryID),
              ),
            ),
          itemsByIndexedKey: (indexedKeys) =>
            Effect.scoped(
              Effect.flatMap(borrow, (client) =>
                read(client, (c) => itemsByIndexedKeys(c, indexedKeys)),
              ),
            ),
        } satisfies PinnedItemSource;
      }),
    };
  }),
);
