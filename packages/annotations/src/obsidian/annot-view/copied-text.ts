import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";

import { commentPlainText } from "#core/annot-view/comment-format.ts";

export function copiedText(
  cards: readonly Pick<AnnotationRecord, "text" | "comment">[],
): string {
  return cards
    .flatMap(({ text, comment }) => {
      if (text) return [text];
      return comment ? [commentPlainText(comment)] : [];
    })
    .join("\n\n");
}
