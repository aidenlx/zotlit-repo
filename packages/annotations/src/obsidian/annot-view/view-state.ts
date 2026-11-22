import { Option, Schema } from "effect";

import { isIndexedKey } from "@zotlit/zotero-types/keys";

import type { FollowMode } from "./state.ts";

export const DEFAULT_FOLLOW_MODE: FollowMode = "active-tab";

export interface AnnotViewState {
  followMode: FollowMode;
  previousMode: FollowMode;
  pinnedItemKey: string | null;
}

const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeObject = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Unknown),
);
const decodeMode = Schema.decodeUnknownOption(
  Schema.Literals(["active-tab", "zotero-reader", "pinned"]),
);

const RENAMED: Readonly<Record<string, FollowMode>> = {
  note: "active-tab",
  reader: "zotero-reader",
  linked: "pinned",
};

export function parseAnnotViewState(raw: unknown): AnnotViewState {
  const stored: Readonly<Record<string, unknown>> = Option.getOrElse(
    decodeObject(raw),
    () => ({}),
  );
  const pinnedItemKey = readIndexedKey(
    stored.pinnedItemKey ?? stored.linkedIndexedKey,
  );
  const followMode = readMode(stored.followMode);
  const previousMode = readMode(stored.previousMode);
  if (followMode === "pinned" && pinnedItemKey === null) {
    return {
      followMode: unpinnedMode(previousMode),
      previousMode: DEFAULT_FOLLOW_MODE,
      pinnedItemKey: null,
    };
  }
  return {
    followMode,
    previousMode: unpinnedMode(previousMode),
    pinnedItemKey,
  };
}

export function serializeAnnotViewState(
  state: AnnotViewState,
): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    followMode: state.followMode,
    previousMode: state.previousMode,
  };
  if (state.pinnedItemKey !== null) stored.pinnedItemKey = state.pinnedItemKey;
  return stored;
}

export function unpinnedMode(previousMode: FollowMode): FollowMode {
  return previousMode === "pinned" ? DEFAULT_FOLLOW_MODE : previousMode;
}

export function readSidebarQuery(raw: unknown): string | null {
  const stored = Option.getOrNull(decodeObject(raw));
  const query = Option.getOrNull(decodeString(stored?.query));
  return query && query.length > 0 ? query : null;
}

function readMode(value: unknown): FollowMode {
  const text = Option.getOrNull(decodeString(value));
  return Option.getOrElse(decodeMode(value), () =>
    text === null
      ? DEFAULT_FOLLOW_MODE
      : (RENAMED[text] ?? DEFAULT_FOLLOW_MODE),
  );
}

function readIndexedKey(value: unknown): string | null {
  const key = Option.getOrNull(decodeString(value));
  return key !== null && isIndexedKey(key) ? key : null;
}
