// The Attachments Zotero's own reader can be sent to.

/** One Attachment the Item offers to open in Zotero's reader. */
export interface ZoteroOpenableAttachment {
  /** Bare Zotero key of the Attachment itself, for `zotero://open`. */
  key: string;
  /** Group library ID, or `null` for the personal library. */
  groupID: number | null;
  /** Filename, which names the row when an Item carries several. */
  label: string;
}
