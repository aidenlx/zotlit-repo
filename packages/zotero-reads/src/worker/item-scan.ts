import { Effect, Stream } from "effect";
// oxlint-disable-next-line no-restricted-imports -- ItemQueryScheduler preserves MessageChannel scheduling and bounds the batch merge's work per turn.
import { Scheduler } from "effect";

import { getIndexedItemRowsRange, getItemIDBounds } from "@zotlit/db";
import type { IndexedItemScanRow, ZoteroDatabase } from "@zotlit/db";
import { ItemQueryScheduler } from "@zotlit/item-query";
import { makeSortedRuns } from "@zotlit/shared/sorted-runs";

import { read } from "./connection.ts";

const SCAN_ID_SPAN = 500;

const MERGE_STEP_ROWS = 500;

export type ReadWith<E> = <A>(
  f: (client: ZoteroDatabase) => A,
) => Effect.Effect<A, E>;

export const scanIndexedItemPages = <A, E>(
  readWith: ReadWith<E>,
  libraryID: number,
  page: (client: ZoteroDatabase, rows: IndexedItemScanRow[]) => A,
): Stream.Stream<A, E> =>
  Stream.unwrap(
    Effect.map(
      readWith((c) => getItemIDBounds(c, libraryID)),
      (bounds) =>
        bounds === null
          ? Stream.empty
          : Stream.unfold(
              bounds.min,
              Effect.fnUntraced(function* (from: number) {
                if (from > bounds.max) return undefined;
                yield* Effect.yieldNow;
                const to = from + SCAN_ID_SPAN;
                const result = yield* readWith((c) =>
                  page(c, getIndexedItemRowsRange(c, libraryID, { from, to })),
                );
                return [result, to] as const;
              }),
            ),
    ),
  );

export const scanIndexedItems = (client: ZoteroDatabase, libraryID: number) =>
  scanIndexedItemPages(
    (f) => read(client, f),
    libraryID,
    (_client, rows) => rows,
  );

export const readIndexedItemIDs = Effect.fn("readIndexedItemIDs")(
  function* (client: ZoteroDatabase, libraryID: number) {
    const sorted = makeSortedRuns<IndexedItemScanRow>(
      (a, b) =>
        (a.dateModified < b.dateModified
          ? 1
          : a.dateModified > b.dateModified
            ? -1
            : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      MERGE_STEP_ROWS,
    );
    yield* Stream.runForEach(scanIndexedItems(client, libraryID), (rows) =>
      Effect.sync(() => sorted.add(rows)),
    );
    return (yield* sorted.ordered).map((row) => row.itemID);
  },
  (effect) =>
    Effect.provideService(
      effect,
      Scheduler.Scheduler,
      new ItemQueryScheduler(),
    ),
);
