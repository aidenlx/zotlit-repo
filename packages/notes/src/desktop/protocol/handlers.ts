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
import type { Scope } from "effect";
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

export interface NoteLinkPorts extends InteractiveCreationPorts {
  noteImportView: NoteImportView;
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit" | "runAndForget">;
}

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

export function noteLinks(
  ports: Effect.Effect<
    NoteLinkPorts,
    never,
    ObsidianApp | Scope.Scope
  > = noteLinkPorts,
) {
  const link = <const A extends string>(
    action: A,
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

export interface NoteLinkRequests {
  readonly idle: Effect.Effect<void>;
  readonly outcomes: Stream.Stream<NoteLinkOutcome>;
}

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

export const layerNoteLinkRequests = Layer.effectDiscard(
  registerNoteLinkRequests(),
);

function importPorts(deps: NoteLinkPorts): BatchImportPorts {
  return {
    view: deps.noteImportView,
    bridge: deps.bridge,
  };
}

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

const settle = <A, E, R>(
  task: Effect.Effect<A, E, R>,
): Effect.Effect<Exit.Exit<A, E>, never, R> =>
  Effect.exit(task).pipe(
    Effect.filterOrElse(
      (exit) => !(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)),
      () => Effect.interrupt,
    ),
  );

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

function resolveRequestedProfile(
  text: string | undefined,
): Result.Result<ProfileSelector | undefined, NoteLinkOutcome> {
  if (text === undefined) return Result.succeed(undefined);
  const selector = parseProfileSelector(text);
  if (selector === undefined)
    return Result.fail(NoteLinkOutcome.UnknownProfile({ text }));
  return Result.succeed(selector);
}

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
