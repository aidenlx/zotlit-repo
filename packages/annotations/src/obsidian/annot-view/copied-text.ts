// What a copy of Annotation Cards puts on the clipboard: one rule for one card
// and for a group, from the Annotation View and from the ZotLit PDF Reader.
import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";

import { commentPlainText } from "#core/annot-view/comment-format.ts";

/**
 * The `text/plain` a copy of these cards writes: each card's Quoted Text, or
 * its comment where it has no Quoted Text, in the order given, with a blank
 * line between two cards. A card with neither adds nothing.
 *
 * @param cards the Selected Cards, in list order.
 */
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
