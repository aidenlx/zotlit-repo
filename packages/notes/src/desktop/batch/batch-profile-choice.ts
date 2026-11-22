import type { InteractiveCreationPorts } from "#desktop/note-feature/index.ts";
import type {
  CreationProfileSelection,
  ProfilePreview,
} from "#desktop/note-feature/index.ts";
import type { ProfilePick } from "#desktop/profile/profile-picker.ts";
import { Effect } from "effect";

import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";

import {
  installedStyles,
  settleProfilePick,
} from "#desktop/note-feature/creation-view.ts";
import { openLiteratureNoteProfile } from "#desktop/profile/profile-picker.ts";

export type BatchProfilePickerDeps = Pick<
  InteractiveCreationPorts,
  "app" | "createProfile" | "importProfile"
>;
export interface BatchProfilePickerOptions {
  indexedKey?: string;
  selection: CreationProfileSelection;
  previews: readonly ProfilePreview[];
  problem?: string;
}

export const chooseBatchProfile = Effect.fnUntraced(function* (
  deps: BatchProfilePickerDeps,
  options: BatchProfilePickerOptions,
) {
  const styles = yield* installedStyles;
  const picker: Parameters<typeof openLiteratureNoteProfile>[1] = {
    preselected: options.selection.selector,
    matchContext: "batch",
    source: options.selection.source,
    candidates:
      options.selection.problem?.kind === "overlap"
        ? options.selection.problem.candidates.map(({ id }) => id)
        : undefined,
    reason: options.selection.reason,
    problem: options.problem,
    previews: options.previews,
    styles,
  };
  const pick = yield* awaitModal<ProfilePick | undefined>((resolve) =>
    openLiteratureNoteProfile(deps.app, picker, resolve),
  );
  const { choice } = yield* settleProfilePick(deps, pick, {
    indexedKey: options.indexedKey,
    useForNote: false,
  });
  const selector: ProfileSelector | undefined = choice?.id;
  return selector;
});
