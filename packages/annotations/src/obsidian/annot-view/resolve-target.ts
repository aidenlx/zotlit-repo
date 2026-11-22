import type { ReaderSessionTarget } from "#core/reader-session/session.ts";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import type { AttachmentLock } from "./state.ts";

export interface LoadTarget {
  itemKey: string | null;
  lockedAttachmentKey: string | null;
  lock: AttachmentLock;
  key: string;
  libraryID: number;
  groupID: number | null;
}

export function resolveLibraryID(
  groupID: number | null,
  libraries: readonly Library[] | null,
): number | null {
  if (groupID === null) return USER_LIBRARY_ID;
  if (!libraries) return null;
  return libraries.find((l) => l.groupID === groupID)?.libraryID ?? null;
}

export type ActiveLeafTarget =
  | { kind: "note"; itemKey: string }
  | { kind: "pdf"; target: ReaderSessionTarget };

export type ResolveTargetInput = { libraries: readonly Library[] | null } & (
  | { mode: "active-tab"; leaf: ActiveLeafTarget | null }
  | { mode: "zotero-reader"; target: ReaderSessionTarget | null }
  | { mode: "pinned"; pinnedItemKey: string | null }
);

export function resolveLoadTarget(
  input: ResolveTargetInput,
): LoadTarget | null {
  const { libraries } = input;
  switch (input.mode) {
    case "active-tab":
      if (input.leaf === null) return null;
      return input.leaf.kind === "note"
        ? itemTarget(input.leaf.itemKey, libraries)
        : readerTarget(input.leaf.target, "obsidian-pdf", libraries);
    case "zotero-reader":
      return readerTarget(input.target, "zotero-reader", libraries);
    case "pinned":
      return itemTarget(input.pinnedItemKey, libraries);
  }
}

function readerTarget(
  target: ReaderSessionTarget | null,
  lock: AttachmentLock,
  libraries: readonly Library[] | null,
): LoadTarget | null {
  if (!target) return null;
  const base = locate(target.itemKey ?? target.attachmentKey, libraries);
  if (!base) return null;
  return {
    itemKey: target.itemKey,
    lockedAttachmentKey: target.attachmentKey,
    lock,
    ...base,
  };
}

function itemTarget(
  itemKey: string | null,
  libraries: readonly Library[] | null,
): LoadTarget | null {
  if (!itemKey) return null;
  const base = locate(itemKey, libraries);
  if (!base) return null;
  return { itemKey, lockedAttachmentKey: null, lock: null, ...base };
}

function locate(
  indexedKey: string,
  libraries: readonly Library[] | null,
): Pick<LoadTarget, "key" | "libraryID" | "groupID"> | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const libraryID = resolveLibraryID(parsed.groupID, libraries);
  if (libraryID === null) return null;
  return { key: parsed.key, libraryID, groupID: parsed.groupID };
}
