import type { ProfilePick } from "#desktop/profile/profile-picker.ts";
import { Cause, Effect } from "effect";
// The single consent surface for changing a Literature Note's Profile.
import { dirname } from "node:path/posix";
import { ConfirmationModal } from "obsidian";
import type { App, TFile } from "obsidian";

import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { normalizeFolderPath } from "@zotlit/obsidian-kit/ensure-folder.ts";
import { Notifier, withProgress } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "@zotlit/plugin-services/obsidian/note-index/service.ts";

import { installedStyles, settleProfilePick } from "./creation-view.ts";
import type { InteractiveCreationPorts } from "./creation-view.ts";
import { NoteFeature } from "./service.ts";
import { noteOperationDiagnosticContent } from "./update-single.ts";

import { openLiteratureNoteProfile } from "#desktop/profile/profile-picker.ts";

const logged = withLogCategory("note-feature");

export interface ProfileSwitchConsent {
  confirmed: boolean;
  move: boolean;
  importedNotes: boolean;
}

/**
 * Change `file`'s Profile after the user picks one and consents to what the
 * change does. The switch reports its outcome on a progress notice; a failure
 * before it is logged and shows the failure notice. An interrupt closes the
 * open dialog.
 */
export const switchNoteProfileInteractively = Effect.fn(
  "switchNoteProfileInteractively",
)(function* (ports: InteractiveCreationPorts, file: TFile) {
  const noteFeature = yield* NoteFeature;
  const notifier = yield* Notifier;
  yield* Effect.gen(function* () {
    const cache = yield* (yield* MetadataCache).fileCache(file);
    const indexedKey =
      itemKeyFromFrontmatter(cache) ??
      noteKeyFromFrontmatter(cache) ??
      undefined;
    let [plan, styles] = yield* Effect.all(
      [noteFeature.prepareProfileSwitch(file), installedStyles],
      { concurrency: "unbounded" },
    );
    const pick = yield* awaitModal<ProfilePick | undefined>((resolve) =>
      openLiteratureNoteProfile(
        ports.app,
        {
          previews: plan.profiles,
          preselected: plan.current.selector,
          current: plan.current.selector,
          styles,
        },
        resolve,
      ),
    );
    const { choice, created } = yield* settleProfilePick(ports, pick, {
      indexedKey,
      useForNote: true,
    });
    if (!choice || choice.id === plan.current.selector) {
      yield* Effect.logDebug("Profile switch dismissed without a change").pipe(
        Effect.annotateLogs({ path: file.path }),
        logged,
      );
      return;
    }
    // A Profile made in the picker joins the plan's targets.
    if (created) plan = yield* noteFeature.prepareProfileSwitch(file);
    const target = plan.profiles.find(
      ({ selector }) => selector === choice.id,
    )!;
    const consent = yield* awaitProfileSwitchConsent(ports.app, {
      current: plan.current.label ?? m.settings_profile_default_name(),
      requested: choice.label,
      moveFolder:
        target.path === file.path
          ? undefined
          : target.path === undefined
            ? target.folder
            : dirname(target.path),
      importedCount: plan.importedNotes?.length ?? null,
      imported: plan.imported,
    });
    if (!consent.confirmed) {
      yield* Effect.logDebug("Cancelled Literature Note Profile switch").pipe(
        Effect.annotateLogs({ path: file.path }),
        logged,
      );
      return;
    }
    // The notice tells the user how the switch went.
    yield* withProgress(
      noteFeature.switchNoteProfile(file, {
        profile: choice.id,
        move: consent.move,
        importedNotes: consent.importedNotes ? (plan.importedNotes ?? []) : [],
      }),
      {
        loading: m.notice_profile_switching(),
        success: (result) =>
          result.diagnostic
            ? noteOperationDiagnosticContent(ports.app, result.diagnostic)
            : m.notice_profile_switched({ label: choice.label }),
        error: m.notice_profile_switch_failed(),
      },
    ).pipe(recover(() => Effect.void, Effect.void));
  }).pipe(
    recover(
      (cause) =>
        Effect.logError(
          "Failed to prepare Literature Note Profile switch",
        ).pipe(
          Effect.annotateLogs({ path: file.path, error: Cause.squash(cause) }),
          logged,
        ),
      notifier.show(m.notice_profile_switch_failed()).pipe(Effect.asVoid),
    ),
  );
});

/**
 * All consequences and opt-ins are visible before any note is changed.
 *
 * @returns The user's consent; an interrupt closes the dialog.
 */
export function awaitProfileSwitchConsent(
  app: App,
  options: {
    current: string;
    requested: string;
    moveFolder?: string;
    importedCount: number | null;
    imported?: boolean;
  },
): Effect.Effect<ProfileSwitchConsent> {
  return awaitModal<ProfileSwitchConsent>((resolve) => {
    const modal = new ConfirmationModal(app);
    modal.contentEl.addClass("zt-root");
    let move = false;
    let importedNotes = false;
    modal.setTitle(m.modal_profile_switch_title({ label: options.requested }));
    const content = `${m.modal_profile_switch_desc(options)} ${options.imported ? m.modal_profile_switch_imported_effects() : m.modal_profile_switch_effects()}`;
    modal.setContent(
      !options.imported && options.importedCount === null
        ? `${content}\n\n${m.modal_profile_switch_imported_unavailable()}`
        : content,
    );
    if (options.moveFolder !== undefined) {
      const folder = normalizeFolderPath(options.moveFolder);
      modal.addCheckbox(
        m.modal_profile_switch_move({
          folder: folder === "/" ? "/" : `${folder}/`,
        }),
        (checked) => {
          move = checked;
        },
      );
    }
    if (!options.imported && options.importedCount !== null)
      modal.addCheckbox(
        m.modal_profile_switch_imported_notes({ count: options.importedCount }),
        (checked) => {
          importedNotes = checked;
        },
      );
    modal.addButton((button) => {
      button
        .setButtonText(
          m.modal_profile_switch_confirm({ label: options.requested }),
        )
        .setCta()
        .onClick(() => resolve({ confirmed: true, move, importedNotes }));
    });
    modal.addCancelButton(m.modal_cancel());
    modal.setCloseCallback(() =>
      resolve({ confirmed: false, move: false, importedNotes: false }),
    );
    modal.open();
    return modal;
  });
}
