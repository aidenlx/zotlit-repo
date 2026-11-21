// The `obsidian://` actions of desktop ZotLit, for the entry (`zt-main.ts`),
// which registers them before the body loads. The body's start type-checks
// this list against the actions its features register (`shellStart`).
import {
  batchProtocolActionId,
  exploreProtocolActionId,
  importAllNotesProtocolActionId,
  importManyProtocolActionId,
  importProfileProtocolActionId,
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
  importProfileProtocolActionId,
  showInLibraryProtocolActionId,
  openAttachmentProtocolActionId,
] as const;
