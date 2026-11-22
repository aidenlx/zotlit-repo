import { regex } from "arkregex";

const ITEM_KEY_RE = regex("^[23456789A-NP-Z]{8}$");

export function isItemKey(value: string): boolean {
  return ITEM_KEY_RE.test(value);
}

const GROUP_ID_RE = regex("^\\d+$");

export interface ParsedIndexedKey {
  key: string;
  groupID: number | null;
}

export function formatIndexedKey(
  key: string,
  groupID: number | null | undefined,
): string {
  return groupID == null ? key : `${key}g${groupID}`;
}

export function parseIndexedKey(indexedKey: string): ParsedIndexedKey | null {
  const parts = indexedKey.split("g");
  if (parts.length > 2) return null;
  const key = parts[0]!;
  const groupID = parts[1];
  if (!isItemKey(key)) return null;
  if (groupID === undefined) return { key, groupID: null };
  if (!GROUP_ID_RE.test(groupID)) return null;

  const parsedGroupID = Number(groupID);
  return Number.isSafeInteger(parsedGroupID)
    ? { key, groupID: parsedGroupID }
    : null;
}

export function isIndexedKey(value: string): boolean {
  return parseIndexedKey(value) !== null;
}
