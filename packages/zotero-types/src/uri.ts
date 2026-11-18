/**
 * Zotero deep links (`zotero://`) that name an object by its key alone.
 * `select` navigates the library to an item; the format-agnostic `open` scheme
 * navigates to an annotation within its attachment (PDF / EPUB / snapshot).
 */
import { isItemKey } from "./keys.ts";

function libraryPath(groupID: number | null): string {
  return groupID == null ? "library" : `groups/${groupID}`;
}

/** `zotero://select` deep link to a library item. */
export function itemSelectUri(key: string, groupID: number | null): string {
  return `zotero://select/${libraryPath(groupID)}/items/${key}`;
}

export interface AnnotationOpenUriOptions {
  attachmentKey: string;
  annotationKey: string;
  /** Page positioning hint; `null` to omit. */
  pageLabel: string | null;
  /** Group library id; `null` for the personal library. */
  groupID: number | null;
}

/** `zotero://open` deep link to an attachment (opens it in Zotero's reader). */
export function attachmentOpenUri(key: string, groupID: number | null): string {
  return `zotero://open/${libraryPath(groupID)}/items/${key}`;
}

/** `zotero://open` deep link to an annotation within its attachment. */
export function annotationOpenUri({
  attachmentKey,
  annotationKey,
  pageLabel,
  groupID,
}: AnnotationOpenUriOptions): string {
  const params = new URLSearchParams([["annotation", annotationKey]]);
  if (pageLabel) params.set("page", pageLabel);
  params.sort();
  return `${attachmentOpenUri(attachmentKey, groupID)}?${params.toString()}`;
}

/** A positive decimal group id, the only kind Zotero writes in a link. */
const GROUP_ID_RE = /^[1-9]\d*$/;

/**
 * The inverse of {@link annotationOpenUri}: what a `zotero://open` link to an
 * annotation names. Both keys come back bare, beside the group id, so a caller
 * that needs an Indexed Key formats one itself.
 *
 * @returns `null` for anything that is not an open link carrying a valid
 *   annotation key — an attachment link with no annotation is not one.
 */
export function parseAnnotationOpenUri(
  url: string,
): AnnotationOpenUriOptions | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "zotero:" || parsed.host !== "open") return null;

  const segments = parsed.pathname.split("/").slice(1);
  let groupID: number | null;
  let rest: string[];
  if (segments[0] === "library") {
    groupID = null;
    rest = segments.slice(1);
  } else if (segments[0] === "groups" && GROUP_ID_RE.test(segments[1] ?? "")) {
    groupID = Number(segments[1]);
    rest = segments.slice(2);
  } else {
    return null;
  }
  const [items, attachmentKey, ...extra] = rest;
  if (items !== "items" || attachmentKey === undefined || extra.length > 0)
    return null;

  const annotationKey = parsed.searchParams.get("annotation");
  if (
    !isItemKey(attachmentKey) ||
    annotationKey === null ||
    !isItemKey(annotationKey)
  )
    return null;

  return {
    attachmentKey,
    annotationKey,
    pageLabel: parsed.searchParams.get("page") || null,
    groupID,
  };
}
