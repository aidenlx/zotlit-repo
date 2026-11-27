import { sql } from "drizzle-orm";

import {
  getCitekeysByLibrary,
  getCollectionNodesByLibrary,
  getItemsByLibrary,
  getLibraries,
  getLibraryTagNames,
  getNoteItemIDsByLibrary,
} from "@zotlit/db";
import type { ZoteroDatabase } from "@zotlit/db";

function keysOf(
  db: ZoteroDatabase,
  table: "items" | "collections",
): Map<number, string> {
  const id = table === "items" ? "itemID" : "collectionID";
  return new Map(
    db
      .all<{ id: number; key: string }>(
        sql`select ${sql.identifier(id)} as id, key from ${sql.identifier(table)}`,
      )
      .map((row) => [Number(row.id), row.key]),
  );
}

function withoutLocalIDs(
  value: unknown,
  maps: { items: Map<number, string>; collections: Map<number, string> },
  field?: string,
): unknown {
  if (typeof value === "number") {
    if (field === "itemID" || field === "parentItemID")
      return maps.items.get(value) ?? `missing:${value}`;
    if (field === "collectionID" || field === "parentCollectionID" || field === "parentID")
      return maps.collections.get(value) ?? `missing:${value}`;
    if (field === "libraryID") return "local";
    return value;
  }
  if (value instanceof Temporal.Instant) return value.toString();
  if (Array.isArray(value))
    return value.map((entry) => withoutLocalIDs(entry, maps));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        withoutLocalIDs(entry, maps, key),
      ]),
    );
  }
  return value;
}

export function readerView(db: ZoteroDatabase): Record<string, unknown> {
  const maps = {
    items: keysOf(db, "items"),
    collections: keysOf(db, "collections"),
  };
  const view: Record<string, unknown> = {};
  for (const library of getLibraries(db)) {
    const name =
      library.groupID === null ? "user" : `group:${library.groupID}`;
    const { libraryID } = library;
    view[name] = withoutLocalIDs(
      {
        library,
        items: getItemsByLibrary(db, libraryID).sort((a, b) =>
          a.key.localeCompare(b.key),
        ),
        collections: getCollectionNodesByLibrary(db, libraryID),
        citekeys: getCitekeysByLibrary(db, libraryID),
        tags: getLibraryTagNames(db, libraryID).sort(),
        notes: getNoteItemIDsByLibrary(db, libraryID)
          .map((itemID) => maps.items.get(itemID) ?? "")
          .sort((a, b) => a.localeCompare(b)),
      },
      maps,
    );
  }
  return view;
}
