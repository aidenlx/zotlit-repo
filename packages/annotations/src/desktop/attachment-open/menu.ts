// Literature Note file-menu entry that opens the Item's PDF Attachment(s).

import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { FileMenuSegment } from "@zotlit/plugin-services/obsidian/file-menu.ts";

import type { AttachmentOpenDeps } from "./actions.ts";
import { openGesture, pdfPickerReader } from "./actions.ts";
import { openAttachments } from "./open-attachments.ts";

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
