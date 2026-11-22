import { COMMENT_TAG_SOURCE } from "@zotlit/annotations/core/annot-view/comment-format.ts";

export function visibleText(field: string): string {
  return `${field}.replace(/${COMMENT_TAG_SOURCE.replaceAll("/", "\\/")}/gi, "")`;
}
