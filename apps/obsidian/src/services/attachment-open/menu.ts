// Literature Note file-menu entry that opens the Item's PDF Attachment(s).

import { openAttachments } from "@/lib/attachment-open.ts";
import * as m from "@/lib/i18n/generated/messages.ts";
import { MENU_SECTION } from "@/lib/menu-section.ts";
import type { FileMenuSegment } from "@/services/file-menu.ts";

import type { AttachmentOpenDeps } from "./actions.ts";
import { openGesture, pdfPickerReader } from "./actions.ts";

/**
 * The `open-pdf` entry on a Literature Note's file menu. A pointer click shows
 * Obsidian's own context Menu over several Attachments.
 */
export function attachmentOpenFileMenu(
  deps: AttachmentOpenDeps,
): FileMenuSegment {
  return (menu, { itemKey }) => {
    if (!itemKey) return;
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.command_open_pdf_name())
        .setIcon("file-text")
        .onClick((evt) => {
          // Dispatch ends at the first `await` below and nulls
          // `currentTarget`, so the picker's anchor is read now.
          const target = evt.currentTarget as HTMLElement | null;
          const anchor = target
            ? { rect: target.getBoundingClientRect(), doc: target.doc }
            : undefined;
          void (async () => {
            const attachments =
              await deps.attachments.literatureNoteAttachments(itemKey);
            if (!attachments) return;
            openAttachments(attachments, {
              reader: pdfPickerReader(
                openGesture(deps.opener, deps.bridge.runAndForget),
              ),
              host: deps.app,
              event: evt,
              anchor,
            });
          })();
        }),
    );
  };
}
