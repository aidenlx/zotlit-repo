import type { ZoteroDatabase } from "#client/database.ts";
import type { Library } from "#queries/libraries.ts";

import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import { USER_LIBRARY_ID } from "./constants.ts";

import { getLibraryByGroupID } from "#queries/libraries.ts";

export function resolveIndexedKeyLibrary(
  client: ZoteroDatabase,
  indexedKey: string,
): { key: string; libraryID: number } | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const { key, groupID } = parsed;
  if (groupID == null) return { key, libraryID: USER_LIBRARY_ID };
  const library = getLibraryByGroupID(client, groupID);
  if (!library) return null;
  return { key, libraryID: library.libraryID };
}

export function resolveIndexedKeyLibraryIn(
  libraries: readonly Pick<Library, "libraryID" | "groupID">[],
  indexedKey: string,
): { key: string; libraryID: number } | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const { key, groupID } = parsed;
  if (groupID == null) return { key, libraryID: USER_LIBRARY_ID };
  const library = libraries.find((library) => library.groupID === groupID);
  if (!library) return null;
  return { key, libraryID: library.libraryID };
}
