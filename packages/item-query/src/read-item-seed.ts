import { Effect } from "effect";

import {
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
  readUniverseRows,
} from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";

import { BUILT_IN_NAMES, fieldDefinition } from "./fields.ts";
import type { QueryItemSeed } from "./item-seed.ts";

export function readQueryItemSeed(item: {
  readonly itemID: number;
  readonly libraryID: number;
  readonly groupID: number | null;
}): Effect.Effect<
  QueryItemSeed | null,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const [scan] = yield* readUniverseRows({
      libraryID: item.libraryID,
      itemIDs: [item.itemID],
    });
    if (!scan) return null;
    const vocabulary = yield* readFieldVocabulary();
    const builtIn = new Set(
      BUILT_IN_NAMES.flatMap(
        (name) => fieldDefinition(name)?.needs([]).builtIn ?? [],
      ),
    );
    const hydrated = (yield* readHydrateChunk({
      vocabulary,
      itemIDs: [item.itemID],
      fields: { builtIn: [...builtIn], custom: vocabulary.customFieldNames },
      relations: ["creators", "tags", "collections"],
      collectionPaths: yield* readCollectionPaths({
        libraryID: item.libraryID,
      }),
    })).get(item.itemID);
    if (!hydrated) return null;
    const { itemID, key, itemType, dateAdded, dateModified } = scan;
    return {
      scan: { itemID, key, itemType, dateAdded, dateModified },
      groupID: item.groupID,
      fields: Object.fromEntries(hydrated.fields),
      custom: Object.fromEntries(hydrated.custom),
      customFieldNames: vocabulary.customFieldNames,
      creators: hydrated.creators ?? [],
      tags: hydrated.tags ?? [],
      collections: hydrated.collections ?? [],
    };
  });
}
