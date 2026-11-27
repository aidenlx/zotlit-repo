import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { FileMenuSegment } from "@zotlit/plugin-services/obsidian/file-menu.ts";

import type { AttachmentOpenDeps } from "./actions.ts";
import { openGesture, pdfPickerReader } from "./actions.ts";
import { openAttachments } from "./open-attachments.ts";

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
          const target = evt.currentTarget as HTMLElement | null;
          const anchor = target
            ? { rect: target.getBoundingClientRect(), doc: target.doc }
            : undefined;
          void (async () => {
            const pdfs =
              await deps.attachments.literatureNoteAttachments(itemKey);
            if (!pdfs) return;
            openAttachments(pdfs.attachments, {
              reader: pdfPickerReader(
                openGesture(deps.opener, deps.bridge.runAndForget),
                pdfs,
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
