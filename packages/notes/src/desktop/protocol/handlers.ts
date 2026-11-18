import type { InteractiveCreationPorts } from "#desktop/note-feature/index.ts";
import type {
  BatchUpdateOptions,
  BatchUpdatePorts,
  BatchUpdateServices,
} from "#desktop/note-feature/update-batch.ts";
import type {
  BatchImportPorts,
  BatchImportServices,
} from "#desktop/note-import/batch-import.ts";
import type { NoteImportView } from "#desktop/note-import/view.ts";
import type { ProfileDialogServices } from "#desktop/profile/dialogs.ts";
// The note links: `obsidian://zotlit/{open,update}`, the batch `update-many`,
// the `import-note(s)` links and the library-wide `update-all` and
// `import-all-notes` links, and the batch updates and imports the Local Server
// pushes when their ids do not fit in a URL.
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  PubSub,
  Result,
  Stream,
} from "effect";
import type { Scope } from "effect";
import type { ObsidianProtocolData } from "obsidian";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import type { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { parseProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { logAndContinue } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type {
  ImportNotesRequest,
  UpdateManyRequest,
} from "@zotlit/plugin-services/core/local-server/service.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import {
  parseProtocolData,
  resolveProtocolItem,
} from "@zotlit/plugin-services/obsidian/protocol/link.ts";
import type { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { protocolHandler } from "@zotlit/plugin-shell/obsidian/feature.ts";
import {
  batchProtocolActionId,
  importAllNotesProtocolActionId,
  importManyProtocolActionId,
  importProtocolActionId,
  parseImportAllNotesProtocolQuery,
  parseImportManyProtocolQuery,
  parseImportProtocolQuery,
  parseProtocolBatchQuery,
  parseProtocolQuery,
  parseUpdateAllProtocolQuery,
  protocolActionId,
  protocolActions,
  updateAllProtocolActionId,
} from "@zotlit/protocol";
import type { ImportMode, ProtocolAction } from "@zotlit/protocol";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { showNoteLinkOutcome } from "./notices.ts";
import { NoteLinkOutcome } from "./outcome.ts";

import { openCompanionNote } from "#desktop/note-feature/index.ts";
import {
  runBatchUpdate,
  runBatchUpdateAll,
} from "#desktop/note-feature/update-batch.ts";
import { batchUpdateNotices } from "#desktop/note-feature/update-single.ts";
import {
  runBatchImport,
  runBatchImportAll,
} from "#desktop/note-import/batch-import.ts";
import { createNoteImportView } from "#desktop/note-import/view.ts";
import { interactiveCreation } from "#desktop/profile/dialogs.ts";

/** The services a note link reads through their tags. */
export type NoteLinkServices =
  | BatchImportServices
  | BatchUpdateServices
  | LocalServer
  | Notifier
  | ObsidianEnv
  | ProfileDialogServices
  | UseLedger
  | Vault
  | Workspace
  | ZoteroPref
  | ZoteroReads;

/**
 * The legacy values a note link still holds. The Profile dialogs run in the
 * link's fiber; the note import view converts in a later slice.
 */
export interface NoteLinkPorts extends InteractiveCreationPorts {
  /** The note import's classify, confirm and Profile modals. */
  noteImportView: NoteImportView;
  /** Runs the note import modal's callbacks, which unload interrupts. */
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit" | "runAndForget">;
}

/**
 * The ports over the App, with a bridge over the plugin's Scope: the note
 * import modal's callbacks run on it, so unload interrupts them.
 */
export const noteLinkPorts: Effect.Effect<
  NoteLinkPorts,
  never,
  ObsidianApp | Scope.Scope
> = Effect.gen(function* () {
  const app = yield* ObsidianApp;
  const creation = interactiveCreation(app);
  return {
    ...creation,
    noteImportView: createNoteImportView(app, creation),
    bridge: yield* scopedBridge,
  };
});

/**
 * The note links. Each link carries a `source-id` hash the handler validates
 * before delegating to the note-feature service, and runs with the ports
 * `ports` makes.
 *
 * `update-many` is a link of its own, beside the per-item links, because it
 * decodes a different query shape (an item-id list) and routes to the batch
 * runner.
 */
export function noteLinks(
  ports: Effect.Effect<
    NoteLinkPorts,
    never,
    ObsidianApp | Scope.Scope
  > = noteLinkPorts,
) {
  const link = (
    action: string,
    handle: (
      data: ObsidianProtocolData,
      deps: NoteLinkPorts,
    ) => Effect.Effect<NoteLinkOutcome, unknown, NoteLinkServices>,
  ) =>
    protocolHandler(action, (data) =>
      Effect.gen(function* () {
        const deps = yield* ports;
        const outcome = yield* handle(data, deps);
        yield* showNoteLinkOutcome(outcome, deps);
        return outcome;
      }),
    );
  return [
    ...protocolActions.map((action) =>
      link(protocolActionId(action), (data, deps) =>
        handleProtocol(action, data, deps),
      ),
    ),
    link(batchProtocolActionId, handleBatchProtocol),
    link(importProtocolActionId, handleImportProtocol),
    link(importManyProtocolActionId, handleImportManyProtocol),
    link(updateAllProtocolActionId, handleUpdateAllProtocol),
    link(importAllNotesProtocolActionId, handleImportAllNotesProtocol),
  ];
}

/** The pushed requests, while their Scope holds them. */
export interface NoteLinkRequests {
  /**
   * Completes once both pushed request streams have ended (or the Scope has
   * closed) and no pushed request run is going.
   */
  readonly idle: Effect.Effect<void>;
  /**
   * The outcome of each pushed request, once its notice shows. A run that
   * fails or is interrupted gives none.
   */
  readonly outcomes: Stream.Stream<NoteLinkOutcome>;
}

/**
 * Run each batch update and import the Local Server pushes: a batch update
 * pushed over HTTP (the companion could not fit the ids in a URL) runs the
 * same interactive flow as the `update-many` link, and a batch import the
 * same flow as the `import-notes` link. Each run is a fiber of the current
 * Scope, so a long batch does not hold back the next request, and closing
 * the Scope stops the pushed requests and interrupts the runs still going.
 */
export const registerNoteLinkRequests = Effect.fn("registerNoteLinkRequests")(
  function* (
    ports: Effect.Effect<
      NoteLinkPorts,
      never,
      ObsidianApp | Scope.Scope
    > = noteLinkPorts,
  ) {
    const deps = yield* ports;
    const runs = yield* FiberSet.make();
    const outcomes = yield* PubSub.unbounded<NoteLinkOutcome>();
    const answered = (outcome: NoteLinkOutcome | void) =>
      outcome ? PubSub.publish(outcomes, outcome) : Effect.void;
    const localServer = yield* LocalServer;
    const updates = yield* forkEach(localServer.updateManyRequests, (event) =>
      FiberSet.run(
        runs,
        Effect.flatMap(updateManyRequested(event, deps), (outcome) =>
          answered(outcome),
        ),
      ),
    );
    const imports = yield* forkEach(localServer.importNotesRequests, (event) =>
      FiberSet.run(
        runs,
        Effect.flatMap(importNotesRequested(event, deps), (outcome) =>
          answered(outcome),
        ),
      ),
    );

    const requests: NoteLinkRequests = {
      idle: Effect.andThen(
        Fiber.awaitAll([updates, imports]),
        FiberSet.awaitEmpty(runs),
      ),
      outcomes: Stream.fromPubSub(outcomes),
    };
    return requests;
  },
);

/**
 * {@link registerNoteLinkRequests} as a registration of the plugin graph: the
 * runs go on the layer's Scope, which unload closes.
 */
export const layerNoteLinkRequests = Layer.effectDiscard(
  registerNoteLinkRequests(),
);

/** The ports a batch import takes, from the links' legacy values. */
function importPorts(deps: NoteLinkPorts): BatchImportPorts {
  return {
    view: deps.noteImportView,
    bridge: deps.bridge,
  };
}

/** The ports a note update takes, from the links' legacy values. */
function updatePorts(deps: NoteLinkPorts): BatchUpdatePorts {
  return {
    notices: batchUpdateNotices(deps.app),
    view: deps.noteImportView,
    bridge: deps.bridge,
  };
}

const updateManyRequested = Effect.fn("protocol.updateManyRequested")(
  function* (event: UpdateManyRequest, deps: NoteLinkPorts) {
    const outcome = yield* updateMany(deps, event.items, event);
    yield* showNoteLinkOutcome(outcome, deps);
    return outcome;
  },
  logAndContinue("Pushed batch update failed", "protocol"),
);

const importNotesRequested = Effect.fn("protocol.importNotesRequested")(
  function* (event: ImportNotesRequest, deps: NoteLinkPorts) {
    const outcome = yield* importNotes(deps, event.mode, event.items);
    yield* showNoteLinkOutcome(outcome, deps);
    return outcome;
  },
  logAndContinue("Pushed batch import failed", "protocol"),
);

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
  deps: NoteLinkPorts,
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
  return NoteLinkOutcome.UpdateMany({ exit });
});

/** Run the import of an `import-note(s)` link or a pushed import. */
const importNotes = Effect.fn("protocol.importNotes")(function* (
  deps: NoteLinkPorts,
  mode: ImportMode,
  itemIDs: readonly number[],
) {
  const exit = yield* settle(
    runBatchImport(importPorts(deps), { mode, itemIDs }),
  );
  return NoteLinkOutcome.ImportNotes({ exit });
});

const handleProtocol = Effect.fn("protocol.handleProtocol")(function* (
  action: ProtocolAction,
  data: ObsidianProtocolData,
  deps: NoteLinkPorts,
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
  return NoteLinkOutcome.Opened();
});

/**
 * A `profileId` param resolved into a selector, or the UnknownProfile outcome
 * when the text names neither `default` nor a Profile ID: the caller stops
 * there rather than fall back to the default.
 */
function resolveRequestedProfile(
  text: string | undefined,
): Result.Result<ProfileSelector | undefined, NoteLinkOutcome> {
  if (text === undefined) return Result.succeed(undefined);
  const selector = parseProfileSelector(text);
  if (selector === undefined)
    return Result.fail(NoteLinkOutcome.UnknownProfile({ text }));
  return Result.succeed(selector);
}

/**
 * Handle `obsidian://zotlit/update-many`. Validates the source id at this
 * transport edge, then hands the raw item-id list to {@link runBatchUpdate},
 * which owns the database-ready gate, classification, and the confirm/progress
 * modal.
 */
const handleBatchProtocol = Effect.fn("protocol.handleBatchProtocol")(
  function* (data: ObsidianProtocolData, deps: NoteLinkPorts) {
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
  function* (data: ObsidianProtocolData, deps: NoteLinkPorts) {
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
  function* (data: ObsidianProtocolData, deps: NoteLinkPorts) {
    const action = "import-notes";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseImportManyProtocolQuery,
    });
    if (Result.isFailure(query)) return query.failure;
    return yield* importNotes(deps, query.success.mode, query.success.items);
  },
);

const handleUpdateAllProtocol = Effect.fn("protocol.handleUpdateAllProtocol")(
  function* (data: ObsidianProtocolData, deps: NoteLinkPorts) {
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
    return NoteLinkOutcome.UpdateAll({ exit });
  },
);

/** Handle `obsidian://zotlit/import-all-notes`. */
const handleImportAllNotesProtocol = Effect.fn(
  "protocol.handleImportAllNotesProtocol",
)(function* (data: ObsidianProtocolData, deps: NoteLinkPorts) {
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
  return NoteLinkOutcome.ImportAllNotes({ exit });
});
