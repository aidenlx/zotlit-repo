import { isItemKey } from "./keys.ts";

function libraryPath(groupID: number | null): string {
  return groupID == null ? "library" : `groups/${groupID}`;
}

export function itemSelectUri(key: string, groupID: number | null): string {
  return `zotero://select/${libraryPath(groupID)}/items/${key}`;
}

export interface AnnotationOpenUriOptions {
  attachmentKey: string;
  annotationKey: string;
  pageLabel: string | null;
  groupID: number | null;
}

export function attachmentOpenUri(key: string, groupID: number | null): string {
  return `zotero://open/${libraryPath(groupID)}/items/${key}`;
}

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

const GROUP_ID_RE = /^[1-9]\d*$/;

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
