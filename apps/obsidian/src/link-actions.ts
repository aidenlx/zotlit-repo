import {
  batchProtocolActionId,
  exploreProtocolActionId,
  importAllNotesProtocolActionId,
  importManyProtocolActionId,
  importProtocolActionId,
  openAttachmentProtocolActionId,
  protocolActionId,
  showInLibraryProtocolActionId,
  updateAllProtocolActionId,
} from "@zotlit/protocol/actions";

export const linkActions = [
  protocolActionId("open"),
  protocolActionId("update"),
  batchProtocolActionId,
  importProtocolActionId,
  importManyProtocolActionId,
  updateAllProtocolActionId,
  importAllNotesProtocolActionId,
  exploreProtocolActionId,
  showInLibraryProtocolActionId,
  openAttachmentProtocolActionId,
] as const;
