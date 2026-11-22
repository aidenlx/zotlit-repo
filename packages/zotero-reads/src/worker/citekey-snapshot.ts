import type {
  CitekeyResolution,
  SnapshotItem,
} from "#contract/citation-lookup.ts";
import { Effect, Stream } from "effect";

import type { LibraryCitekey } from "@zotlit/db";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";

const SNAPSHOT_SLICE_MS = 4;

class SnapshotWork {
  #deadline = performance.now() + SNAPSHOT_SLICE_MS;
  #steps = 0;

  step(): Effect.Effect<void> | undefined {
    if (++this.#steps % 128 !== 0) return;
    if (performance.now() >= this.#deadline) return this.#pause;
  }

  readonly #pause = Effect.map(Effect.yieldNow, () => {
    this.#deadline = performance.now() + SNAPSHOT_SLICE_MS;
  });
}

export class CitekeySnapshot {
  readonly #byCitekey = new Map<string, SnapshotItem[]>();
  readonly #citekeyByIndexedKey = new Map<string, string>();

  static from = Effect.fnUntraced(function* <E, R>(
    rows: Stream.Stream<LibraryCitekey, E, R>,
    inScope: ReadonlySet<number>,
    { previous }: { previous?: CitekeySnapshot } = {},
  ): Effect.fn.Return<CitekeySnapshot, E, R> {
    const libraryOrder = new Map([...inScope].map((id, index) => [id, index]));
    const work = new SnapshotWork();
    const snapshot = new CitekeySnapshot();
    const byCitekey = snapshot.#byCitekey;
    const citekeyByIndexedKey = snapshot.#citekeyByIndexedKey;
    yield* Stream.runForEachArray(
      rows,
      Effect.fnUntraced(function* (page) {
        for (const row of page) {
          const pause = work.step();
          if (pause) yield* pause;
          citekeyByIndexedKey.set(row.indexedKey, row.citekey);
          if (!inScope.has(row.libraryID)) continue;
          const item: SnapshotItem = {
            itemID: row.itemID,
            libraryID: row.libraryID,
            key: row.key,
            indexedKey: row.indexedKey,
          };
          const candidates = byCitekey.get(row.citekey);
          if (candidates) candidates.push(item);
          else byCitekey.set(row.citekey, [item]);
        }
      }),
    );
    for (const [citekey, candidates] of byCitekey) {
      const pause = work.step();
      if (pause) yield* pause;
      if (candidates.length > 1) {
        candidates.sort(
          (a, b) =>
            libraryOrder.get(a.libraryID)! - libraryOrder.get(b.libraryID)! ||
            a.itemID - b.itemID,
        );
        yield* Effect.logDebug("Ambiguous citation key in library scope").pipe(
          Effect.annotateLogs({
            citekey,
            candidates: candidates.length,
          }),
          withLogCategory("citation-index"),
        );
      }
    }

    const unchanged =
      previous && (yield* CitekeySnapshot.#sameAs(snapshot, previous, work));
    if (unchanged) return previous;
    return snapshot;
  });

  resolve(citekey: string): CitekeyResolution {
    const candidates = this.#byCitekey.get(citekey);
    if (!candidates || candidates.length === 0) return { kind: "missing" };
    if (candidates.length === 1)
      return { kind: "unique", item: candidates[0]! };
    return { kind: "ambiguous", candidates };
  }

  citekeyOf(indexedKey: string): string | null {
    return this.#citekeyByIndexedKey.get(indexedKey) ?? null;
  }

  static readonly #sameAs = Effect.fnUntraced(function* (
    snapshot: CitekeySnapshot,
    other: CitekeySnapshot,
    work: SnapshotWork,
  ) {
    if (
      snapshot.#byCitekey.size !== other.#byCitekey.size ||
      snapshot.#citekeyByIndexedKey.size !== other.#citekeyByIndexedKey.size
    )
      return false;
    for (const [key, candidates] of snapshot.#byCitekey) {
      const previous = other.#byCitekey.get(key);
      if (!previous || candidates.length !== previous.length) return false;
      for (let at = 0; at < candidates.length; at += 1) {
        const pause = work.step();
        if (pause) yield* pause;
        if (!itemEqual(candidates[at]!, previous[at]!)) return false;
      }
    }
    for (const [key, citekey] of snapshot.#citekeyByIndexedKey) {
      const pause = work.step();
      if (pause) yield* pause;
      if (other.#citekeyByIndexedKey.get(key) !== citekey) return false;
    }
    return true;
  });
}

function itemEqual(a: SnapshotItem, b: SnapshotItem): boolean {
  return (
    a.itemID === b.itemID &&
    a.libraryID === b.libraryID &&
    a.key === b.key &&
    a.indexedKey === b.indexedKey
  );
}
