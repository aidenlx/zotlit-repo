import { Effect, Layer, PubSub, Stream } from "effect";

import type { IndexedItem, IndexSignature, Item } from "@zotlit/db";

import { ItemSource, SourceUnavailable } from "./item-index.ts";
import type { PinnedItemSource } from "./item-index.ts";
import { makeGate } from "./make-gate.ts";

export interface MemoryItemSourceReads {
  pinned: number;
  scans: number;
  items: number;
  signature: number;
  itemsByIndexedKey: number;
  interrupted: number;
  released: number;
}

export interface MemoryItemRow {
  readonly indexed: IndexedItem;
  readonly item: Item;
}

export interface MemoryItemSource {
  readonly layer: Layer.Layer<ItemSource>;
  readonly reads: Readonly<MemoryItemSourceReads>;
  readonly generation: number;
  readonly setItems: (
    libraryID: number,
    items: readonly MemoryItemRow[],
  ) => Effect.Effect<void>;
  readonly vanish: (indexedKey: string) => Effect.Effect<void>;
  readonly notify: Effect.Effect<void>;
  readonly swap: Effect.Effect<void>;
  readonly setUnavailable: (unavailable: boolean) => Effect.Effect<void>;
  readonly closeGate: Effect.Effect<void>;
  readonly openGate: Effect.Effect<void>;
  readonly held: Effect.Effect<void>;
  readonly waiting: number;
  readonly closeHydrationGate: Effect.Effect<void>;
  readonly openHydrationGate: Effect.Effect<void>;
  readonly hydrationHeld: Effect.Effect<void>;
  readonly onNextRelease: (run: Effect.Effect<void>) => Effect.Effect<void>;
}

export const makeMemoryItemSource = (
  rows: ReadonlyMap<number, readonly MemoryItemRow[]>,
): Effect.Effect<MemoryItemSource> =>
  Effect.gen(function* () {
    const libraries = new Map(rows);
    const reads: MemoryItemSourceReads = {
      pinned: 0,
      scans: 0,
      items: 0,
      signature: 0,
      itemsByIndexedKey: 0,
      interrupted: 0,
      released: 0,
    };
    let generation = 0;
    let unavailable = false;
    let waiting = 0;
    let onRelease: Effect.Effect<void> | null = null;
    const vanished = new Set<string>();
    const hydrationGate = yield* makeGate({ once: true });
    const generations = yield* PubSub.unbounded<void>();
    const gate = yield* makeGate();

    const check = Effect.suspend(() =>
      unavailable
        ? Effect.fail(new SourceUnavailable({ message: "source unavailable" }))
        : Effect.void,
    );

    const pinnedTo = (state: ReadonlyMap<number, readonly MemoryItemRow[]>) => {
      const rowsOf = [...state.values()].flat();
      const byIndexedKey = new Map(
        rowsOf.map((row) => [row.indexed.indexedKey, row.item]),
      );
      const source: PinnedItemSource = {
        generation,
        items: (libraryID) =>
          Stream.unwrap(
            check.pipe(
              Effect.map(() => {
                reads.scans++;
                const rows = state.get(libraryID) ?? [];
                const batchSize = 500;
                return Stream.unfold(
                  0,
                  Effect.fnUntraced(function* (offset: number) {
                    if (offset >= rows.length) return undefined;
                    yield* check;
                    reads.items++;
                    if (gate.closed) {
                      waiting++;
                      yield* gate.pass.pipe(
                        Effect.onInterrupt(() =>
                          Effect.sync(() => {
                            reads.interrupted++;
                          }),
                        ),
                        Effect.ensuring(
                          Effect.sync(() => {
                            waiting--;
                          }),
                        ),
                      );
                    }
                    yield* check;
                    return [
                      rows
                        .slice(offset, offset + batchSize)
                        .map((row) => row.indexed),
                      offset + batchSize,
                    ] as const;
                  }),
                );
              }),
            ),
          ),
        signature: (libraryID) =>
          check.pipe(
            Effect.map(() => {
              reads.signature++;
              return signatureOf(state.get(libraryID) ?? []);
            }),
          ),
        itemsByIndexedKey: (indexedKeys) =>
          check.pipe(
            Effect.andThen(hydrationGate.pass),
            Effect.map(() => {
              reads.itemsByIndexedKey++;
              const found = new Map<string, Item>();
              for (const indexedKey of indexedKeys) {
                const item = vanished.has(indexedKey)
                  ? undefined
                  : byIndexedKey.get(indexedKey);
                if (item) found.set(indexedKey, item);
              }
              return found;
            }),
          ),
      };
      return source;
    };

    const layer = Layer.succeed(ItemSource, {
      generation: Stream.fromPubSub(generations),
      pinned: Effect.acquireRelease(
        check.pipe(
          Effect.map(() => {
            reads.pinned++;
            return pinnedTo(new Map(libraries));
          }),
        ),
        () =>
          Effect.suspend(() => {
            reads.released++;
            const run = onRelease;
            onRelease = null;
            return run ?? Effect.void;
          }),
      ),
    });

    return {
      layer,
      reads,
      get generation() {
        return generation;
      },
      get waiting() {
        return waiting;
      },
      setItems: (libraryID, items) =>
        Effect.sync(() => {
          libraries.set(libraryID, items);
        }),
      vanish: (indexedKey) =>
        Effect.sync(() => {
          vanished.add(indexedKey);
        }),
      notify: PubSub.publish(generations, undefined).pipe(Effect.asVoid),
      swap: Effect.suspend(() => {
        generation++;
        return PubSub.publish(generations, undefined);
      }).pipe(Effect.asVoid),
      setUnavailable: (value) =>
        Effect.sync(() => {
          unavailable = value;
        }),
      closeGate: gate.close,
      openGate: gate.open,
      held: gate.held,
      closeHydrationGate: hydrationGate.close,
      openHydrationGate: hydrationGate.open,
      hydrationHeld: hydrationGate.held,
      onNextRelease: (run) =>
        Effect.sync(() => {
          onRelease = run;
        }),
    } satisfies MemoryItemSource;
  });

function signatureOf(rows: readonly MemoryItemRow[]): IndexSignature {
  return {
    count: rows.length,
    checksum: rows.reduce(
      (sum, { indexed }) =>
        sum +
        Math.floor(indexed.dateModified.epochMilliseconds / 1000) +
        indexed.itemID +
        ((((indexed.lastActivity ?? 0) / 1000) * ((indexed.itemID % 997) + 1)) %
          2147483647),
      0,
    ),
  };
}
