// Welcome gestures run on the plugin's view registry; conversions belong to one banner.
import { Cause, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { requireDialog } from "@zotlit/obsidian-desktop/require.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { Release } from "@/services/release/service.ts";
import { PluginSettings } from "@/services/settings/service.ts";
import type { SettingsPatch } from "@/services/settings/service.ts";
import { TemplateMigration } from "@/services/template/migration.ts";
import type { LiteratureNoteTemplateMigrationResult } from "@/services/template/migration.ts";
import { ZoteroPref } from "@/services/zotero-pref/service.ts";

import { templateMigrationNotice } from "./migration-notice.ts";

/** A settings write also flushes, so an immediate reload keeps the gesture. */
export const keepWelcomeCommand = viewRuntime.fn(
  (patch: SettingsPatch) =>
    Effect.gen(function* () {
      const settings = yield* PluginSettings;
      yield* settings.update(patch);
      yield* settings.flush;
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (error) =>
          Effect.logWarning(
            "The Welcome View banner could not keep its state",
            {
              error,
            },
          ),
      ),
      withLogCategory("welcome", "banner"),
    ),
  { concurrent: true },
);

export const dismissWelcomeCommand = viewRuntime.fn(
  () =>
    Effect.gen(function* () {
      const release = yield* Release;
      yield* Effect.gen(function* () {
        yield* release.acknowledgeMigration;
        yield* release.acknowledgeUpdate;
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (error) =>
            Effect.logWarning(
              "The Welcome View banner could not acknowledge the release",
              { error },
            ),
        ),
      );
      const settings = yield* PluginSettings;
      yield* settings.update({
        "welcome.dismissed": true,
        "welcome.requested": false,
        "welcome.steps-shown": false,
      });
      yield* settings.flush;
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (error) =>
          Effect.logWarning(
            "The Welcome View banner could not keep its state",
            {
              error,
            },
          ),
      ),
      withLogCategory("welcome", "banner"),
    ),
  { concurrent: true },
);

export const openReleaseNoteCommand = viewRuntime.fn(() =>
  Effect.gen(function* () {
    const release = yield* Release;
    yield* Effect.all([release.openReleaseNote, release.acknowledgeUpdate], {
      concurrency: "unbounded",
    });
  }),
);

/**
 * One banner's template conversion. Its result is the atom's value, which
 * the banner reads; closing the banner interrupts the conversion before its
 * notice.
 */
export const makeConversionCommand = () =>
  Atom.setIdleTTL(
    viewRuntime.fn((request: { readonly retry: boolean }) =>
      Effect.gen(function* () {
        const migration = yield* TemplateMigration;
        const result = yield* request.retry
          ? migration.retryCleanup
          : migration.convert;
        yield* Notifier.use((notifier) =>
          notifier.show(templateMigrationNotice(result)),
        );
        return { retry: request.retry, result };
      }).pipe(
        Effect.tapCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (error) =>
            Effect.logWarning(
              "The Welcome View banner could not convert the templates",
              { error },
            ),
        ),
        withLogCategory("welcome", "banner"),
      ),
    ),
    // A closed banner stops the conversion at once, not after the registry's
    // idle delay; the conversion's own writes still finish.
    0,
  );

/** What one run of the conversion command answered. */
export interface ConversionRun {
  readonly retry: boolean;
  readonly result: LiteratureNoteTemplateMigrationResult;
}

export const setFolderCommand = viewRuntime.fn((path: string) =>
  PluginSettings.use((settings) =>
    settings.updateDefaultLiteratureNoteProfileBindings({
      "note.literature-folder": path,
    }),
  ),
);

export const locateZoteroCommand = viewRuntime.fn(() =>
  Effect.gen(function* () {
    const pref = yield* ZoteroPref;
    const current = yield* pref.current;
    const result = yield* Effect.tryPromise(() =>
      requireDialog().showOpenDialog({
        title: m.settings_db_data_dir_dialog_title(),
        defaultPath: current.dataDir,
        properties: ["openDirectory"],
      }),
    );
    if (!result.canceled && result.filePaths.length > 0)
      yield* pref.setDataDir(result.filePaths[0]!);
  }).pipe(
    Effect.catchCauseIf(
      (cause) => !Cause.hasInterruptsOnly(cause),
      (error) =>
        Effect.logError("Failed to open Zotero data directory dialog", {
          error,
        }),
    ),
    withLogCategory("views", "welcome"),
  ),
);
