import type { ZoteroDatabase } from "#client/database.ts";
import type { Annotation } from "#lib/zt-annot.ts";

import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import type { FindManyOptions, QueryRow } from "./_shared.ts";
import { defineQuery, defineKeyedQuery } from "./_shared.ts";
import type { GroupIDMemo } from "./libraries.ts";
import { groupIDForLibrary, resolveGroupID } from "./libraries.ts";

import { readDatabaseLayout } from "#layout/index.ts";

const annotationFindOptions = {
  with: {
    item: {
      columns: {
        key: true,
        libraryID: true,
        dateAdded: true,
        dateModified: true,
        clientVersion: true,
      },
      with: {
        itemTags: {
          columns: { type: true },
          with: { tag: { columns: { name: true } } },
        },
        groupItem: { columns: { createdByUserID: true } },
      },
    },
    parentAttachment: {
      columns: {},
      with: { item_itemID: { columns: { key: true } } },
    },
  },
  orderBy: { sortIndex: "asc" },
} satisfies FindManyOptions<"itemAnnotations">;

const legacyAnnotationFindOptions = {
  ...annotationFindOptions,
  with: {
    ...annotationFindOptions.with,
    item: {
      ...annotationFindOptions.with.item,
      columns: {
        key: true,
        libraryID: true,
        dateAdded: true,
        dateModified: true,
      },
    },
  },
} satisfies FindManyOptions<"itemAnnotations">;

const annotationsByParentQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemAnnotations.findMany({
      where: {
        parentItemID: placeholder("parentItemID"),
        item: { deletedItem: false },
      },
      ...annotationFindOptions,
    }),
);

const legacyAnnotationsByParentQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemAnnotations.findMany({
      where: {
        parentItemID: placeholder("parentItemID"),
        item: { deletedItem: false },
      },
      ...legacyAnnotationFindOptions,
    }),
);

const annotationsByKeysQuery = defineKeyedQuery<
  string,
  { libraryID: number }
>()(
  (db, { placeholder, contains }) =>
    db.query.itemAnnotations.findMany({
      where: {
        item: {
          RAW: (item) => contains(item.key),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      ...annotationFindOptions,
    }),
  { keyOf: (row) => row.item.key },
);

const legacyAnnotationsByKeysQuery = defineKeyedQuery<
  string,
  { libraryID: number }
>()(
  (db, { placeholder, contains }) =>
    db.query.itemAnnotations.findMany({
      where: {
        item: {
          RAW: (item) => contains(item.key),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      ...legacyAnnotationFindOptions,
    }),
  { keyOf: (row) => row.item.key },
);

type AnnotationRow = QueryRow<typeof annotationsByParentQuery>;

const annotationParentsQuery = defineKeyedQuery<
  string,
  { libraryID: number }
>()(
  (db, { placeholder, contains }) =>
    db.query.itemAnnotations.findMany({
      where: {
        item: {
          RAW: (item) => contains(item.key),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      columns: {},
      with: {
        item: { columns: { key: true } },
        parentAttachment: {
          columns: {},
          with: {
            item_itemID: { columns: { key: true } },
            item_parentItemID: { columns: { key: true } },
          },
        },
      },
    }),
  { keyOf: (row) => row.item.key },
);

export function getAnnotationParentKeys(
  db: ZoteroDatabase,
  keys: readonly string[],
  libraryID: number,
): { key: string; parentKey: string }[] {
  return annotationParentsQuery(db, keys, { params: { libraryID } }).map(
    ({ item, parentAttachment }) => ({
      key: item.key,
      parentKey:
        parentAttachment.item_parentItemID?.key ??
        parentAttachment.item_itemID.key,
    }),
  );
}

export function getAnnotationsByParent(
  db: ZoteroDatabase,
  parentItemID: number,
  opts?: { memo?: GroupIDMemo },
): Annotation[] {
  const memo = opts?.memo ?? new Map();
  const rows = readDatabaseLayout(db).has("items", "clientVersion")
    ? annotationsByParentQuery.prepared(db).all({ parentItemID })
    : legacyAnnotationsByParentQuery.prepared(db).all({ parentItemID });
  return rows.map((r) =>
    toAnnotation(r, resolveGroupID(db, r.item.libraryID, memo)),
  );
}

export function getAnnotationsByKey(
  db: ZoteroDatabase,
  keys: readonly string[],
  libraryID: number,
): Annotation[] {
  if (keys.length === 0) return [];

  const groupId = groupIDForLibrary(db, libraryID);
  const byKeys = readDatabaseLayout(db).has("items", "clientVersion")
    ? annotationsByKeysQuery
    : legacyAnnotationsByKeysQuery;
  return byKeys(db, keys, { params: { libraryID } }).flatMap((row) =>
    row.parentAttachment ? [toAnnotation(row, groupId)] : [],
  );
}

function toAnnotation(
  row: AnnotationRow | QueryRow<typeof legacyAnnotationsByParentQuery>,
  groupID: number | null,
): Annotation {
  return {
    itemID: row.itemID,
    key: row.item.key,
    indexedKey: formatIndexedKey(row.item.key, groupID),
    libraryID: row.item.libraryID,
    groupID,
    dateAdded: row.item.dateAdded,
    dateModified: row.item.dateModified,
    version: "clientVersion" in row.item ? row.item.clientVersion : 0,
    type: row.type,
    text: row.text,
    comment: row.comment,
    color: row.color,
    pageLabel: row.pageLabel,
    tags: row.item.itemTags.map((it) => it.tag.name),
    tagDetails: row.item.itemTags.map((it) => ({
      name: it.tag.name,
      type: it.type,
    })),
    sortIndex: row.sortIndex,
    position: row.position,
    authorName: row.authorName,
    isExternal: row.isExternal,
    createdByUserID: row.item.groupItem?.createdByUserID ?? null,
    parentItemID: row.parentItemID,
    parentKey: row.parentAttachment.item_itemID.key,
  };
}
