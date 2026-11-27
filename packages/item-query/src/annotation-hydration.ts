import { Effect } from "effect";

import { readAnnotationHydrateChunk } from "@zotlit/db/item-query";
import type {
  AnnotationScanRow,
  AttachmentScanRow,
  HydratedAnnotation,
} from "@zotlit/db/item-query";

import type { QueryAnnotation } from "./annotation-fields.ts";
import type { QueryAttachment } from "./attachment-fields.ts";
import type { AttachmentNeeds } from "./attachment-hydration.ts";
import { ATTACHMENT_LOADING } from "./attachment-hydration.ts";
import type { FieldNeeds, QueryItem } from "./fields.ts";
import { ITEM_LOADING } from "./hydration.ts";
import type { LoadingDescriptor } from "./record-loader.ts";
import { parentRecord } from "./record-loader.ts";

export interface AnnotationNeeds {
  readonly details?: boolean;
  readonly tags?: boolean;
  readonly attachment?: readonly AttachmentNeeds[];
  readonly item?: readonly FieldNeeds[];
}

interface AnnotationLinks {
  readonly parent: QueryItem;
  readonly attachmentRecord: QueryAttachment;
}

export const ANNOTATION_LOADING: LoadingDescriptor<
  AnnotationNeeds,
  AnnotationScanRow,
  HydratedAnnotation,
  AnnotationLinks,
  QueryAnnotation
> = {
  own: (needs) => {
    const details = needs.some((need) => need.details);
    const tags = needs.some((need) => need.tags);
    return Effect.succeed({
      hydrates: details || tags,
      load: Effect.fnUntraced(function* (chunk) {
        const loaded =
          details || tags
            ? yield* readAnnotationHydrateChunk({ rows: chunk, details, tags })
            : null;
        return chunk.map((row) => loaded?.get(row.itemID) ?? NOTHING_HYDRATED);
      }),
    });
  },
  relations: {
    parent: parentRecord({
      needs: (need: AnnotationNeeds) => need.item,
      descriptor: () => ITEM_LOADING,
      row: (row: AnnotationScanRow) => row.parent,
      required: true,
    }),
    attachmentRecord: parentRecord({
      needs: (need: AnnotationNeeds) => need.attachment,
      descriptor: () => ATTACHMENT_LOADING,
      row: (row: AnnotationScanRow): AttachmentScanRow => ({
        itemID: row.attachmentID,
        key: row.attachmentKey,
        itemType: "attachment",
        dateAdded: row.attachmentDateAdded,
        dateModified: row.attachmentDateModified,
        lastRead: row.attachmentLastRead,
        libraryID: row.libraryID,
        parent: row.parent,
      }),
    }),
  },
  record: (annotation, { scan, library, related }) => ({
    scan,
    annotation,
    groupID: library.groupID,
    ...related,
    parent: related.parent!,
  }),
};

const NOTHING_HYDRATED: HydratedAnnotation = {};
