import type { ZoteroDatabase } from "#client/database.ts";
import type { TemplateAnnotation } from "#lib/context/zt-template-annot.ts";
import type { TemplateAttachment } from "#lib/context/zt-template-attach.ts";
import type {
  TemplateItemResolvers,
  TemplateParentItemData,
} from "#lib/context/zt-template-item.ts";
import type { Annotation } from "#lib/zt-annot.ts";
import type { Attachment } from "#lib/zt-attach.ts";
import type {
  CollectionCache,
  TemplateCollection,
} from "#lib/zt-collection.ts";
import type { ItemTag } from "#lib/zt-tag.ts";
import type { Item } from "#queries/items.ts";
import type { GroupIDMemo } from "#queries/libraries.ts";
import type { ChildNote } from "#queries/notes.ts";
import type { TagMemo } from "#queries/tags.ts";
import { distinct } from "@std/collections";

import { buildNoteContext } from "./zt-template-note.ts";
import type {
  AnnotationResolvers,
  NoteTemplateContext,
  TemplateNoteLink,
} from "./zt-template-note.ts";

import { annotationToTemplateData } from "#lib/context/zt-template-annot.ts";
import { resolveTemplateAttachment } from "#lib/context/zt-template-attach.ts";
import {
  itemToTemplateBaseData,
  resolveItemCore,
  withItemPreview,
} from "#lib/context/zt-template-item.ts";
import { toTemplateCollection } from "#lib/zt-collection.ts";
import { getZoteroIdentity } from "#queries/account.ts";
import { getAnnotationsByParent } from "#queries/annotations.ts";
import {
  getAttachmentByItemId,
  getAttachmentsByParents,
} from "#queries/attachments.ts";
import { getRelatedKeysByItemID } from "#queries/item-relations.ts";
import { getItemsByID, getItemsByKey } from "#queries/items.ts";
import { getChildNotes } from "#queries/notes.ts";
import { resolveItemTagsByIDs } from "#queries/tags.ts";

export type { AnnotationResolvers };

export interface NoteResolvers {
  annotation: AnnotationResolvers;
  item: TemplateItemResolvers;
  resolveChildNote?: (note: ChildNote) => TemplateNoteLink;
}

export interface ItemFacets {
  readonly tags: readonly ItemTag[];
  readonly collections: readonly TemplateCollection[];
}

export function fetchItemFacets(
  client: ZoteroDatabase,
  items: readonly Pick<Item, "itemID" | "libraryID">[],
  memos: { tagMemo: TagMemo; collectionCache: CollectionCache },
): Map<number, ItemFacets> {
  const tags = resolveItemTagsByIDs(
    client,
    items.map(({ itemID }) => itemID),
    memos.tagMemo,
  );
  const facets = new Map<number, ItemFacets>();
  for (const [libraryID, members] of Map.groupBy(
    items,
    ({ libraryID }) => libraryID,
  )) {
    const collections = memos.collectionCache.byItemIDs(
      client,
      libraryID,
      members.map(({ itemID }) => itemID),
    );
    for (const { itemID } of members)
      facets.set(itemID, {
        tags: tags.get(itemID) ?? [],
        collections: (collections.get(itemID) ?? []).map((collection) => ({
          ...collection,
        })),
      });
  }
  return facets;
}

export interface NoteSource {
  item: Item;
  username: string | null;
  attachments: readonly Attachment[];
  annotationsByAttachment: ReadonlyMap<number, readonly Annotation[]>;
  tagsByItemID: ReadonlyMap<number, readonly ItemTag[]>;
  collectionsByItemID: ReadonlyMap<number, readonly TemplateCollection[]>;
  relatedItems: readonly Item[];
  childNotes: readonly ChildNote[];
}

export function fetchNoteSource(
  client: ZoteroDatabase,
  item: Item,
  options: {
    username?: string | null;
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    collectionCache: CollectionCache;
  },
): NoteSource {
  const { groupIdMemo, collectionCache } = options;
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const libraryID = item.libraryID;
  const memo = { memo: groupIdMemo };
  const username =
    options.username === undefined
      ? getZoteroIdentity(client).username
      : options.username;

  const attachments = getAttachmentsByParents(client, [item.itemID], memo);
  const annotationsByAttachment = new Map<number, Annotation[]>();
  for (const attachment of attachments) {
    annotationsByAttachment.set(
      attachment.itemID,
      getAnnotationsByParent(client, attachment.itemID, memo),
    );
  }
  const annotationIDs = [...annotationsByAttachment.values()].flatMap(
    (annotations) => annotations.map((annotation) => annotation.itemID),
  );

  const relatedItems = getItemsByKey(
    client,
    getRelatedKeysByItemID(client, item.itemID),
    { libraryID },
  );

  const facets = fetchItemFacets(client, [item, ...relatedItems], {
    tagMemo,
    collectionCache,
  });
  const tagsByItemID = new Map([
    ...resolveItemTagsByIDs(client, annotationIDs, tagMemo),
    ...[...facets].map(([itemID, { tags }]) => [itemID, tags] as const),
  ]);
  const collectionsByItemID = new Map(
    [...facets].map(([itemID, { collections }]) => [itemID, collections]),
  );

  const childNotes = getChildNotes(client, item.itemID, memo);

  return {
    item,
    username,
    attachments,
    annotationsByAttachment,
    tagsByItemID,
    collectionsByItemID,
    relatedItems,
    childNotes,
  };
}

export function buildNoteContextFromSource(
  source: NoteSource,
  resolvers: NoteResolvers,
): NoteTemplateContext {
  return buildNoteContext({
    ...source,
    collectionsByItemID: new Map(
      [...source.collectionsByItemID].map(([itemID, collections]) => [
        itemID,
        collections.map(toTemplateCollection),
      ]),
    ),
    resolveChildNote: resolvers.resolveChildNote,
    ...resolvers.item,
    ...resolvers.annotation,
  });
}

export function fetchNoteContext(
  client: ZoteroDatabase,
  item: Item,
  options: {
    resolvers: NoteResolvers;
    username: string | null;
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    collectionCache: CollectionCache;
  },
): NoteTemplateContext {
  const { resolvers, ...memos } = options;
  return buildNoteContextFromSource(
    fetchNoteSource(client, item, memos),
    resolvers,
  );
}

export interface AnnotationParent {
  attachment: Attachment;
  tplAttachment: TemplateAttachment;
  parentItem: TemplateParentItemData | null;
}

export interface AnnotationSources {
  annotations: readonly Annotation[];
  attachments: readonly Attachment[];
  parentItems: readonly Item[];
  tagsByItemID: ReadonlyMap<number, readonly ItemTag[]>;
  username: string | null;
}

export function fetchAnnotationSources(
  client: ZoteroDatabase,
  annotations: readonly Annotation[],
  options: {
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    username?: string | null;
  },
): AnnotationSources {
  if (annotations.length === 0) {
    return {
      annotations,
      attachments: [],
      parentItems: [],
      tagsByItemID: new Map(),
      username: options.username ?? null,
    };
  }

  const memo = { memo: options.groupIdMemo };
  const attachments: Attachment[] = [];
  for (const itemID of distinct(annotations.map((a) => a.parentItemID))) {
    const attachment = getAttachmentByItemId(client, itemID, memo);
    if (attachment) attachments.push(attachment);
  }
  return fetchParentSources(client, { annotations, attachments }, options);
}

export function fetchAttachmentSources(
  client: ZoteroDatabase,
  attachments: readonly Attachment[],
  options: {
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    username?: string | null;
  },
): AnnotationSources {
  return fetchParentSources(client, { annotations: [], attachments }, options);
}

function fetchParentSources(
  client: ZoteroDatabase,
  {
    annotations,
    attachments,
  }: {
    annotations: readonly Annotation[];
    attachments: readonly Attachment[];
  },
  options: {
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    username?: string | null;
  },
): AnnotationSources {
  const username =
    options.username === undefined
      ? getZoteroIdentity(client).username
      : options.username;
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const parentIDs = distinct(attachments.map((a) => a.parentItemID));
  const parentItems = getItemsByID(client, parentIDs, {
    memo: options.groupIdMemo,
  });

  const tagsByItemID = resolveItemTagsByIDs(
    client,
    [...annotations.map((a) => a.itemID), ...parentIDs],
    tagMemo,
  );

  return { annotations, attachments, parentItems, tagsByItemID, username };
}

export function buildAnnotationsTemplateData(
  sources: AnnotationSources,
  resolvers: AnnotationResolvers,
): Map<string, TemplateAnnotation> {
  const { annotations, tagsByItemID } = sources;
  const result = new Map<string, TemplateAnnotation>();
  const bundleByAttachment = buildAnnotationParents(sources, resolvers);

  for (const annotation of annotations) {
    const bundle = bundleByAttachment.get(annotation.parentItemID);
    if (!bundle) continue;
    result.set(
      annotation.key,
      annotationToTemplateData({
        annotation,
        tags: tagsByItemID.get(annotation.itemID) ?? [],
        getParentAttachment: () => bundle.tplAttachment,
        getParentItem: () => bundle.parentItem,
        commentToMarkdown: resolvers.commentToMarkdown,
        annotationImageLink: resolvers.annotationImageLink,
        fileLink: (anchor) => resolvers.fileLink(bundle.attachment, anchor),
      }),
    );
  }
  return result;
}

export function buildAnnotationParents(
  sources: AnnotationSources,
  resolvers: AnnotationResolvers,
): Map<number, AnnotationParent> {
  const { attachments, tagsByItemID, username } = sources;
  const parentItemsByID = new Map(
    sources.parentItems.map((item) => [item.itemID, item]),
  );

  const bundleByAttachment = new Map<number, AnnotationParent>();
  for (const attachment of attachments) {
    const parentItemData = parentItemsByID.get(attachment.parentItemID);
    let parentItem: TemplateParentItemData | null = null;
    if (parentItemData) {
      const parentBaseData = itemToTemplateBaseData({
        item: parentItemData,
        tags: tagsByItemID.get(parentItemData.itemID) ?? [],
      });
      parentItem = withItemPreview({
        ...parentBaseData,
        notePath: null,
        noteLink: () => null,
        ...resolveItemCore({
          item: parentItemData,
          baseData: parentBaseData,
          username,
          authorsShort: resolvers.authorsShort,
        }),
      });
    }
    bundleByAttachment.set(attachment.itemID, {
      attachment,
      parentItem,
      tplAttachment: resolveTemplateAttachment(attachment, resolvers),
    });
  }
  return bundleByAttachment;
}

export function fetchAnnotationsTemplateData(
  client: ZoteroDatabase,
  annotations: readonly Annotation[],
  options: {
    resolvers: AnnotationResolvers;
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    username?: string | null;
  },
): Map<string, TemplateAnnotation> {
  const { resolvers, ...memos } = options;
  return buildAnnotationsTemplateData(
    fetchAnnotationSources(client, annotations, memos),
    resolvers,
  );
}
