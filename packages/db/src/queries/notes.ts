import type { ZoteroDatabase } from "#client/database.ts";

import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import type { FindManyOptions, QueryRow } from "./_shared.ts";
import { defineQuery, defineKeyedQuery } from "./_shared.ts";
import type { GroupIDMemo } from "./libraries.ts";
import { groupIDForLibrary, resolveGroupID } from "./libraries.ts";

export interface ChildNote {
  groupID: number | null;
  itemID: number;
  libraryID: number;
  key: string;
  indexedKey: string;
  parentItemID: number | null;
  title: string | null;
  dateModified: Temporal.Instant;
}

export interface Note extends ChildNote {
  note: string | null;
  dateAdded: Temporal.Instant;
}

const childNotesQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemNotes.findMany({
      columns: { title: true, itemID: true, parentItemID: true },
      with: {
        item: { columns: { key: true, libraryID: true, dateModified: true } },
      },
      where: {
        parentItemID: placeholder("parentItemID"),
        item: { deletedItem: false },
      },
      orderBy: { itemID: "asc" },
    }),
);

const noteOptions = {
  columns: { title: true, note: true, itemID: true, parentItemID: true },
  with: {
    item: {
      columns: {
        key: true,
        dateAdded: true,
        dateModified: true,
        libraryID: true,
      },
    },
  },
} satisfies FindManyOptions<"itemNotes">;

const noteByKeyQuery = defineQuery<{ libraryID: number; key: string }>()(
  (db, { placeholder }) =>
    db.query.itemNotes.findMany({
      where: {
        item: {
          key: placeholder("key"),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      ...noteOptions,
    }),
);

type ChildNoteRow = QueryRow<typeof childNotesQuery>;
type NoteRow = QueryRow<typeof noteByKeyQuery>;

function toChildNote(row: ChildNoteRow, groupID: number | null): ChildNote {
  return {
    itemID: row.itemID,
    libraryID: row.item.libraryID,
    groupID,
    parentItemID: row.parentItemID,
    key: row.item.key,
    indexedKey: formatIndexedKey(row.item.key, groupID),
    title: row.title,
    dateModified: row.item.dateModified,
  };
}

function toNote(row: NoteRow, groupID: number | null): Note {
  return {
    itemID: row.itemID,
    libraryID: row.item.libraryID,
    groupID,
    parentItemID: row.parentItemID,
    key: row.item.key,
    indexedKey: formatIndexedKey(row.item.key, groupID),
    title: row.title,
    note: row.note,
    dateAdded: row.item.dateAdded,
    dateModified: row.item.dateModified,
  };
}

export function getChildNotes(
  db: ZoteroDatabase,
  parentItemID: number,
  opts?: { memo?: GroupIDMemo },
): ChildNote[] {
  const memo = opts?.memo ?? new Map();
  return childNotesQuery
    .prepared(db)
    .all({ parentItemID })
    .map((row) =>
      toChildNote(row, resolveGroupID(db, row.item.libraryID, memo)),
    );
}

export function getNoteByKey(
  db: ZoteroDatabase,
  noteKey: string,
  opts: { libraryID: number; memo?: GroupIDMemo },
): Note | null {
  const row = noteByKeyQuery
    .prepared(db)
    .all({ libraryID: opts.libraryID, key: noteKey })[0];
  if (!row) return null;
  return toNote(
    row,
    resolveGroupID(db, opts.libraryID, opts.memo ?? new Map()),
  );
}

const notesByKeysQuery = defineKeyedQuery<string, { libraryID: number }>()(
  (db, { placeholder, contains }) =>
    db.query.itemNotes.findMany({
      where: {
        item: {
          RAW: (item) => contains(item.key),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      ...noteOptions,
    }),
  { keyOf: (row) => row.item.key },
);

export function getNotesByKey(
  db: ZoteroDatabase,
  libraryID: number,
  keys: readonly string[],
): Note[] {
  if (keys.length === 0) return [];
  const rows = notesByKeysQuery(db, keys, { params: { libraryID } });
  if (rows.length === 0) return [];
  const groupID = groupIDForLibrary(db, libraryID);
  return rows.map((row) => toNote(row, groupID));
}

export interface NoteRef {
  note: ChildNote;
  trashed: boolean;
}

const noteRefsByItemIdsQuery = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db.query.itemNotes.findMany({
      columns: { title: true, itemID: true, parentItemID: true },
      with: {
        item: {
          columns: { key: true, libraryID: true, dateModified: true },
          with: { deletedItem: { columns: { itemID: true } } },
        },
      },
      where: { RAW: (note) => contains(note.itemID) },
      orderBy: { itemID: "asc" },
    }),
  { keyOf: (row) => row.itemID },
);

export function getNoteRefsByItemIDs(
  db: ZoteroDatabase,
  itemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): Map<number, NoteRef> {
  const refs = new Map<number, NoteRef>();
  if (itemIDs.length === 0) return refs;
  const memo = opts?.memo ?? new Map();
  for (const row of noteRefsByItemIdsQuery(
    db,
    [...new Set(itemIDs)].toSorted((a, b) => a - b),
  )) {
    refs.set(row.itemID, {
      note: toChildNote(row, resolveGroupID(db, row.item.libraryID, memo)),
      trashed: row.item.deletedItem !== null,
    });
  }
  return refs;
}

const childNotesByParentsQuery = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db.query.itemNotes.findMany({
      columns: { title: true, itemID: true, parentItemID: true },
      with: {
        item: { columns: { key: true, libraryID: true, dateModified: true } },
      },
      where: {
        RAW: (note) => contains(note.parentItemID),
        item: { deletedItem: false },
      },
      orderBy: { itemID: "asc" },
    }),
  { keyOf: (row) => row.parentItemID! },
);

export function getChildNotesByParentIDs(
  db: ZoteroDatabase,
  parentItemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): ChildNote[] {
  if (parentItemIDs.length === 0) return [];
  const memo = opts?.memo ?? new Map();
  return childNotesByParentsQuery(db, parentItemIDs).map((row) =>
    toChildNote(row, resolveGroupID(db, row.item.libraryID, memo)),
  );
}
