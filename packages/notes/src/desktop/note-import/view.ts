import type {
  BatchProfilePickerDeps,
  BatchProfilePickerOptions,
} from "#desktop/batch/batch-profile-choice.ts";
import type { BatchModalOptions } from "#desktop/batch/modal/index.ts";
import type { ProfileDialogServices } from "#desktop/profile/dialogs.ts";
import type { Effect } from "effect";
import type { App } from "obsidian";

import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import type { ConfirmOptions } from "@zotlit/obsidian-kit/confirm.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";

import { chooseBatchProfile } from "#desktop/batch/batch-profile-choice.ts";
import { BatchModal } from "#desktop/batch/modal/index.ts";

export interface NoteImportView {
  openBatchModal(options: BatchModalOptions): void;
  confirm(options: ConfirmOptions): Effect.Effect<boolean>;
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
