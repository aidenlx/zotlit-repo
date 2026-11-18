// Which Attachments Obsidian's own PDF reader can host.

/** Case-insensitive fallback for a `linked_file` row Zotero leaves with no `contentType`. */
const PDF_EXTENSION_RE = /\.pdf$/i;

/**
 * Whether Obsidian's PDF view can host this Attachment — the rule that
 * separates an Obsidian-Openable Attachment from a Zotero-Openable one. Also
 * read by the Attachment path index, so one file gets one verdict.
 */
export function isPdfAttachment(
  contentType: string | null,
  absolutePath: string,
): boolean {
  return contentType !== null
    ? contentType === "application/pdf"
    : PDF_EXTENSION_RE.test(absolutePath);
}
