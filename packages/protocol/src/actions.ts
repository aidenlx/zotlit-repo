export const PROTOCOL_NAMESPACE = "zotlit";

export type ProtocolAction = "open" | "update";

export const protocolActions = [
  "open",
  "update",
] as const satisfies readonly ProtocolAction[];

export function protocolActionId<A extends ProtocolAction>(
  action: A,
): `${typeof PROTOCOL_NAMESPACE}/${A}` {
  return `${PROTOCOL_NAMESPACE}/${action}`;
}

const PROTOCOL_BATCH_ACTION = "update-many";

export const batchProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_BATCH_ACTION}` as const;

const PROTOCOL_IMPORT_ACTION = "import-note";

const PROTOCOL_IMPORT_MANY_ACTION = "import-notes";

export const importProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_ACTION}` as const;

export const importManyProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_MANY_ACTION}` as const;

const PROTOCOL_EXPLORE_ACTION = "explore";

export const exploreProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_EXPLORE_ACTION}` as const;

const PROTOCOL_SHOW_IN_LIBRARY_ACTION = "show-in-library";

export const showInLibraryProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_SHOW_IN_LIBRARY_ACTION}` as const;

const PROTOCOL_UPDATE_ALL_ACTION = "update-all";

const PROTOCOL_IMPORT_ALL_NOTES_ACTION = "import-all-notes";

export const updateAllProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_UPDATE_ALL_ACTION}` as const;

export const importAllNotesProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_IMPORT_ALL_NOTES_ACTION}` as const;

const PROTOCOL_OPEN_ATTACHMENT_ACTION = "open-attachment";

export const openAttachmentProtocolActionId =
  `${PROTOCOL_NAMESPACE}/${PROTOCOL_OPEN_ATTACHMENT_ACTION}` as const;
