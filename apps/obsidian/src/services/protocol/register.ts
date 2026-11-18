import {
  Cause,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  PubSub,
  Result,
  Schema,
  Stream,
} from "effect";
import type { ObsidianProtocolData, PaneType, Plugin } from "obsidian";

import { toObsidianOpenable } from "@zotlit/annotations/core/attachment-open/openable.ts";
import type { ObsidianOpenableAttachment } from "@zotlit/annotations/core/attachment-open/resolve.ts";
import {
  openGesture,
  pdfPickerReader,
} from "@zotlit/annotations/desktop/attachment-open/actions.ts";
import {
  openAttachments,
  withFixedPane,
} from "@zotlit/annotations/desktop/attachment-open/open-attachments.ts";
import type { AttachmentReader } from "@zotlit/annotations/desktop/attachment-open/open-attachments.ts";
import { TargetOpener } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import type { ItemRef } from "@zotlit/db";
import { openCompanionNote } from "@zotlit/notes/desktop/note-feature/index.ts";
import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/index.ts";
import {
  runBatchUpdate,
  runBatchUpdateAll,
} from "@zotlit/notes/desktop/note-feature/update-batch.ts";
import type {
  BatchUpdateOptions,
  BatchUpdatePorts,
  BatchUpdateServices,
} from "@zotlit/notes/desktop/note-feature/update-batch.ts";
import { batchUpdateNotices } from "@zotlit/notes/desktop/note-feature/update-single.ts";
import {
  runBatchImport,
  runBatchImportAll,
} from "@zotlit/notes/desktop/note-import/batch-import.ts";
import type {
  BatchImportPorts,
  BatchImportServices,
} from "@zotlit/notes/desktop/note-import/batch-import.ts";
import type { NoteImportView } from "@zotlit/notes/desktop/note-import/view.ts";
import type { ProfileDialogServices } from "@zotlit/notes/desktop/profile/dialogs.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { parseProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import {
  logAndContinue,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type {
  ImportNotesRequest,
  UpdateManyRequest,
} from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import {
  batchProtocolActionId,
  exploreProtocolActionId,
  importAllNotesProtocolActionId,
  importManyProtocolActionId,
  importProtocolActionId,
  importProfileProtocolActionId,
  openAttachmentProtocolActionId,
  parseImportProfileProtocolQuery,
  parseExploreProtocolQuery,
  parseImportAllNotesProtocolQuery,
  parseImportManyProtocolQuery,
  parseImportProtocolQuery,
  parseOpenAttachmentProtocolQuery,
  parseProtocolBatchQuery,
  parseProtocolQuery,
  parseShowInLibraryProtocolQuery,
  parseUpdateAllProtocolQuery,
  protocolActionId,
  protocolActions,
  protocolSourceMatches,
  showInLibraryProtocolActionId,
  updateAllProtocolActionId,
} from "@zotlit/protocol";
import type { ImportMode, ProtocolAction } from "@zotlit/protocol";
import { openTemplateDataExplorer } from "@zotlit/template-workbench/desktop/data-explorer/register.ts";
import { explainWorkbenchOpen } from "@zotlit/template-workbench/desktop/editor/actions.ts";
import { openTemplateWorkbench } from "@zotlit/template-workbench/desktop/view/open.ts";
import { readDisplayRef } from "@zotlit/zotero-reads/client/display-ref.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { showProtocolOutcome } from "./notices.ts";
import { ProtocolOutcome } from "./outcome.ts";

/** The services a protocol handler reads through their tags. */
export type ProtocolServices =
  | BatchImportServices
  | BatchUpdateServices
  | LocalServer
  | Notifier
  | ObsidianEnv
  | ProfileDialogServices
  | ShowInLibrary
  | TargetOpener
  | UseLedger
  | Vault
  | Workspace
  | ZoteroPref
  | ZoteroReads;

/**
 * The legacy values the handlers still hold. The Profile dialogs run in the
 * handler's fiber; the note import view converts in a later slice.
 */
export interface ProtocolDeps extends InteractiveCreationPorts {
  webWorkbenchEnabled: boolean;
  /** The note import's classify, confirm and Profile modals. */
  noteImportView: NoteImportView;
  /**
   * Also runs the note import modal's callbacks and the Attachment picker's
   * opens, which unload interrupts.
   */
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit" | "runAndForget">;
}

/**
 * Register `obsidian://zotlit/{open,update}` plus the batch `update-many`
 * handler. Each link carries a `source-id` hash the handler validates before
 * delegating to the note-feature service.
 *
 * `update-many` is registered explicitly, outside the per-item loop, because it
 * decodes a different query shape (an item-id list) and routes to the batch
 * runner.
 *
 * Handlers auto-deregister when the plugin unloads. Each Obsidian callback
 * runs its handler with the services this Effect runs with, and a handler that
 * fails is logged. Every handler run and every run of a request the Local
 * Server pushes is a fiber of the current Scope: closing it stops the pushed
 * requests and interrupts the runs still going. A legacy Promise a run waits
 * on (a view opener) still runs to its end.
 */
export const registerProtocolHandlers = Effect.fn("registerProtocolHandlers")(
  function* (
    plugin: Pick<Plugin, "registerObsidianProtocolHandler">,
    deps: ProtocolDeps,
  ) {
    const runs = yield* FiberSet.make();
    const run = yield* FiberSet.runtime(runs)<ProtocolServices>();
    const register = (
      id: string,
      handle: (
        data: ObsidianProtocolData,
      ) => Effect.Effect<ProtocolOutcome, unknown, ProtocolServices>,
    ) =>
      // The callback returns the handler's fiber: Obsidian ignores it, and a
      // test joins it for the outcome.
      plugin.registerObsidianProtocolHandler(id, (data) =>
        run(
          handle(data).pipe(
            Effect.tap((outcome) => showProtocolOutcome(outcome, deps)),
            logAndContinue("Protocol handler failed", "protocol", {
              action: id,
            }),
          ),
        ),
      );

    for (const action of protocolActions)
      register(protocolActionId(action), (data) =>
        handleProtocol(action, data, deps),
      );
    register(batchProtocolActionId, (data) => handleBatchProtocol(data, deps));
    register(importProtocolActionId, (data) =>
      handleImportProtocol(data, deps),
    );
    register(importManyProtocolActionId, (data) =>
      handleImportManyProtocol(data, deps),
    );
    register(exploreProtocolActionId, handleExploreProtocol);
    register(showInLibraryProtocolActionId, handleShowInLibraryProtocol);
    register(openAttachmentProtocolActionId, (data) =>
      handleOpenAttachmentProtocol(data, deps),
    );
    register(updateAllProtocolActionId, (data) =>
      handleUpdateAllProtocol(data, deps),
    );
    register(importAllNotesProtocolActionId, (data) =>
      handleImportAllNotesProtocol(data, deps),
    );
    if (deps.webWorkbenchEnabled)
      register(importProfileProtocolActionId, (data) =>
        handleProfileImportProtocol(data, deps),
      );

    const outcomes = yield* PubSub.unbounded<ProtocolOutcome>();
    const answered = (outcome: ProtocolOutcome | void) =>
      outcome ? PubSub.publish(outcomes, outcome) : Effect.void;
    const localServer = yield* LocalServer;
    // A batch update pushed over HTTP (companion couldn't fit the ids in a URL)
    // runs the same interactive flow as the `update-many` protocol link. Each
    // run is a fiber of its own, so a long batch does not hold back the next
    // request.
    const updates = yield* forkEach(localServer.updateManyRequests, (event) =>
      FiberSet.run(
        runs,
        Effect.flatMap(updateManyRequested(event, deps), (outcome) =>
          answered(outcome),
        ),
      ),
    );
    // A batch import pushed over HTTP runs the same flow as the import-notes link.
    const imports = yield* forkEach(localServer.importNotesRequests, (event) =>
      FiberSet.run(
        runs,
        Effect.flatMap(importNotesRequested(event, deps), (outcome) =>
          answered(outcome),
        ),
      ),
    );

    const registration: ProtocolRegistration = {
      idle: Effect.andThen(
        Fiber.awaitAll([updates, imports]),
        FiberSet.awaitEmpty(runs),
      ),
      outcomes: Stream.fromPubSub(outcomes),
    };
    return registration;
  },
);

/**
 * {@link registerProtocolHandlers} as a registration of the plugin graph: the
 * handlers register on the {@link PluginHost} and run on the layer's Scope,
 * which unload closes. The note import modal's callbacks run through the
 * bridge over that Scope. `ports` hold the legacy values the handlers call.
 */
export const layerProtocolHandlers = (
  ports: Omit<ProtocolDeps, "bridge">,
): Layer.Layer<never, never, PluginHost | ProtocolServices> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* PluginHost;
      const bridge = yield* scopedBridge;
      yield* registerProtocolHandlers(host, { ...ports, bridge });
    }),
  );

/** The ports a batch import takes, from the handlers' legacy values. */
function importPorts(deps: ProtocolDeps): BatchImportPorts {
  return {
    view: deps.noteImportView,
    bridge: deps.bridge,
  };
}

/** The ports a note update takes, from the handlers' legacy values. */
function updatePorts(deps: ProtocolDeps): BatchUpdatePorts {
  return {
    notices: batchUpdateNotices(deps.app),
    view: deps.noteImportView,
    bridge: deps.bridge,
  };
}

/** The registered handlers, while their Scope holds them. */
export interface ProtocolRegistration {
  /**
   * Completes once both pushed request streams have ended (or the Scope has
   * closed) and no handler run or pushed request run is going.
   */
  readonly idle: Effect.Effect<void>;
  /**
   * The outcome of each pushed request, once its notice shows. A run that
   * fails or is interrupted gives none.
   */
  readonly outcomes: Stream.Stream<ProtocolOutcome>;
}

const updateManyRequested = Effect.fn("protocol.updateManyRequested")(
  function* (event: UpdateManyRequest, deps: ProtocolDeps) {
    const outcome = yield* updateMany(deps, event.items, event);
    yield* showProtocolOutcome(outcome, deps);
    return outcome;
  },
  logAndContinue("Pushed batch update failed", "protocol"),
);

const importNotesRequested = Effect.fn("protocol.importNotesRequested")(
  function* (event: ImportNotesRequest, deps: ProtocolDeps) {
    const outcome = yield* importNotes(deps, event.mode, event.items);
    yield* showProtocolOutcome(outcome, deps);
    return outcome;
  },
  logAndContinue("Pushed batch import failed", "protocol"),
);

/** A refused link or request: the handler stops with `outcome`. */
const refuse = (
  outcome: ProtocolOutcome,
): Result.Result<never, ProtocolOutcome> => Result.fail(outcome);

/**
 * The Exit of `task`, for the outcome that carries it. An interrupt (unload)
 * passes on and leaves no outcome.
 */
const settle = <A, E, R>(
  task: Effect.Effect<A, E, R>,
): Effect.Effect<Exit.Exit<A, E>, never, R> =>
  Effect.exit(task).pipe(
    Effect.filterOrElse(
      (exit) => !(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)),
      () => Effect.interrupt,
    ),
  );

/** Run the batch update of an `update-many` link or a pushed update. */
const updateMany = Effect.fn("protocol.updateMany")(function* (
  deps: ProtocolDeps,
  items: readonly number[],
  options: {
    readonly scope?: BatchUpdateOptions["scope"];
    readonly profileId?: string;
  },
) {
  const requested = resolveRequestedProfile(options.profileId);
  if (Result.isFailure(requested)) return requested.failure;
  const exit = yield* settle(
    runBatchUpdate(updatePorts(deps), items, {
      scope: options.scope,
      profile: requested.success,
    }),
  );
  return ProtocolOutcome.UpdateMany({ exit });
});

/** Run the import of an `import-note(s)` link or a pushed import. */
const importNotes = Effect.fn("protocol.importNotes")(function* (
  deps: ProtocolDeps,
  mode: ImportMode,
  itemIDs: readonly number[],
) {
  const exit = yield* settle(
    runBatchImport(importPorts(deps), { mode, itemIDs }),
  );
  return ProtocolOutcome.ImportNotes({ exit });
});

const handleProtocol = Effect.fn("protocol.handleProtocol")(function* (
  action: ProtocolAction,
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
) {
  const query = yield* parseProtocolData(data, {
    action,
    parse: parseProtocolQuery,
  });
  if (Result.isFailure(query)) return query.failure;

  const ref = yield* resolveProtocolItem(query.success, action);
  if (Result.isFailure(ref)) return ref.failure;

  const requested = resolveRequestedProfile(query.success.profileId);
  if (Result.isFailure(requested)) return requested.failure;

  yield* openCompanionNote(deps, ref.success, {
    action,
    scope: query.success.scope,
    profile: requested.success,
    paneType: query.success.paneType,
  });
  return ProtocolOutcome.Opened();
});

/**
 * A `profileId` param resolved into a selector, or the UnknownProfile outcome
 * when the text names neither `default` nor a Profile ID: the caller stops
 * there rather than fall back to the default.
 */
function resolveRequestedProfile(
  text: string | undefined,
): Result.Result<ProfileSelector | undefined, ProtocolOutcome> {
  if (text === undefined) return Result.succeed(undefined);
  const selector = parseProfileSelector(text);
  if (selector === undefined)
    return refuse(ProtocolOutcome.UnknownProfile({ text }));
  return Result.succeed(selector);
}

/**
 * Handle `obsidian://zotlit/update-many`. Validates the source id at this
 * transport edge, then hands the raw item-id list to {@link runBatchUpdate},
 * which owns the database-ready gate, classification, and the confirm/progress
 * modal.
 */
const handleBatchProtocol = Effect.fn("protocol.handleBatchProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const action = "update-many";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseProtocolBatchQuery,
    });
    if (Result.isFailure(query)) return query.failure;
    return yield* updateMany(deps, query.success.items, query.success);
  },
);

/** Handle `obsidian://zotlit/import-note`. */
const handleImportProtocol = Effect.fn("protocol.handleImportProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const action = "import-note";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseImportProtocolQuery,
    });
    if (Result.isFailure(query)) return query.failure;
    return yield* importNotes(deps, query.success.mode, [query.success.item]);
  },
);

/** Handle `obsidian://zotlit/import-notes`. */
const handleImportManyProtocol = Effect.fn("protocol.handleImportManyProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const action = "import-notes";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseImportManyProtocolQuery,
    });
    if (Result.isFailure(query)) return query.failure;
    return yield* importNotes(deps, query.success.mode, query.success.items);
  },
);

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
    return ProtocolOutcome.Opened();
  },
);

/**
 * Handle `obsidian://zotlit/show-in-library`, the link `zt.librarylink` writes
 * into a note. It names the Item by its Indexed Key and carries no
 * `source-id`, so it opens on every device the note syncs to.
 */
const handleShowInLibraryProtocol = Effect.fn(
  "protocol.handleShowInLibraryProtocol",
)(function* (data: ObsidianProtocolData) {
  const query = yield* Effect.try(() =>
    parseShowInLibraryProtocolQuery(data),
  ).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Invalid protocol query").pipe(
        Effect.annotateLogs({ action: "show-in-library", error: error.cause }),
        withLogCategory("protocol"),
        Effect.as(null),
      ),
    ),
  );
  if (!query) return ProtocolOutcome.InvalidLink();
  yield* (yield* ShowInLibrary).show(query.indexedKey);
  return ProtocolOutcome.Opened();
});

/**
 * Handle `obsidian://zotlit/open-attachment`. `query.item` may name either a
 * regular Item or an Attachment directly — `resolveProtocolItem` assumes a
 * regular item, so this branches for itself instead.
 */
const handleOpenAttachmentProtocol = Effect.fn(
  "protocol.handleOpenAttachmentProtocol",
)(function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
  const action = "open-attachment";
  const parsed = yield* parseProtocolData(data, {
    action,
    parse: parseOpenAttachmentProtocolQuery,
  });
  if (Result.isFailure(parsed)) return parsed.failure;
  const query = parsed.success;

  const zoteroReads = yield* ZoteroReads;
  if (!(yield* databaseReady(zoteroReads, action)))
    return ProtocolOutcome.DatabaseUnavailable();

  const attachments = yield* zoteroReads.reads.AttachmentsAt({
    itemID: query.item,
  });

  const openable = toObsidianOpenable(attachments, {
    vaultBasePath: (yield* ObsidianEnv).basePath,
    zoteroPref: yield* (yield* ZoteroPref).current,
  });

  openAttachments(openable, {
    reader: withPaneOverride(
      pdfPickerReader(
        openGesture(yield* TargetOpener, deps.bridge.runAndForget),
      ),
      query.paneType,
    ),
    app: deps.app,
  });
  return ProtocolOutcome.Opened();
});

/**
 * The Suggest modal's own click decides the pane (Mod-click/Mod-Enter) when
 * the link names none; a named `paneType` wins outright, since the link's own
 * request should not be second-guessed by how the picker was clicked.
 */
function withPaneOverride(
  reader: AttachmentReader<ObsidianOpenableAttachment>,
  paneType: PaneType | undefined,
): AttachmentReader<ObsidianOpenableAttachment> {
  return paneType ? withFixedPane(reader, paneType) : reader;
}

const handleUpdateAllProtocol = Effect.fn("protocol.handleUpdateAllProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const query = yield* parseProtocolData(data, {
      action: "update-all",
      parse: parseUpdateAllProtocolQuery,
    });
    if (Result.isFailure(query)) return query.failure;

    const exit = yield* settle(
      runBatchUpdateAll(updatePorts(deps), {
        groupID: query.success.groupID,
        collectionKey: query.success.collectionKey,
      }),
    );
    return ProtocolOutcome.UpdateAll({ exit });
  },
);

/** Handle `obsidian://zotlit/import-all-notes`. */
const handleImportAllNotesProtocol = Effect.fn(
  "protocol.handleImportAllNotesProtocol",
)(function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
  const query = yield* parseProtocolData(data, {
    action: "import-all-notes",
    parse: parseImportAllNotesProtocolQuery,
  });
  if (Result.isFailure(query)) return query.failure;

  const exit = yield* settle(
    runBatchImportAll(importPorts(deps), {
      groupID: query.success.groupID,
      collectionKey: query.success.collectionKey,
    }),
  );
  return ProtocolOutcome.ImportAllNotes({ exit });
});

/**
 * The link's query, or the outcome that refuses it: InvalidLink when it does
 * not parse, ForeignSource when it names another Zotero.
 */
function parseProtocolData<Query extends { sourceId: string }>(
  data: ObsidianProtocolData,
  options: {
    action: string;
    parse: (data: Record<string, unknown>) => Query;
  },
): Effect.Effect<Result.Result<Query, ProtocolOutcome>, never, ZoteroPref> {
  const { action, parse } = options;
  return Effect.gen(function* () {
    const parsed = yield* Effect.try(() => parse(data)).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Invalid protocol query").pipe(
          Effect.annotateLogs({ action, error: error.cause }),
          Effect.as(null),
        ),
      ),
    );
    if (!parsed) return refuse(ProtocolOutcome.InvalidLink());

    const { sourceId } = yield* (yield* ZoteroPref).current;
    if (!protocolSourceMatches(parsed, sourceId)) {
      yield* Effect.logWarning("Protocol source id mismatch").pipe(
        Effect.annotateLogs({
          action,
          received: parsed.sourceId,
          expected: sourceId,
        }),
      );
      return refuse(ProtocolOutcome.ForeignSource());
    }

    return Result.succeed(parsed);
  }).pipe(withLogCategory("protocol"));
}

/** Whether the database is ready; when it is not, log it and say so. */
const databaseReady = Effect.fn("protocol.databaseReady")(function* (
  zoteroReads: Pick<ZoteroReads["Service"], "current">,
  action: string,
) {
  if ((yield* zoteroReads.current).state === "ready") return true;
  yield* Effect.logWarning("Protocol handler: database not ready").pipe(
    Effect.annotateLogs({ action }),
    withLogCategory("protocol"),
  );
  return false;
});

/** The Item the link names, or the outcome that refuses it. */
const resolveProtocolItem = Effect.fn("protocol.resolveProtocolItem")(
  function* (query: { item: number }, action: string) {
    const zoteroReads = yield* ZoteroReads;
    if (!(yield* databaseReady(zoteroReads, action)))
      return refuse(ProtocolOutcome.DatabaseUnavailable());

    const ref = yield* readDisplayRef(zoteroReads.reads, query.item);
    if (!ref) {
      yield* Effect.logWarning("Protocol handler: item not found").pipe(
        Effect.annotateLogs({ action, itemID: query.item }),
        withLogCategory("protocol"),
      );
      return refuse(ProtocolOutcome.ItemNotFound());
    }

    const { itemID, libraryID, key, groupID, indexedKey } = ref;
    const item: ItemRef = { itemID, libraryID, key, groupID, indexedKey };
    return Result.succeed(item);
  },
);

/** Reuses the importer's clipboard reader and consent before opening the written file. */
const handleProfileImportProtocol = Effect.fn(
  "protocol.handleProfileImportProtocol",
)(function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
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
  if (!query) return ProtocolOutcome.InvalidLink();
  // A failure or a defect ends as ProfileImportFailed; an interrupt (unload)
  // passes through.
  return yield* openImportedProfile(deps).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logError("Failed to open clipboard Profile handoff").pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
            Effect.as(ProtocolOutcome.ProfileImportFailed()),
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
  function* (deps: ProtocolDeps) {
    yield* Effect.logDebug("Opening clipboard Profile import");
    const profile = yield* deps.importProfile({ source: "clipboard" });
    if (!profile) {
      yield* Effect.logDebug(
        "Clipboard Profile import ended without a document",
      );
      return ProtocolOutcome.ProfileImportCancelled();
    }
    const file = yield* (yield* Vault).getFileByPath(profile.path);
    if (!file) return yield* new ImportedProfileMissing({ path: profile.path });
    // The Workbench opens in its own window, whatever pane the link names.
    yield* explainWorkbenchOpen(yield* openTemplateWorkbench(file));
    yield* Effect.logDebug("Opened imported Profile in editor").pipe(
      Effect.annotateLogs({ path: profile.path }),
    );
    return ProtocolOutcome.ProfileOpened();
  },
);
