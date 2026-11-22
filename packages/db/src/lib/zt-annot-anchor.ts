import { isIndexedKey } from "@zotlit/zotero-types/keys";

export const ANNOTATION_ANCHOR_KEY = "zt-annotation";

export const ATTACHMENT_ANCHOR_KEY = "zt-attachment";

const PAGE_KEY = "page";

export interface AnnotationFileLinkAnchor {
  page?: number | null;
  annotation?: string | null;
  attachment?: string | null;
}

export interface ParsedAnnotationSubpath {
  page: number | null;
  annotation: string | null;
  attachment: string | null;
}

export function formatAnnotationFragment({
  page,
  annotation,
  attachment,
}: AnnotationFileLinkAnchor): string {
  const params = new URLSearchParams();
  if (isPageNumber(page)) params.set(PAGE_KEY, String(page));
  if (typeof annotation === "string" && isIndexedKey(annotation)) {
    params.set(ANNOTATION_ANCHOR_KEY, annotation);
  }
  if (typeof attachment === "string" && isIndexedKey(attachment)) {
    params.set(ATTACHMENT_ANCHOR_KEY, attachment);
  }
  return params.toString();
}

export function formatAnnotationSubpath(
  anchor: AnnotationFileLinkAnchor,
): string {
  const fragment = formatAnnotationFragment(anchor);
  return fragment === "" ? "" : `#${fragment}`;
}

export function parseAnnotationSubpath(
  subpath: string | null | undefined,
): ParsedAnnotationSubpath {
  const params = new URLSearchParams(
    subpath?.startsWith("#") === true ? subpath.slice(1) : (subpath ?? ""),
  );
  const page = params.has(PAGE_KEY) ? Number(params.get(PAGE_KEY)) : null;
  return {
    page: isPageNumber(page) ? page : null,
    annotation: indexedKeyOf(params.get(ANNOTATION_ANCHOR_KEY)),
    attachment: indexedKeyOf(params.get(ATTACHMENT_ANCHOR_KEY)),
  };
}

function indexedKeyOf(value: string | null): string | null {
  return value !== null && isIndexedKey(value) ? value : null;
}

function isPageNumber(page: number | null | undefined): page is number {
  return typeof page === "number" && Number.isInteger(page) && page > 0;
}
