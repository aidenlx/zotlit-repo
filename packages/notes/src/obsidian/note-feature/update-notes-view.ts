import type { Effect } from "effect";
import { ConfirmationModal } from "obsidian";
import type { App, TFile } from "obsidian";

import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

export interface ActiveNote {
  file: TFile;
  itemKey: string;
}

export type UpdateNotesChoice =
  | { target: "note"; note: ActiveNote }
  | { target: "all"; create: boolean };

export function awaitUpdateNotesChoice(
  app: App,
  note?: ActiveNote,
): Effect.Effect<UpdateNotesChoice | null> {
  return awaitModal<UpdateNotesChoice | null>((resolve) => {
    const modal = new ConfirmationModal(app);
    let create = false;
    modal.setTitle(m.modal_update_notes_title());
    modal.setContent(m.modal_update_notes_desc());
    modal.addCheckbox(m.modal_update_notes_create(), (checked) => {
      create = checked;
    });
    if (note)
      modal.addButton((button) => {
        button
          .setButtonText(m.modal_update_notes_active())
          .setCta()
          .onClick(() => resolve({ target: "note", note }));
      });
    modal.addButton((button) => {
      button
        .setButtonText(m.modal_update_notes_all())
        .onClick(() => resolve({ target: "all", create }));
    });
    modal.addCancelButton(m.modal_cancel());
    modal.setCloseCallback(() => resolve(null));
    modal.open();
    return modal;
  });
}
