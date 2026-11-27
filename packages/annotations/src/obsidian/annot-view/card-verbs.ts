import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";

import type { ConfirmOptions } from "@zotlit/obsidian-kit/confirm.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import * as toast from "@zotlit/obsidian-kit/toast.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { CardBlock } from "./card-controls.ts";
import { copiedText } from "./copied-text.ts";

export function deleteConfirmation(count: number): ConfirmOptions {
  return {
    ...(count > 1
      ? {
          title: m.annot_view_delete_group_confirm_title({ count }),
          content: m.annot_view_delete_group_confirm_content(),
        }
      : {
          title: m.annot_view_delete_confirm_title(),
          content: m.annot_view_delete_confirm_content(),
        }),
    action: m.annot_view_delete_confirm_action(),
    destructive: true,
  };
}

export function copyText(
  cards: readonly Pick<AnnotationRecord, "text" | "comment">[],
): boolean {
  const text = copiedText(cards);
  if (text === "") return false;
  void toast.promise(navigator.clipboard.writeText(text), {
    success: m.annot_view_copied_text(),
    error: m.annot_view_copy_failed(),
  });
  return true;
}

export function blockedNotice(
  block: CardBlock,
  onAllowEditing: () => void,
): void {
  if (block.action === null) {
    new BaseNotice(block.reason);
    return;
  }
  new BaseNotice({
    title: block.reason,
    actions: [{ label: m.capability_enable_editing(), run: onAllowEditing }],
  });
}
