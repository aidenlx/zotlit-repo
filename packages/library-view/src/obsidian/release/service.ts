import { Cause, Context, Deferred, Effect, Layer } from "effect";
import { TFile } from "obsidian";

import { obsidianEvents } from "@zotlit/obsidian-kit/effect-obsidian-events.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type {
  SettingsMutationError,
  SettingsPatch,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { releaseNoteUrl, V1_TEMPLATE_FOLDER } from "./constants.ts";
import { decideRelease } from "./decide.ts";
import type { ReleaseDecision } from "./decide.ts";
import { companionNotice, showCompanionNotice } from "./notices.ts";

const WEBVIEWER_PLUGIN_ID = "webviewer";
const WEBVIEWER_VIEW_TYPE = "webviewer";

const V1_EJECTED_TEMPLATE = /^zt-.+\.eta\.md$/i;

export class Release extends Context.Service<
  Release,
  {
    readonly version: string;
    readonly checked: Effect.Effect<void>;
    readonly openReleaseNote: Effect.Effect<void>;
    readonly acknowledgeMigration: Effect.Effect<void, SettingsMutationError>;
    readonly acknowledgeUpdate: Effect.Effect<void, SettingsMutationError>;
    hasV1Templates(folderPath: string): Effect.Effect<boolean>;
  }
>()("zotlit/release/Release") {}

export function layerRelease(options: {
  readonly version: string;
  readonly openFirstScreen?: () => void | Promise<void>;
}): Layer.Layer<
  Release,
  never,
  ObsidianApp | Vault | Workspace | Notifier | PluginSettings
> {
  return Layer.effect(
    Release,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      const vault = yield* Vault;
      const workspace = yield* Workspace;
      const settings = yield* PluginSettings;
      const checked = yield* Deferred.make<void>();
      const events = yield* obsidianEvents<{ layoutReady: [] }>();
      const bridge = yield* scopedBridge;
      let stopped = false;

      const hasV1Templates = (folderPath: string): Effect.Effect<boolean> =>
        Effect.map(
          vault.getFolderByPath(folderPath),
          (folder) =>
            folder?.children.some(
              (child) =>
                child instanceof TFile && V1_EJECTED_TEMPLATE.test(child.name),
            ) ?? false,
        );

      const openReleaseNote = Effect.gen(function* () {
        const url = releaseNoteUrl(options.version);
        const { workspace } = app;
        if (!app.internalPlugins.getEnabledPluginById(WEBVIEWER_PLUGIN_ID)) {
          window.open(url);
          yield* Effect.logInfo("Opened Release Note").pipe(
            Effect.annotateLogs({ url, target: "system-browser" }),
          );
          return;
        }
        const leaf =
          workspace.getLeavesOfType(WEBVIEWER_VIEW_TYPE)[0] ??
          workspace.getLeaf("tab");
        yield* Effect.promise(async () => {
          await leaf.setViewState({
            type: WEBVIEWER_VIEW_TYPE,
            active: true,
            state: { url },
          });
          void workspace.revealLeaf(leaf);
        });
        yield* Effect.logInfo("Opened Release Note").pipe(
          Effect.annotateLogs({ url, target: "web-viewer" }),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Cannot open the release note").pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
          ),
        ),
        Effect.withSpan("Release.openReleaseNote"),
      );

      const acknowledgeMigration = Effect.gen(function* () {
        const current = yield* settings.current;
        if (current["release.migration-pending"] !== true) return;
        yield* settings.update({ "release.migration-pending": false });
        yield* Effect.logInfo("Migration Prompt acknowledged");
      }).pipe(Effect.withSpan("Release.acknowledgeMigration"));

      const acknowledgeUpdate = Effect.gen(function* () {
        const current = yield* settings.current;
        if (current["release.update-pending"] !== true) return;
        yield* settings.update({ "release.update-pending": false });
        yield* Effect.logInfo("Update acknowledged").pipe(
          Effect.annotateLogs({ version: options.version }),
        );
      }).pipe(Effect.withSpan("Release.acknowledgeUpdate"));

      const recordState = Effect.fn("Release.recordState")(function* (
        current: Readonly<Settings>,
        decision: ReleaseDecision,
      ) {
        const patch: SettingsPatch = {};
        if (current["release.previous-version"] !== decision.recordVersion) {
          patch["release.previous-version"] = decision.recordVersion;
        }
        if (
          decision.setMigrationPending !== undefined &&
          current["release.migration-pending"] !== decision.setMigrationPending
        ) {
          patch["release.migration-pending"] = decision.setMigrationPending;
        }
        if (
          decision.setUpdatePending !== undefined &&
          current["release.update-pending"] !== decision.setUpdatePending
        ) {
          patch["release.update-pending"] = decision.setUpdatePending;
        }
        if (
          decision.setTemplateFolder !== undefined &&
          current["template.folder"] !== decision.setTemplateFolder
        ) {
          patch["template.folder"] = decision.setTemplateFolder;
        }
        if (Object.keys(patch).length > 0) yield* settings.update(patch);
      });

      const runCheck = Effect.fn("Release.runCheck")(function* () {
        const current = yield* settings.current;
        if (stopped) return;

        const origin = (yield* settings.hydrationOrigin) ?? "current";
        const migrationPending = current["release.migration-pending"];
        const legacyTemplatesPresent =
          origin === "absent"
            ? yield* hasV1Templates(V1_TEMPLATE_FOLDER)
            : migrationPending
              ? yield* hasV1Templates(current["template.folder"])
              : false;

        const decision = decideRelease({
          origin,
          recordedVersion: current["release.previous-version"],
          currentVersion: options.version,
          migrationPending,
          noticesEnabled: current["release.notices-enabled"],
          legacyTemplatesPresent,
        });

        yield* recordState(current, decision);

        yield* Effect.logInfo("Release check complete").pipe(
          Effect.annotateLogs({
            branch: decision.branch,
            legacyTemplatesPresent,
          }),
        );
        switch (decision.branch) {
          case "companion-notice":
            yield* showCompanionNotice(
              companionNotice({
                openReleaseNote: () => bridge.runAndForget(openReleaseNote),
              }),
            );
            break;
          case "update":
          case "welcome-fresh":
          case "welcome-upgraded":
            yield* Effect.promise(async () => {
              await options.openFirstScreen?.();
            });
            break;
          case "none":
            break;
        }
      });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stopped = true;
        }).pipe(Effect.andThen(Deferred.succeed(checked, undefined))),
      );

      yield* workspace.layoutReady.pipe(
        Effect.andThen(Effect.sync(() => events.callback("layoutReady")())),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* events
        .consume(() =>
          runCheck().pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Release check failed").pipe(
                Effect.annotateLogs({ error: Cause.squash(cause) }),
              ),
            ),
            Effect.ensuring(Deferred.succeed(checked, undefined)),
          ),
        )
        .pipe(Effect.forkScoped({ startImmediately: true }));

      return Release.of({
        version: options.version,
        checked: Deferred.await(checked),
        openReleaseNote,
        acknowledgeMigration,
        acknowledgeUpdate,
        hasV1Templates,
      });
    }).pipe(withLogCategory("release")),
  );
}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    Release: Release;
  }
}
