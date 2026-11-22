import type {
  CreateProfileDialog,
  ImportProfileDialog,
} from "#desktop/profile/dialogs.ts";
import type {
  LiteratureNoteProfileChoice,
  ProfilePick,
} from "#desktop/profile/profile-picker.ts";
import { Effect } from "effect";
import type { App, TFile } from "obsidian";

import { listInstalledStyles } from "@zotlit/citations/desktop/pandoc/installed-styles.ts";
import type { Item } from "@zotlit/db";
import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import type {
  CreateNoteResult,
  CreationProfileSelection,
  CreationProfileSources,
  CreationSelectionProblem,
} from "./operations.ts";
import { describeSelectionProblem } from "./selection-copy.ts";
import { NoteFeature } from "./service.ts";
import { createWithNotice } from "./update-single.ts";

import { openLiteratureNoteProfile } from "#desktop/profile/profile-picker.ts";

const logged = withLogCategory("note-feature");

export interface InteractiveCreationPorts {
  readonly app: App;
  readonly createProfile: CreateProfileDialog;
  readonly importProfile: ImportProfileDialog;
}

export interface InteractiveCreationOptions extends CreationProfileSources {
  direct?: boolean;
}

export const installedStyles = Effect.gen(function* () {
  const { dataDir } = yield* (yield* ZoteroPref).current;
  if (!dataDir) return [];
  return yield* listInstalledStyles(dataDir).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.as(
        Effect.logWarning("Cannot read the installed CSL styles", error).pipe(
          logged,
        ),
        [],
      ),
    ),
  );
});

export const resolveProfilePick = Effect.fnUntraced(function* (
  ports: Pick<InteractiveCreationPorts, "createProfile" | "importProfile">,
  pick: ProfilePick | undefined,
  options: { indexedKey: string | undefined; useForNote: boolean },
) {
  if (!pick || !("action" in pick))
    return { choice: pick, created: undefined, failed: false } as const;
  if (pick.action === "import") {
    yield* ports.importProfile({ indexedKey: options.indexedKey });
    return { choice: undefined, created: undefined, failed: false } as const;
  }
  const created = yield* ports.createProfile(options).pipe(
    Effect.map((created) => ({ created, failed: false })),
    recover(
      (cause) => Effect.logError("Failed to open Profile creation", cause),
      Effect.succeed({ created: undefined, failed: true }),
    ),
  );
  const choice: LiteratureNoteProfileChoice | undefined = created.created && {
    id: created.created.profile.id,
    label: created.created.profile.label,
  };
  return { choice, created: created.created, failed: created.failed } as const;
});

export function profilePickNotice(settled: {
  failed: boolean;
}): string | undefined {
  return settled.failed ? m.notice_profile_action_failed() : undefined;
}

export const settleProfilePick = Effect.fnUntraced(function* (
  ports: Pick<InteractiveCreationPorts, "createProfile" | "importProfile">,
  pick: ProfilePick | undefined,
  options: { indexedKey: string | undefined; useForNote: boolean },
) {
  const settled = yield* resolveProfilePick(ports, pick, options);
  const notice = profilePickNotice(settled);
  if (notice) yield* (yield* Notifier).show(notice);
  return settled;
});

export interface CreatedUnder {
  readonly label?: string;
  readonly reason?: string;
}

export interface InteractiveCreation {
  readonly file: TFile;
  readonly under?: CreatedUnder;
}

export const createThroughSelection = Effect.fn("createThroughSelection")(
  function* (
    ports: InteractiveCreationPorts,
    item: Item,
    { direct = false, ...sources }: InteractiveCreationOptions = {},
  ) {
    const noteFeature = yield* NoteFeature;
    const [plans, styles] = yield* Effect.all(
      [noteFeature.planCreations([item.indexedKey], sources), installedStyles],
      { concurrency: "unbounded" },
    );
    const { selection, previews } = plans.get(item.indexedKey)!;
    if (!selection.shouldAsk && selection.source === "bound") {
      const file = yield* createWithNotice(
        noteFeature.createNote(item, { profile: selection.selector }),
        { app: ports.app },
      );
      const created: InteractiveCreation | null = file && { file };
      return created;
    }

    let problem = selection.problem;
    if (
      (!selection.shouldAsk || direct) &&
      selection.source !== "bound" &&
      !problem
    ) {
      const preview = previews.find(
        ({ selector }) => selector === selection.selector,
      );
      if (preview && !preview.unavailable) {
        yield* Effect.logDebug(
          "Creating Literature Note from a resolved Profile",
        ).pipe(
          Effect.annotateLogs({
            indexedKey: item.indexedKey,
            selector: selection.selector,
            source: selection.source,
            path: preview.path,
          }),
          logged,
        );
        return yield* createPrepared(
          preview.create(),
          { label: preview.label, reason: selection.reason },
          ports.app,
        );
      }
      problem = unavailableSelection(selection);
    }
    const pick = yield* awaitModal<ProfilePick | undefined>((resolve) =>
      openLiteratureNoteProfile(
        ports.app,
        {
          preselected: selection.selector,
          source: selection.source,
          reason: selection.reason,
          candidates:
            problem?.kind === "overlap"
              ? problem.candidates.map(({ id }) => id)
              : undefined,
          problem: problem && describeSelectionProblem(problem),
          previews,
          styles,
        },
        resolve,
      ),
    );
    const { choice, created } = yield* settleProfilePick(ports, pick, {
      indexedKey: item.indexedKey,
      useForNote: true,
    });
    if (!choice) {
      yield* Effect.logDebug(
        "Cancelled Literature Note Profile selection",
      ).pipe(Effect.annotateLogs({ indexedKey: item.indexedKey }), logged);
      return null;
    }
    yield* Effect.logDebug("Confirmed Literature Note Profile selection").pipe(
      Effect.annotateLogs({ indexedKey: item.indexedKey, selector: choice.id }),
      logged,
    );
    if (created) {
      const { preview, profile } = created;
      return yield* createPrepared(
        preview.create,
        { label: profile.label },
        ports.app,
      );
    }
    const chosen = previews.find(({ selector }) => selector === choice.id)!;
    return yield* createPrepared(
      chosen.create(),
      { label: chosen.label },
      ports.app,
    );
  },
);

export const createNoteInteractively = Effect.fn("createNoteInteractively")(
  function* (
    ports: InteractiveCreationPorts,
    item: Item,
    options?: InteractiveCreationOptions,
  ) {
    const created = yield* createThroughSelection(ports, item, options);
    return created?.file ?? null;
  },
);

const createPrepared = Effect.fnUntraced(function* <E, R>(
  create: Effect.Effect<CreateNoteResult, E, R>,
  under: CreatedUnder,
  app: App,
) {
  const file = yield* createWithNotice(create, {
    app,
    created: (file) => createdNoteNotice(file, under),
  });
  const created: InteractiveCreation | null = file && { file, under };
  return created;
});

export function createdNoteNotice(
  file: Pick<TFile, "path">,
  { label, reason }: CreatedUnder,
): string {
  return reason
    ? m.notice_created_note_from_match({ reason, path: file.path })
    : m.notice_created_note_under_profile({
        profile: label ?? m.settings_profile_default_name(),
        path: file.path,
      });
}

function unavailableSelection(
  selection: Exclude<CreationProfileSelection, { source: "bound" }>,
): CreationSelectionProblem {
  return { kind: "unavailable-profile", selector: selection.selector };
}
