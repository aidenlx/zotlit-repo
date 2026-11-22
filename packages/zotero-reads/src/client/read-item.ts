import { Effect } from "effect";

import type { Item } from "@zotlit/db";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import { ZoteroReads } from "./service.ts";

export const readActionItem = (
  indexedKey: string,
): Effect.Effect<Item | null, never, ZoteroReads> =>
  Effect.gen(function* () {
    const snapshot = yield* (yield* ZoteroReads).snapshot;
    const items = yield* snapshot.ItemsByIndexedKeys({
      indexedKeys: [indexedKey],
    });
    return items.get(indexedKey) ?? null;
  }).pipe(
    Effect.scoped,
    recover(
      (cause) =>
        Effect.logWarning("Could not read an Item").pipe(
          Effect.annotateLogs({ indexedKey, cause }),
        ),
      Effect.succeed(null),
    ),
    withLogCategory("zotero-reads"),
  );
