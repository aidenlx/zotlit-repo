// The Template Workbench links: `obsidian://zotlit/explore`, which opens the
// Template Data Explorer on an Item, and `obsidian://zotlit/import-profile`,
// the web workbench's clipboard Profile handoff.
import { Cause, Effect, Result, Schema } from "effect";
import type { ObsidianProtocolData } from "obsidian";

import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/index.ts";
import { importProfileDialog } from "@zotlit/notes/desktop/profile/dialogs.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import {
  parseProtocolData,
  resolveProtocolItem,
} from "@zotlit/plugin-services/obsidian/protocol/link.ts";
import { protocolHandler } from "@zotlit/plugin-shell/obsidian/feature.ts";
import {
  exploreProtocolActionId,
  importProfileProtocolActionId,
  parseExploreProtocolQuery,
  parseImportProfileProtocolQuery,
} from "@zotlit/protocol";

import { showWorkbenchLinkOutcome } from "./notices.ts";
import { WorkbenchLinkOutcome } from "./outcome.ts";

import { openTemplateDataExplorer } from "#desktop/data-explorer/register.ts";
import { explainWorkbenchOpen } from "#desktop/editor/actions.ts";
import { openTemplateWorkbench } from "#desktop/view/open.ts";

/** How a clipboard Profile handoff imports: the importer's own dialog. */
export type ProfileImport = InteractiveCreationPorts["importProfile"];

/**
 * The Template Workbench links. The clipboard Profile handoff stands only in
 * a build with the web workbench (`webWorkbenchEnabled`); it imports through
 * `importProfile`, by default the Profile import dialog over the App.
 */
export function workbenchLinks({
  webWorkbenchEnabled,
  importProfile,
}: {
  readonly webWorkbenchEnabled: boolean;
  readonly importProfile?: ProfileImport;
}) {
  const link = <R>(
    action: string,
    handle: (
      data: ObsidianProtocolData,
    ) => Effect.Effect<WorkbenchLinkOutcome, unknown, R>,
  ) =>
    protocolHandler(action, (data) =>
      handle(data).pipe(Effect.tap(showWorkbenchLinkOutcome)),
    );
  return [
    link(exploreProtocolActionId, handleExploreProtocol),
    ...(webWorkbenchEnabled
      ? [
          link(importProfileProtocolActionId, (data) =>
            importProfile
              ? handleProfileImportProtocol(data, importProfile)
              : Effect.flatMap(ObsidianApp, (app) =>
                  handleProfileImportProtocol(data, (options) =>
                    importProfileDialog(app, options),
                  ),
                ),
          ),
        ]
      : []),
  ];
}

const handleExploreProtocol = Effect.fn("protocol.handleExploreProtocol")(
  function* (data: ObsidianProtocolData) {
    const action = "explore";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseExploreProtocolQuery,
    });
    if (Result.isFailure(query)) return query.failure;

    const ref = yield* resolveProtocolItem(query.success, action);
    if (Result.isFailure(ref)) return ref.failure;

    yield* openTemplateDataExplorer(
      {
        itemIndexedKey: ref.success.indexedKey,
        anchorAnnotationKey: query.success.annotation,
      },
      { paneType: query.success.paneType },
    );
    return WorkbenchLinkOutcome.Opened();
  },
);

/** Reuses the importer's clipboard reader and consent before opening the written file. */
const handleProfileImportProtocol = Effect.fn(
  "protocol.handleProfileImportProtocol",
)(function* (data: ObsidianProtocolData, importProfile: ProfileImport) {
  const query = yield* Effect.try(() =>
    parseImportProfileProtocolQuery(data),
  ).pipe(
    Effect.catch((error) =>
      Effect.logDebug("Refused clipboard Profile handoff").pipe(
        Effect.annotateLogs({ error: error.cause }),
        Effect.as(null),
      ),
    ),
  );
  if (!query) return WorkbenchLinkOutcome.InvalidLink();
  // A failure or a defect ends as ProfileImportFailed; an interrupt (unload)
  // passes through.
  return yield* openImportedProfile(importProfile).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logError("Failed to open clipboard Profile handoff").pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
            Effect.as(WorkbenchLinkOutcome.ProfileImportFailed()),
          ),
    ),
  );
}, withLogCategory("protocol"));

/** The Profile document the import wrote is not in the vault. */
class ImportedProfileMissing extends Schema.TaggedError<
  ImportedProfileMissing,
  { readonly brand: unique symbol }
>()("ImportedProfileMissing", {
  path: Schema.String,
}) {
  override get message() {
    return `Imported Profile document is unavailable: ${this.path}`;
  }
}

/** Import a Profile from the clipboard and open it in the workbench. */
const openImportedProfile = Effect.fn("protocol.openImportedProfile")(
  function* (importProfile: ProfileImport) {
    yield* Effect.logDebug("Opening clipboard Profile import");
    const profile = yield* importProfile({ source: "clipboard" });
    if (!profile) {
      yield* Effect.logDebug(
        "Clipboard Profile import ended without a document",
      );
      return WorkbenchLinkOutcome.ProfileImportCancelled();
    }
    const file = yield* (yield* Vault).getFileByPath(profile.path);
    if (!file) return yield* new ImportedProfileMissing({ path: profile.path });
    // The Workbench opens in its own window, whatever pane the link names.
    yield* explainWorkbenchOpen(yield* openTemplateWorkbench(file));
    yield* Effect.logDebug("Opened imported Profile in editor").pipe(
      Effect.annotateLogs({ path: profile.path }),
    );
    return WorkbenchLinkOutcome.ProfileOpened();
  },
);
