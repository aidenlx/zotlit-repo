import * as v from "valibot";

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
