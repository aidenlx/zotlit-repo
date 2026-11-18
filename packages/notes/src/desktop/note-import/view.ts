import type {
  BatchProfilePickerDeps,
  BatchProfilePickerOptions,
} from "#desktop/batch/batch-profile-choice.ts";
import type { BatchModalOptions } from "#desktop/batch/modal/index.ts";
import type { ProfileDialogServices } from "#desktop/profile/dialogs.ts";
// UI seam for note-import: opens the batch modal and the overwrite confirm against the running app.
import type { Effect } from "effect";
import type { App } from "obsidian";

import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import type { ConfirmOptions } from "@zotlit/obsidian-kit/confirm.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";

import { chooseBatchProfile } from "#desktop/batch/batch-profile-choice.ts";
import { BatchModal } from "#desktop/batch/modal/index.ts";

/**
 * The view capabilities the batch-import runners drive. Bundling them keeps the
 * concrete modal classes and the `App` handle out of the runners' service deps,
 * so the runners depend on this narrow UI port instead.
 */
export interface NoteImportView {
  openBatchModal(options: BatchModalOptions): void;
  /** The user's answer; an interrupt closes the modal. */
  confirm(options: ConfirmOptions): Effect.Effect<boolean>;
  /**
   * The user's Profile, or `undefined`; an interrupt closes the picker and
   * the Profile dialog it opened.
   */
  chooseProfile(
    options: BatchProfilePickerOptions,
  ): Effect.Effect<ProfileSelector | undefined, never, ProfileDialogServices>;
}

export function createNoteImportView(
  app: App,
  profilePicker: Omit<BatchProfilePickerDeps, "app">,
): NoteImportView {
  return {
    openBatchModal: (options) => new BatchModal(app, options).open(),
    confirm: (options) => awaitConfirm(options, app),
    chooseProfile: (options) =>
      chooseBatchProfile({ app, ...profilePicker }, options),
  };
}
