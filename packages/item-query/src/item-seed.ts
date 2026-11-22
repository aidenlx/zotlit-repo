import { Effect } from "effect";
import * as v from "valibot";

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
import type { QueryItem } from "./fields.ts";

const readonlyArray = <TItem extends v.GenericSchema>(item: TItem) =>
  v.pipe(v.array(item), v.readonly());

export const queryItemSeedSchema = v.pipe(
  v.object({
    scan: v.pipe(
      v.object({
        itemID: v.number(),
        key: v.string(),
        itemType: v.string(),
        dateAdded: v.nullable(v.number()),
        dateModified: v.nullable(v.number()),
      }),
      v.readonly(),
    ),
    groupID: v.nullable(v.number()),
    fields: v.pipe(v.record(v.string(), v.string()), v.readonly()),
    custom: v.pipe(v.record(v.string(), v.string()), v.readonly()),
    customFieldNames: readonlyArray(v.string()),
    creators: readonlyArray(
      v.pipe(
        v.object({
          firstName: v.string(),
          lastName: v.string(),
          fieldMode: v.picklist([0, 1]),
          creatorType: v.string(),
          primary: v.boolean(),
        }),
        v.readonly(),
      ),
    ),
    tags: readonlyArray(
      v.pipe(
        v.object({ name: v.string(), type: v.picklist([0, 1]) }),
        v.readonly(),
      ),
    ),
    collections: readonlyArray(readonlyArray(v.string())),
  }),
  v.readonly(),
);

export type QueryItemSeed = v.InferOutput<typeof queryItemSeedSchema>;

export function queryItemFrom(seed: QueryItemSeed): QueryItem {
  return {
    scan: seed.scan,
    groupID: seed.groupID,
    hydrated: {
      fields: new Map(Object.entries(seed.fields)),
      custom: new Map(Object.entries(seed.custom)),
      creators: seed.creators,
      tags: seed.tags,
      collections: seed.collections,
    },
    customFieldNames: seed.customFieldNames,
    attachments: [],
    annotations: [],
    notes: [],
  };
}

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
