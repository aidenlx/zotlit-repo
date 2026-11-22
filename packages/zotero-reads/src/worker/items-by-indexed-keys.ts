import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";
import type { GroupIDMemo, Item, ZoteroDatabase } from "@zotlit/db";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

export function itemsByIndexedKeys(
  client: ZoteroDatabase,
  indexedKeys: readonly string[],
): Map<string, Item> {
  const libraryByGroupID = new Map<number | null, number | null>();
  const groupIDMemo: GroupIDMemo = new Map();
  const requested: { indexedKey: string; libraryID: number; key: string }[] =
    [];
  const keysByLibrary = new Map<number, string[]>();
  for (const indexedKey of indexedKeys) {
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) continue;
    if (!libraryByGroupID.has(parsed.groupID)) {
      libraryByGroupID.set(
        parsed.groupID,
        resolveIndexedKeyLibrary(client, indexedKey)?.libraryID ?? null,
      );
    }
    const libraryID = libraryByGroupID.get(parsed.groupID);
    if (libraryID == null) continue;
    groupIDMemo.set(libraryID, parsed.groupID);
    requested.push({ indexedKey, libraryID, key: parsed.key });
    const keys = keysByLibrary.get(libraryID);
    if (keys) keys.push(parsed.key);
    else keysByLibrary.set(libraryID, [parsed.key]);
  }
  const found = new Map<number, Map<string, Item>>();
  for (const [libraryID, keys] of keysByLibrary) {
    found.set(
      libraryID,
      new Map(
        getItemsByKey(client, keys, { libraryID, memo: groupIDMemo }).map(
          (item) => [item.key, item],
        ),
      ),
    );
  }
  const items = new Map<string, Item>();
  for (const { indexedKey, libraryID, key } of requested) {
    const item = found.get(libraryID)?.get(key);
    if (item) items.set(indexedKey, item);
  }
  return items;
}
