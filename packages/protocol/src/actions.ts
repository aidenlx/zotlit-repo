// The `obsidian://zotlit/<action>` action ids, in a module of constants alone:
// the plugin entry registers them before the plugin body loads.

/**
 * Obsidian protocol namespace ZotLit owns. Each action is registered as
 * `"zotlit/<action>"` following Obsidian's URI convention
 * ({@link https://help.obsidian.md/Extending+Obsidian/Obsidian+URI}).
 */
export const PROTOCOL_NAMESPACE = "zotlit";

/** Literature-note actions, following Obsidian's one-handler-per-verb convention. */
export type ProtocolAction = "open" | "update";

export const protocolActions = [
  "open",
  "update",
] as const satisfies readonly ProtocolAction[];

/** Full Obsidian action string for `registerObsidianProtocolHandler`. */
export function protocolActionId<A extends ProtocolAction>(
  action: A,
): `${typeof PROTOCOL_NAMESPACE}/${A}` {
  return `${PROTOCOL_NAMESPACE}/${action}`;
}

/**
 * Batch literature-note action. Kept out of {@link protocolActions} because it
 * carries a different query shape (an `items` list, not a single `item`) and a
 * different handler.
 */
const PROTOCOL_BATCH_ACTION = "update-many";

/** Full Obsidian action string for the batch handler. */
export const batchProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_BATCH_ACTION}` as const;

/**
 * Single-item note-import action. Kept out of {@link protocolActions} (different
 * query shape with `mode`).
 */
const PROTOCOL_IMPORT_ACTION = "import-note";

/** Batch note-import action. */
const PROTOCOL_IMPORT_MANY_ACTION = "import-notes";

/** Full Obsidian action string for a single-note import. */
export const importProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_ACTION}` as const;

/** Full Obsidian action string for the batch import handler. */
export const importManyProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_MANY_ACTION}` as const;

const PROTOCOL_EXPLORE_ACTION = "explore";

export const exploreProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_EXPLORE_ACTION}` as const;

const PROTOCOL_SHOW_IN_LIBRARY_ACTION = "show-in-library";

/**
 * Open the Library View on one Item. The link names the Item by its Indexed
 * Key, which every synced device shares, so a link written into a note keeps
 * working on each of them; it carries no `source-id`. {@link libraryViewUri}
 * builds it.
 */
export const showInLibraryProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_SHOW_IN_LIBRARY_ACTION}` as const;

const PROTOCOL_UPDATE_ALL_ACTION = "update-all";

/**
 * Library-wide note import. Shares {@link updateAllProtocolQuerySchema}'s query
 * shape, and gathers both child notes of regular items and standalone notes in
 * scope — so it carries no `mode`.
 */
const PROTOCOL_IMPORT_ALL_NOTES_ACTION = "import-all-notes";

export const updateAllProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_UPDATE_ALL_ACTION}` as const;

export const importAllNotesProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_ALL_NOTES_ACTION}` as const;

const PROTOCOL_OPEN_ATTACHMENT_ACTION = "open-attachment";

/**
 * Full Obsidian action string for `registerObsidianProtocolHandler`. Kept out
 * of {@link protocolActions} because it carries a different handler: the
 * receiver opens a PDF attachment in Obsidian's own reader, branching on
 * whether `item` names a regular item or an attachment.
 */
export const openAttachmentProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_OPEN_ATTACHMENT_ACTION}` as const;
