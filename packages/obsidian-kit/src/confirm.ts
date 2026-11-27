import type { Effect } from "effect";
import type { App } from "obsidian";
import { ConfirmationModal } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { awaitModal } from "#effect-modal.ts";
import { modalAnswer } from "#modal-answer.ts";

export interface ConfirmOptions {
  title: string;
  content?: string;
  action: string;
  cancel?: string;
  destructive?: boolean;
  cta?: boolean;
}

export function confirm(options: ConfirmOptions, app: App): Promise<boolean> {
  return modalAnswer<boolean>((resolve) =>
    openConfirmation(options, app, resolve),
  );
}

export function awaitConfirm(
  options: ConfirmOptions,
  app: App,
): Effect.Effect<boolean> {
  return awaitModal<boolean>((resolve) =>
    openConfirmation(options, app, resolve),
  );
}

function openConfirmation(
  options: ConfirmOptions,
  app: App,
  resolve: (answer: boolean) => void,
): ConfirmationModal {
  const { action, cancel, title, content, destructive, cta } = options;
  const modal = new ConfirmationModal(app);
  modal.setTitle(title);
  if (content) {
    modal.setContent(content);
  }
  modal.addButton((btn) => {
    btn.setButtonText(action).onClick(() => resolve(true));
    if (destructive) {
      btn.setDestructive();
    }
    if (cta) {
      btn.setCta();
    }
  });
  modal.addCancelButton(cancel ?? m.modal_cancel());
  modal.setCloseCallback(() => resolve(false));

  modal.open();
  return modal;
}
