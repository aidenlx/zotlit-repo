import type { InteractiveCreationPorts } from "#desktop/note-feature/creation-view.ts";
import type { TemplateDataServices } from "#desktop/template/data.ts";
import type { ResolvedProfile } from "#obsidian/profile/bindings.ts";
import type {
  LiteratureNoteProfile,
  PreparedProfileCreation,
  PreparedProfileImport,
  ProfileCreation,
  ProfileImport,
  ProfileShare,
} from "#obsidian/profile/service.ts";
import type { ShareDestination } from "#obsidian/profile/share-profile-modal.ts";
import { Cause, Effect, Exit, FiberSet, FileSystem } from "effect";
import { basename } from "node:path";
import type { App } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";
import { requireDialog } from "@zotlit/obsidian-desktop/require.ts";
import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import type { ClosableModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { portCall } from "@zotlit/obsidian-kit/legacy-port.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { UserCancelled } from "@zotlit/plugin-kernel/user-cancel.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";

import type {
  CreatedProfile,
  CreateProfileOptions,
  ProfileCreationData,
} from "./create-profile-modal.ts";
import { CreateProfileModal } from "./create-profile-modal.ts";
import type { ImportSource } from "./import-profile-modal.ts";
import {
  ImportProfileModal,
  ImportSourceModal,
} from "./import-profile-modal.ts";

import { installedStyles } from "#desktop/note-feature/creation-view.ts";
import { NoteFeature } from "#desktop/note-feature/service.ts";
import { readTemplateData } from "#desktop/template/data.ts";
import { readMigrationVerificationData } from "#desktop/template/migration-data.ts";
import { ProfileDestinationModal } from "#obsidian/profile/profile-destination-modal.ts";
import {
  Profile,
  ProfileDocumentMissingError,
  ProfileOperationError,
} from "#obsidian/profile/service.ts";
import { ShareProfileModal } from "#obsidian/profile/share-profile-modal.ts";
import { Template } from "#obsidian/template/service.ts";
import { TemplateWorkbenchLauncher } from "#obsidian/template/workbench-launcher.ts";

export type ProfileDialogServices =
  | Profile
  | Template
  | NoteFeature
  | Notifier
  | Vault
  | ZoteroPref
  | TemplateDataServices
  | LibraryScope
  | FileSystem.FileSystem;

export type CreateProfileDialog = (
  options?: CreateProfileOptions,
) => Effect.Effect<
  CreatedProfile | undefined,
  Effect.Error<ReturnType<typeof createProfileDialog>>,
  ProfileDialogServices
>;

export type ImportProfileDialog = (options?: {
  indexedKey?: string;
  source?: ImportSource;
}) => Effect.Effect<
  LiteratureNoteProfile | undefined,
  never,
  ProfileDialogServices
>;

type DialogServices = Profile | Template | NoteFeature;

type DialogRun<R = DialogServices> = <A, E>(
  effect: Effect.Effect<A, E, R>,
) => Promise<A>;

interface DialogModal<A> extends ClosableModal {
  open(): void;
  readonly result: Promise<A>;
  teardown?(): void;
}

function runDialog<A, R = DialogServices>(
  open: (run: DialogRun<R>) => DialogModal<A>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const runFork = yield* FiberSet.runtime(yield* FiberSet.make())<R>();
      let answered = false;
      const run: DialogRun<R> = (effect) =>
        new Promise((resolve, reject) =>
          runFork(effect).addObserver((exit) => {
            if (Exit.isSuccess(exit)) resolve(exit.value);
            else if (!Cause.hasInterruptsOnly(exit.cause)) {
              const failure = Cause.squash(exit.cause);
              reject(
                failure instanceof Error
                  ? failure
                  : new Error(String(failure), { cause: failure }),
              );
            } else if (answered) reject(new UserCancelled());
            else reject(new AbortError());
          }),
        );
      const answer = yield* awaitModal<A>((settle) => {
        const modal = open(run);
        void modal.result.then(settle);
        modal.open();
        return {
          close: () => (modal.teardown ? modal.teardown() : modal.close()),
        };
      });
      answered = true;
      return answer;
    }),
  );
}

const readImportSource = Effect.fn("readImportSource")(function* (
  app: App,
  source: ImportSource | undefined,
) {
  const notifier = yield* Notifier;
  const kind =
    source ??
    (yield* awaitModal<ImportSource | undefined>((settle) => {
      const picker = new ImportSourceModal(app);
      void picker.result.then(settle);
      picker.open();
      return picker;
    }));
  if (kind === undefined) return undefined;
  const text = yield* (
    kind === "clipboard"
      ? portCall("read-clipboard", () => navigator.clipboard.readText())
      : readProfileFile
  ).pipe(
    recover(
      (cause) =>
        Effect.logError("Failed to read Profile import source", cause).pipe(
          Effect.annotateLogs({ source: kind }),
          Effect.andThen(notifier.show(m.profile_import_read_failed())),
          Effect.asVoid,
        ),
      Effect.succeed(null),
    ),
  );
  if (text === null) return undefined;
  if (!text.trim()) {
    yield* notifier.show(m.profile_import_empty());
    return undefined;
  }
  return text;
});

const readProfileFile = Effect.gen(function* () {
  const selection = yield* portCall("choose-profile-file", () =>
    requireDialog().showOpenDialog({
      title: m.profile_import_file(),
      properties: ["openFile"],
      filters: [{ name: "Markdown", extensions: ["md"] }],
    }),
  );
  const path = selection.canceled ? undefined : selection.filePaths[0];
  if (!path) return null;
  return yield* (yield* FileSystem.FileSystem).readFileString(path);
});

const defaultProfile = Effect.gen(function* () {
  const base = yield* (yield* Profile).resolveProfile("default");
  if (!base)
    return yield* new ProfileOperationError({
      message: m.notice_profile_action_failed(),
      cause: undefined,
    });
  return base;
});

const previewData = (indexedKey: string | undefined) =>
  Effect.gen(function* () {
    if (!indexedKey) {
      const data = yield* readMigrationVerificationData({ annotation: false });
      return data
        ? { note: data.note as NoteTemplateContext, filename: data.filename }
        : null;
    }
    const [note, filename] = yield* Effect.all(
      [
        readTemplateData(indexedKey, "note"),
        readTemplateData(indexedKey, "filename"),
      ],
      { concurrency: "unbounded" },
    );
    return note.kind === "data" && filename.kind === "data"
      ? { note: note.data as NoteTemplateContext, filename: filename.data }
      : null;
  }).pipe(
    recover(
      (cause) =>
        Effect.logWarning("Profile preview data is unavailable", cause).pipe(
          Effect.annotateLogs({ indexedKey }),
        ),
      Effect.succeed<ProfileCreationData | null>(null),
    ),
  );

const previewNote = (
  data: ProfileCreationData,
  profile: ResolvedProfile,
  source: string,
) =>
  Effect.gen(function* () {
    const document =
      yield* (yield* Template).prepareLiteratureNoteTemplateSource(source);
    return yield* (yield* NoteFeature).prepareProfileNote({
      profile,
      document,
      ...data,
    });
  });

const creationOn = (
  plan: ProfileCreation,
  run: DialogRun,
): PreparedProfileCreation => ({ ...plan, create: () => run(plan.create()) });

export const createProfileDialog = Effect.fn("createProfileDialog")(function* (
  app: App,
  options: CreateProfileOptions = {},
) {
  const profile = yield* Profile;
  const [data, styles, base, profiles] = yield* Effect.all(
    [
      previewData(options.indexedKey),
      installedStyles,
      defaultProfile,
      profile.profiles,
    ],
    { concurrency: "unbounded" },
  );
  const created = yield* runDialog<CreatedProfile | undefined>(
    (run) =>
      new CreateProfileModal(
        {
          app,
          base,
          profiles,
          prepareCreate: (create) =>
            run(
              profile
                .prepareCreate(create)
                .pipe(Effect.map((plan) => creationOn(plan, run))),
            ),
          previewNote: data
            ? (draft, source) => run(previewNote(data, draft, source))
            : undefined,
        },
        { ...options, styles },
      ),
  );
  if (created && !options.useForNote)
    yield* (yield* Notifier).show(
      m.notice_profile_created({ label: created.profile.label }),
    );
  return created;
});

export const importProfileDialog = Effect.fn("importProfileDialog")(
  function* (
    app: App,
    options: { indexedKey?: string; source?: ImportSource } = {},
  ) {
    const notifier = yield* Notifier;
    const source = yield* readImportSource(app, options.source);
    if (source === undefined) return undefined;
    const profile = yield* Profile;
    const plan = yield* profile
      .prepareImport(source, {})
      .pipe(
        Effect.catchTag("ProfileOperationError", (error) =>
          Effect.logDebug("Refused Profile import source", error).pipe(
            Effect.andThen(
              notifier.show(error.message || m.profile_import_invalid()),
            ),
            Effect.as(undefined),
          ),
        ),
      );
    if (!plan) return undefined;
    const [data, styles] =
      plan.kind === "replace"
        ? [null, []]
        : yield* Effect.all(
            [previewData(options.indexedKey), installedStyles],
            { concurrency: "unbounded" },
          );
    const base = yield* defaultProfile;
    const runSync = Effect.runSyncWith(yield* Effect.context<never>());
    const importOn = (
      plan: ProfileImport,
      run: DialogRun,
    ): PreparedProfileImport => ({
      ...plan,
      previewSource: (preview) => runSync(plan.previewSource(preview)),
      import: (choice) => run(plan.import(choice)),
    });
    return yield* runDialog(
      (run) =>
        new ImportProfileModal(
          {
            app,
            base,
            prepareImport: (text, choice) =>
              run(
                profile
                  .prepareImport(text, choice)
                  .pipe(Effect.map((next) => importOn(next, run))),
              ),
            previewNote: data
              ? (draft, text) => run(previewNote(data, draft, text))
              : undefined,
          },
          { source, plan: importOn(plan, run), styles },
        ),
    );
  },
  (effect) =>
    Notifier.use((notifier) =>
      effect.pipe(
        recover(
          (cause) =>
            Effect.logError("Failed to open Profile import", cause).pipe(
              Effect.andThen(notifier.show(m.notice_profile_action_failed())),
              Effect.asVoid,
            ),
          Effect.undefined,
        ),
      ),
    ),
);

export const addProfileDestination = Effect.fn("addProfileDestination")(
  function* (app: App) {
    const profile = yield* Profile;
    const base = yield* defaultProfile;
    const created = yield* runDialog(
      (run) =>
        new ProfileDestinationModal({
          app,
          defaultFolder: base.bindings["note.literature-folder"],
          prepareCreate: (create) =>
            run(
              profile
                .prepareCreate(create)
                .pipe(Effect.map((plan) => creationOn(plan, run))),
            ),
        }),
    );
    if (!created) return;
    yield* (yield* PluginHost).closeSettings;
    const file = yield* (yield* Vault).getFileByPath(created.path);
    if (!file)
      return yield* new ProfileDocumentMissingError({
        profileId: created.id,
        message: m.notice_profile_action_failed(),
      });
    yield* (yield* TemplateWorkbenchLauncher).open(file, { tab: "name" });
    yield* (yield* Notifier).show(
      m.notice_profile_created({ label: created.label }),
    );
  },
);

const shareOutput = Effect.fn("shareOutput")(
  function* (
    destination: ShareDestination,
    source: string,
    plan: Pick<ProfileShare, "filename" | "manifest">,
  ) {
    const notifier = yield* Notifier;
    if (destination === "clipboard") {
      yield* portCall("write-clipboard", () =>
        navigator.clipboard.writeText(source),
      );
      yield* notifier.show(m.profile_share_copied());
    } else {
      const selection = yield* portCall("choose-share-file", () =>
        requireDialog().showSaveDialog({
          title: m.profile_share_save(),
          defaultPath: plan.filename,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        }),
      );
      const path = selection.canceled ? undefined : selection.filePath;
      if (!path) return;
      yield* (yield* FileSystem.FileSystem).writeFileString(path, source);
      yield* notifier.show(m.profile_share_saved({ file: basename(path) }));
    }
    yield* Effect.logDebug("Shared Profile").pipe(
      Effect.annotateLogs({ id: plan.manifest.id }),
    );
  },
  (effect, destination) =>
    Notifier.use((notifier) =>
      effect.pipe(
        Effect.annotateLogs({ destination }),
        recover(
          (cause) =>
            Effect.logError("Failed to share Profile", cause).pipe(
              Effect.andThen(notifier.show(m.profile_share_failed())),
              Effect.asVoid,
            ),
          Effect.void,
        ),
      ),
    ),
);

export const shareProfile = Effect.fn("shareProfile")(function* (
  app: App,
  selector: ProfileSelector,
) {
  const plan = yield* (yield* Profile).prepareShare(selector);
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  yield* runDialog<void, Notifier | FileSystem.FileSystem>(
    (run) =>
      new ShareProfileModal(
        app,
        { ...plan, render: (options) => runSync(plan.render(options)) },
        (destination, source) => run(shareOutput(destination, source, plan)),
      ),
  );
});

export function interactiveCreation(app: App): InteractiveCreationPorts {
  return {
    app,
    createProfile: (options) => createProfileDialog(app, options),
    importProfile: (options) => importProfileDialog(app, options),
  };
}
