import { formatIndexedKey } from "@zotlit/zotero-types/keys";
import { parseAnnotationOpenUri } from "@zotlit/zotero-types/uri";

export type AnnotationLinkShape =
  | { kind: "link"; text: string }
  | { kind: "autolink" | "image" };

export interface AnnotationLink {
  form: "citation" | "labelled" | "embed";
  indexedKey: string;
  attachmentKey: string;
  pageLabel: string | null;
}

export type ClassifiedAnnotationLink =
  | AnnotationLink
  | { form: "malformed"; destination: string };

export function classifyAnnotationLink(
  destination: string,
  shape: AnnotationLinkShape,
): ClassifiedAnnotationLink | null {
  const form =
    shape.kind === "image"
      ? "embed"
      : shape.kind === "link" && shape.text === ""
        ? "citation"
        : "labelled";
  const parsed = parseAnnotationOpenUri(destination);
  if (!parsed) {
    return form === "citation" && destination.startsWith("zotero://open/")
      ? { form: "malformed", destination }
      : null;
  }
  return {
    form,
    indexedKey: formatIndexedKey(parsed.annotationKey, parsed.groupID),
    attachmentKey: parsed.attachmentKey,
    pageLabel: parsed.pageLabel,
  };
}
