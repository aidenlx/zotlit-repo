// The Item loading descriptor: stored fields and its child Relation Lists.
import { Effect } from "effect";

import { readHydrateChunk } from "@zotlit/db/item-query";
import type {
  CollectionPaths,
  HydratedItem,
  HydrateRelation,
  ScanRow,
} from "@zotlit/db/item-query";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import type { QueryAnnotation } from "./annotation-fields.ts";
import { ANNOTATION_LOADING } from "./annotation-hydration.ts";
import type { QueryAttachment } from "./attachment-fields.ts";
import { ATTACHMENT_LOADING } from "./attachment-hydration.ts";
import type { FieldNeeds, QueryItem } from "./fields.ts";
import type { QueryNote } from "./note-fields.ts";
import { NOTE_LOADING } from "./note-hydration.ts";
import { relationList } from "./record-loader.ts";
import type { LoadingDescriptor } from "./record-loader.ts";
import {
  relatedAttachments,
  relatedItemAnnotations,
  relatedItemNotes,
} from "./relation-hydration.ts";

interface ItemOwn {
  readonly lastUse?: number;
  readonly hydrated: HydratedItem;
  readonly customFieldNames: readonly string[];
}
interface ItemLinks {
  readonly attachments: readonly QueryAttachment[];
  readonly annotations: readonly QueryAnnotation[];
  readonly notes: readonly QueryNote[];
}

export const ITEM_LOADING: LoadingDescriptor<
  FieldNeeds,
  ScanRow,
  ItemOwn,
  ItemLinks,
  QueryItem
> = {
  own: Effect.fnUntraced(function* (needs, { sources, libraries, uses }) {
    const hydrates = needs.some(
      (need) =>
        need.builtIn?.length || need.custom?.length || need.relations?.length,
    );
    const vocabulary = hydrates ? yield* sources.vocabulary() : null;
    const fields = {
      builtIn: [...new Set(needs.flatMap((need) => need.builtIn ?? []))],
      custom: [
        ...new Set(
          needs.flatMap((need) =>
            need.custom === "all"
              ? vocabulary!.customFieldNames
              : (need.custom ?? []),
          ),
        ),
      ],
    };
    const relations: HydrateRelation[] = [
      ...new Set(needs.flatMap((need) => need.relations ?? [])),
    ];
    let collectionPaths: CollectionPaths | undefined;
    if (relations.includes("collections")) {
      const paths = new Map<number, readonly string[]>();
      for (const library of libraries) {
        for (const [id, path] of yield* sources.collectionPaths(library))
          paths.set(id, path);
      }
      collectionPaths = paths;
    }
    return {
      hydrates,
      load: Effect.fnUntraced(function* (chunk, libraryAt) {
        const loaded = vocabulary
          ? yield* readHydrateChunk({
              vocabulary,
              itemIDs: chunk.map((row) => row.itemID),
              fields,
              relations,
              collectionPaths,
            })
          : null;
        return chunk.map((row, index) => ({
          lastUse: uses?.[formatIndexedKey(row.key, libraryAt(index).groupID)],
          hydrated: loaded?.get(row.itemID) ?? NOTHING_HYDRATED,
          customFieldNames: vocabulary?.customFieldNames ?? [],
        }));
      }),
    };
  }),
  relations: {
    attachments: relationList({
      needs: (need: FieldNeeds) => need.attachments,
      descriptor: () => ATTACHMENT_LOADING,
      read: relatedAttachments,
      parentID: (row) => row.parent.itemID,
    }),
    annotations: relationList({
      needs: (need: FieldNeeds) => need.annotations,
      descriptor: () => ANNOTATION_LOADING,
      read: relatedItemAnnotations,
      parentID: (row) => row.parent.itemID,
    }),
    notes: relationList({
      needs: (need: FieldNeeds) => need.notes,
      descriptor: () => NOTE_LOADING,
      read: relatedItemNotes,
      parentID: (row) => row.parent.itemID,
    }),
  },
  record: (own, { scan, library, related }) => ({
    scan,
    ...own,
    groupID: library.groupID,
    ...related,
  }),
};

const NOTHING_HYDRATED: HydratedItem = { fields: new Map(), custom: new Map() };
