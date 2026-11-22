import type {
  AnnotationLock,
  LockedVerb,
  LockReason,
} from "#core/annotation-repository/lock.ts";
import type {
  HistoryJoin,
  HistoryStep,
} from "#obsidian/annotation-repository/history.ts";
import type {
  AnnotationDraft,
  ConflictedWrite,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TextField,
  WriteConflict,
  WriteFailure,
  WriteRequest,
  WriteTarget,
} from "#obsidian/annotation-repository/write.ts";
import {
  Cause,
  DateTime,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Option,
  Result,
  Schema,
} from "effect";

import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";
import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import {
  libraryPath,
  readCreateResult,
} from "@zotlit/plugin-services/core/zotero-local-api/wire.ts";
import type {
  LocalApiFailure,
  LocalApiSource,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import type { DatabaseRowsError } from "./bridge.ts";
import {
  cancelTextSave,
  draftFor,
  dropDrafts,
  reconcileDrafts,
} from "./draft-store.ts";
import { recordExistence, recordGroup, recordStep } from "./history-record.ts";
import {
  announceReadPixels,
  attachmentHolding,
  compatibleApiSource,
  dropAttachment,
  editingCapability,
  handOff,
  read,
  refresh,
  rememberAcknowledgedRevision,
  sessionHolding,
  sourceStillBound,
  writeHolding,
} from "./lists.ts";
import type { AnnotationLibraryUnresolved } from "./lists.ts";
import {
  ANNOTATIONS,
  TEXT_FIELD_SPECS,
  freshValueOf,
  fromLocalApi,
} from "./model.ts";
import type {
  AnnotationConfirmation,
  AnnotationMutation,
  AnnotationRecord,
  ConfirmedWrite,
  GroupKind,
  GroupWrites,
  HeldAnnotation,
  PendingProposal,
  ProposedFields,
  WriteAttempt,
} from "./model.ts";
import { leave, settle, standingOutcome, takeOver } from "./outcomes.ts";
import type { CoreState } from "./state.ts";

import { lockRefuses } from "#core/annotation-repository/lock.ts";
import { contentOf } from "#obsidian/annotation-repository/history.ts";
import {
  resolvesSilently,
  sameStoredGeometry,
} from "#obsidian/annotation-repository/reconcile.ts";
import {
  colorPatch,
  createRequest,
  eraseRequest,
  geometryPatch,
  IDLE,
  MAX_POSITION_LENGTH,
  TEXT_FIELDS,
  wireColor,
  writePosition,
} from "#obsidian/annotation-repository/write.ts";

type LockedFailure = Extract<WriteFailure, { kind: "locked" }>;

export class WriteRunFailed extends Schema.TaggedError<
  WriteRunFailed,
  { readonly brand: unique symbol }
>()("WriteRunFailed", { cause: Schema.Defect() }) {}

const UNKNOWN_OUTCOME: MutationState = {
  kind: "failed",
  failure: { kind: "unknown-outcome" },
};

type WriteTurn = (
  send: Effect.Effect<MutationState, WriteReadError>,
  own: AnnotationMutation,
) => Effect.Effect<MutationState, WriteReadError>;

type Command = WriteAttempt & {
  request: (target: WriteTarget, record: AnnotationRecord) => WriteRequest;
  settle?: "re-read" | "drop";
  join?: HistoryJoin;
  propose?: (record: AnnotationRecord) => ProposedFields;
  run?: WriteTurn;
  gather?: GroupWrites;
};

type QueuedCommand = WriteAttempt & {
  expectedServerID: string | null;
  generation: number;
  request: (target: WriteTarget, record: AnnotationRecord) => WriteRequest;
  settle?: "re-read" | "drop";
  join?: HistoryJoin;
  gather?: GroupWrites;
  reapplied?: true;
  progress?: { answer: MutationState | null };
};

type WriteReadError = DatabaseRowsError | AnnotationLibraryUnresolved;

export type CreateOutcome =
  | { kind: "created"; annotationKey: string }
  | { kind: "failed"; failure: WriteFailure };

const createAnnotation = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  create: { draft: Omit<AnnotationDraft, "parentKey">; group?: string },
): Effect.fn.Return<CreateOutcome, WriteReadError> {
  const progress: { answer: CreateOutcome | null } = { answer: null };
  const fiber = yield* FiberSet.run(
    core.fibers,
    counted(
      core,
      attachmentKey,
      sendCreate(core, attachmentKey, { ...create, progress }),
    ),
  );
  const exit = yield* Fiber.await(fiber);
  if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
    return (
      progress.answer ?? {
        kind: "failed",
        failure: { kind: "unknown-outcome" },
      }
    );
  }
  return yield* exit;
});

const sendCreate = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  {
    draft,
    group,
    progress,
  }: {
    draft: Omit<AnnotationDraft, "parentKey">;
    group?: string;
    progress: { answer: CreateOutcome | null };
  },
): Effect.fn.Return<CreateOutcome, WriteReadError> {
  const parsed = parseIndexedKey(attachmentKey);
  if (!parsed) {
    return { kind: "failed", failure: { kind: "unknown-annotation" } };
  }
  const expectedSource = yield* compatibleApiSource(core, attachmentKey);
  if (!expectedSource) {
    return { kind: "failed", failure: { kind: "db-source" } };
  }
  if (!(yield* handOff(core, attachmentKey))) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  const whole = { ...draft, parentKey: parsed.key };
  if (writePosition(whole.position).length > MAX_POSITION_LENGTH) {
    yield* Effect.logDebug(
      "A selection's position is longer than Zotero accepts",
    ).pipe(Effect.annotateLogs({ attachmentKey }));
    return { kind: "failed", failure: { kind: "position-too-large" } };
  }

  const blocked = yield* writeBlocked(core, attachmentKey);
  if (blocked) return { kind: "failed", failure: blocked };

  const library = libraryPath(parsed);
  const request = createRequest(library, whole, core.writeToken());
  const source = yield* compatibleApiSource(core, attachmentKey);
  const reply = yield* core.localApi.authorizedSend(request.path, {
    library,
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const created =
    "failure" in reply
      ? reply
      : readCreateResult(reply.value.text, {
          parentKey: attachmentKey,
          type: whole.type,
        });
  progress.answer =
    "failure" in created
      ? { kind: "failed", failure: created.failure }
      : { kind: "created", annotationKey: created.value.key };
  if (!source || !(yield* sourceStillBound(core, attachmentKey, source))) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  if ("failure" in reply) {
    yield* Effect.logDebug("Zotero did not confirm an annotation create").pipe(
      Effect.annotateLogs({ attachmentKey, failure: reply.failure }),
    );
    yield* refresh(core, attachmentKey);
    return { kind: "failed", failure: reply.failure };
  }

  if ("failure" in created) {
    yield* refresh(core, attachmentKey);
    return { kind: "failed", failure: created.failure };
  }

  const annotationKey = created.value.key;
  rememberAcknowledgedRevision(core, attachmentKey, reply.value.headers);
  const record = fromLocalApi(created.value);
  if (
    !(yield* publishApiChange(
      core,
      { attachmentKey, source },
      { kind: "created", record },
    ))
  )
    return { kind: "failed", failure: { kind: "server-changed" } };
  yield* refresh(core, attachmentKey);
  yield* Effect.logDebug("Zotero created an annotation").pipe(
    Effect.annotateLogs({ attachmentKey, annotationKey, type: whole.type }),
  );
  const content = contentOf(record);
  if (content) {
    yield* recordExistence(
      core,
      { annotationKey, before: { content: null }, after: { content } },
      { attachmentKey, group },
    );
  }
  core.publish({ _tag: "annotations-changed", attachmentKey });
  return { kind: "created", annotationKey };
});

const patchColor = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  color: string,
) {
  return yield* recolor(core, annotationKey, { color });
});

const patchColors = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKeys: readonly string[],
  color: string,
) {
  return yield* groupWrite(
    core,
    { kind: "color", annotationKeys },
    (key, gather) => recolor(core, key, { color, gather }),
  );
});

const recolor = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  { color, gather }: { color: string; gather?: GroupWrites },
) {
  return yield* command(core, annotationKey, {
    write: "color",
    attempted: color,
    request: (target) => colorPatch(target, color),
    propose: () => ({ color: wireColor(color) }),
    ...(gather && { gather }),
  });
});

const patchComment = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  comment: string,
) {
  return yield* writeText(core, annotationKey, {
    field: "comment",
    value: comment,
  });
});

const writeText = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  { field, value, run }: { field: TextField; value: string; run?: WriteTurn },
) {
  const spec = TEXT_FIELD_SPECS[field];
  return yield* command(core, annotationKey, {
    write: field,
    attempted: value,
    request: (target) => spec.request(target, value),
    propose: () => spec.propose(value),
    run,
  });
});

const patchGeometry = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  { edit, input }: { edit: GeometryEdit; input: GeometryInput },
) {
  if (writePosition(edit.position).length > MAX_POSITION_LENGTH) {
    yield* Effect.logDebug(
      "A Geometry Edit's position is longer than Zotero accepts",
    ).pipe(Effect.annotateLogs({ annotationKey }));
    return settle(core, annotationKey, {
      write: "geometry",
      state: {
        kind: "failed",
        failure: { kind: "position-too-large" },
      },
    });
  }
  return yield* command(core, annotationKey, {
    write: "geometry",
    attempted: edit,
    input,
    request: (target, record) => geometryPatch(target, record.type, edit),
    propose: (record) => proposedGeometry(record, edit),
    ...(input === "keyboard" && {
      join: { input, at: yield* DateTime.now },
    }),
  });
});

const deleteAnnotation = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  return yield* erase(core, annotationKey);
});

const erase = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  gather?: GroupWrites,
) {
  for (const field of TEXT_FIELDS) {
    const draft = yield* draftFor(core, field, annotationKey);
    if (draft) yield* cancelTextSave(core, field, draft);
  }
  return yield* command(core, annotationKey, {
    write: "delete",
    attempted: null,
    request: eraseRequest,
    settle: "drop",
    ...(gather && { gather }),
  });
});

const deleteAnnotations = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKeys: readonly string[],
) {
  return yield* groupWrite(
    core,
    { kind: "existence", annotationKeys },
    (key, gather) => erase(core, key, gather),
  );
});

const groupWrite = Effect.fnUntraced(function* <E>(
  core: CoreState,
  {
    kind,
    annotationKeys,
  }: { kind: GroupKind; annotationKeys: readonly string[] },
  write: (
    annotationKey: string,
    gather: GroupWrites,
  ) => Effect.Effect<MutationState, E>,
) {
  const locked = yield* firstHeldLockRefusal(core, annotationKeys, kind);
  if (locked)
    return annotationKeys.map((key): MutationState =>
      key === locked.annotationKey
        ? { kind: "failed", failure: locked.failure }
        : IDLE,
    );
  const gather: GroupWrites = { kind, writes: [] };
  const settled = yield* Effect.forEach(
    annotationKeys,
    (annotationKey) =>
      write(annotationKey, gather).pipe(
        recover(
          (cause) =>
            Effect.logWarning("A write of a group threw", cause).pipe(
              Effect.annotateLogs({ annotationKey }),
            ),
          Effect.succeed(UNKNOWN_OUTCOME),
        ),
      ),
    { concurrency: "unbounded" },
  );
  const byAttachment = Map.groupBy(
    gather.writes,
    (entry) => entry.attachmentKey,
  );
  for (const [attachmentKey, writes] of byAttachment)
    yield* recordGroup(core, annotationKeys, { attachmentKey, kind, writes });
  return settled;
});

const retryWrite = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  const standing = standingOutcome(core, annotationKey);
  if (standing?.kind !== "conflict") return standing ?? IDLE;
  const { conflict } = standing;
  switch (conflict.write) {
    case "color":
      return yield* patchColor(core, annotationKey, conflict.attempted ?? "");
    case "comment":
    case "text":
      return yield* writeText(core, annotationKey, {
        field: conflict.write,
        value: conflict.attempted ?? "",
      });
    case "delete":
      return yield* deleteAnnotation(core, annotationKey);
    case "geometry":
      return yield* patchGeometry(core, annotationKey, {
        edit: conflict.attempted,
        input: conflict.input,
      });
  }
});

const discardConflict = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  const standing = standingOutcome(core, annotationKey);
  if (standing?.kind !== "conflict") return;
  yield* Effect.logDebug("A write conflict was discarded").pipe(
    Effect.annotateLogs({ annotationKey }),
  );
  settle(core, annotationKey, { write: standing.conflict.write, state: IDLE });
});

const command = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  command: Command,
): Effect.fn.Return<MutationState, WriteRunFailed> {
  const locked = yield* lockRefusal(core, annotationKey, command.write);
  if (locked) return { kind: "failed", failure: locked };
  const expectedServerID =
    (yield* core.localApi.demandSource)?.serverID ?? null;
  const generation = core.commandGeneration;
  const held = yield* sessionHolding(core, annotationKey);
  const proposal: PendingProposal | null =
    held && command.propose
      ? {
          annotationKey,
          attachmentKey: held.attachmentKey,
          serverID: expectedServerID,
          fields: command.propose(held.record),
        }
      : null;
  const queued = { expectedServerID, generation, ...command };
  const { client } = core.queries;
  const mutation: AnnotationMutation = client.getMutationCache().build(client, {
    mutationKey: [ANNOTATIONS, annotationKey, command.write],
    scope: { id: JSON.stringify([ANNOTATIONS, annotationKey]) },
    networkMode: "always",
    mutationFn: async () => {
      const progress: { answer: MutationState | null } = { answer: null };
      const send = runCommand(core, annotationKey, { ...queued, progress });
      const exit = await core.bridge.runPromiseExit(
        command.run ? command.run(send, mutation) : send,
      );
      return valueOr(exit, progress.answer ?? UNKNOWN_OUTCOME);
    },
  });
  core.pendingStates.set(mutation, {
    kind: "pending",
    write: command.write,
    ...("session" in command && command.session && { session: true }),
  });
  const operation = mutation.execute(proposal);
  const answer = Effect.tryPromise({
    try: () => operation,
    catch: (cause) => new WriteRunFailed({ cause }),
  });
  core.operations.set(mutation, answer);
  if (proposal) {
    core.publish({
      _tag: "annotations-changed",
      attachmentKey: proposal.attachmentKey,
    });
  }
  core.publish({ _tag: "annotation-changed", annotationKey });
  const settled = () => {
    if (proposal) {
      core.publish({
        _tag: "annotations-changed",
        attachmentKey: proposal.attachmentKey,
      });
    }
    core.publish({ _tag: "annotation-changed", annotationKey });
  };
  void operation.then(settled, settled);
  return yield* counted(core, attachmentHolding(core, annotationKey), answer);
});

const runCommand: (
  core: CoreState,
  annotationKey: string,
  command: QueuedCommand,
) => Effect.Effect<MutationState, WriteReadError> = Effect.fnUntraced(
  function* (core, annotationKey, command) {
    const held = yield* writeHolding(core, annotationKey);
    if (held === "server-changed") {
      return leave(core, annotationKey, {
        write: command.write,
        state: {
          kind: "failed",
          failure: { kind: "server-changed" },
        },
      });
    }
    if (command.generation !== core.commandGeneration) {
      return UNKNOWN_OUTCOME;
    }
    if (
      ((yield* core.localApi.demandSource)?.serverID ?? null) !==
      command.expectedServerID
    ) {
      return { kind: "failed", failure: { kind: "server-changed" } };
    }
    const parsed = parseIndexedKey(annotationKey);
    if (!held || !parsed) {
      return leave(core, annotationKey, {
        write: command.write,
        state: {
          kind: "failed",
          failure: { kind: "unknown-annotation" },
        },
      });
    }
    if (!(yield* compatibleApiSource(core, held.attachmentKey))) {
      return leave(core, annotationKey, {
        write: command.write,
        state: {
          kind: "failed",
          failure: { kind: "db-source" },
        },
      });
    }
    const { version } = held.record;
    if (version === null) {
      return leave(core, annotationKey, {
        write: command.write,
        state: {
          kind: "failed",
          failure: { kind: "db-source" },
        },
      });
    }

    takeOver(core, annotationKey, command.write);
    const blocked = yield* writeBlocked(core, held.attachmentKey);
    if (blocked) {
      return leave(core, annotationKey, {
        write: command.write,
        state: {
          kind: "failed",
          failure: blocked,
        },
      });
    }

    const lock = core.locks.get(held.attachmentKey)?.get(annotationKey)?.reason;
    const library = libraryPath(parsed);
    const { path, method, headers, body } = command.request(
      { library, key: parsed.key, version },
      held.record,
    );
    const source = yield* compatibleApiSource(core, held.attachmentKey);
    if (command.progress) command.progress.answer = null;
    const reply = yield* core.localApi.authorizedSend(path, {
      library,
      method,
      headers,
      body,
    });
    if (command.progress) {
      command.progress.answer =
        "failure" in reply ? { kind: "failed", failure: reply.failure } : IDLE;
    }
    if (
      !source ||
      !(yield* sourceStillBound(core, held.attachmentKey, source))
    ) {
      if (
        core.databaseBindings.get(held.attachmentKey)?.source.database
          .serverID !== source?.serverID
      ) {
        return { kind: "failed", failure: { kind: "server-changed" } };
      }
      return leave(core, annotationKey, {
        write: command.write,
        state: {
          kind: "failed",
          failure: { kind: "server-changed" },
        },
      });
    }
    if ("failure" in reply) {
      yield* Effect.logDebug("Zotero refused a write").pipe(
        Effect.annotateLogs({ annotationKey, method, failure: reply.failure }),
      );
      const refused = yield* writeRefused(core, held, {
        ...command,
        failure: reply.failure,
        source,
      });
      if (refused.kind === "re-apply" && !command.reapplied) {
        yield* Effect.logDebug(
          "A tag write applies its names again to fresh tags",
        ).pipe(Effect.annotateLogs({ annotationKey }));
        return yield* runCommand(core, annotationKey, {
          ...command,
          reapplied: true,
        });
      }
      const state: MutationState =
        refused.kind === "re-apply"
          ? { kind: "failed", failure: reply.failure }
          : refused;
      if (state.kind === "failed") yield* refresh(core, held.attachmentKey);
      leave(core, annotationKey, { write: command.write, state });
      if (state.kind === "conflict") {
        core.publish({
          _tag: "write-conflict",
          annotationKey,
          attachmentKey: held.attachmentKey,
        });
      }
      return state;
    }

    yield* Effect.logDebug("Zotero took a write").pipe(
      Effect.annotateLogs({ annotationKey, method }),
    );
    rememberAcknowledgedRevision(core, held.attachmentKey, reply.value.headers);
    const applied = yield* applyWrite(core, held, {
      write: command.write,
      settle: command.settle ?? "re-read",
      lock,
    });
    if ("failure" in applied) {
      yield* refresh(core, held.attachmentKey);
      return leave(core, annotationKey, {
        write: command.write,
        state: {
          kind: "failed",
          failure: applied.failure,
        },
      });
    }
    if (command.settle === "drop") {
      yield* dropDrafts(core, annotationKey);
    }
    if (
      !(yield* sourceStillBound(core, held.attachmentKey, source)) ||
      !(yield* publishApiChange(
        core,
        { attachmentKey: held.attachmentKey, source },
        applied.value,
      ))
    ) {
      return leave(core, annotationKey, {
        write: command.write,
        state: {
          kind: "failed",
          failure: { kind: "server-changed" },
        },
      });
    }
    yield* refresh(core, held.attachmentKey);
    if (command.gather) {
      command.gather.writes.push({
        attachmentKey: held.attachmentKey,
        before: held.record,
        applied: applied.value,
      });
    } else {
      yield* recordStep(core, held.record, {
        attachmentKey: held.attachmentKey,
        applied: applied.value,
        join: command.join,
      });
    }
    core.publish({
      _tag: "annotations-changed",
      attachmentKey: held.attachmentKey,
    });
    return leave(core, annotationKey, { write: command.write, state: IDLE });
  },
);

function counted<A, E>(
  core: CoreState,
  attachmentKey: string | undefined,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  if (attachmentKey === undefined) return work;
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      core.writesInFlight.set(
        attachmentKey,
        (core.writesInFlight.get(attachmentKey) ?? 0) + 1,
      );
    }),
    () => work,
    () => uncount(core, attachmentKey),
  );
}

const uncount = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  const left = (core.writesInFlight.get(attachmentKey) ?? 1) - 1;
  if (left > 0) {
    core.writesInFlight.set(attachmentKey, left);
    return;
  }
  core.writesInFlight.delete(attachmentKey);
  if (yield* core.localApi.demandSource) return;
  yield* FiberSet.run(
    core.fibers,
    read(core, attachmentKey).pipe(
      recover(
        (cause) =>
          Effect.logDebug(
            "The database fallback after a write could not be read",
            cause,
          ).pipe(Effect.annotateLogs({ attachmentKey })),
        Effect.void,
      ),
    ),
  );
});

const lockRefusal = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  verb: LockedVerb,
) {
  return (
    (yield* firstHeldLockRefusal(core, [annotationKey], verb))?.failure ?? null
  );
});

const firstHeldLockRefusal = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKeys: readonly string[],
  kind: LockedVerb | HistoryStep["kind"],
): Effect.fn.Return<{
  annotationKey: string;
  failure: LockedFailure;
} | null> {
  const verb: LockedVerb = kind === "existence" ? "delete" : kind;
  const refused = Option.getOrNull(
    yield* Effect.findFirstFilter(annotationKeys, (annotationKey) =>
      writeLock(core, annotationKey).pipe(
        Effect.map((lock) =>
          lock && lockRefuses(lock, verb)
            ? Result.succeed({ annotationKey, lock })
            : Result.fail(undefined),
        ),
      ),
    ),
  );
  if (!refused) return null;
  const { annotationKey, lock } = refused;
  yield* Effect.logDebug("A lock refused a write").pipe(
    Effect.annotateLogs({ annotationKey, verb, reason: lock.reason }),
  );
  return { annotationKey, failure: { kind: "locked", reason: lock.reason } };
});

const writeLock = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
): Effect.fn.Return<AnnotationLock | null> {
  for (const [attachmentKey, locks] of core.locks) {
    const lock = locks.get(annotationKey);
    if (lock) return (yield* writeBlocked(core, attachmentKey)) ? null : lock;
  }
  return null;
});

const writeBlocked = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
): Effect.fn.Return<WriteFailure | null> {
  const capability = yield* editingCapability(core, attachmentKey);
  switch (capability.kind) {
    case "writable":
      return null;
    case "authorization-required":
    case "authorizing":
      return { kind: "unauthorized" };
    case "cooldown":
      return {
        kind: "cooldown",
        retryAfter: DateTime.distance(
          yield* DateTime.now,
          capability.retryAfter,
        ),
      };
    case "read-only":
      if (
        capability.reason === "probing" ||
        capability.reason === "zotero-unavailable"
      )
        return { kind: "unreachable" };
      if (capability.reason === "invalid-response")
        return {
          kind: "invalid-response",
          issue: "Zotero response unavailable",
        };
      return { kind: capability.reason };
  }
});

const writeRefused = Effect.fnUntraced(function* (
  core: CoreState,
  held: HeldAnnotation,
  refusal: WriteAttempt & { failure: WriteFailure; source: LocalApiSource },
): Effect.fn.Return<MutationState | { kind: "re-apply" }, WriteReadError> {
  const { failure, source } = refusal;
  const annotationKey = held.record.key;
  if (failure.kind === "not-found") {
    yield* dropAttachment(core, held.attachmentKey, held.queryKey);
    return { kind: "failed", failure };
  }
  if (failure.kind !== "conflict") return { kind: "failed", failure };

  const fresh = yield* core.localApi.readAnnotation(
    annotationKey,
    held.attachmentKey,
  );
  if ("failure" in fresh) {
    yield* Effect.logDebug(
      "A conflicted annotation could not be read back",
    ).pipe(Effect.annotateLogs({ annotationKey, failure: fresh.failure }));
    yield* dropAttachment(core, held.attachmentKey, held.queryKey);
    return {
      kind: "failed",
      failure: fresh.failure.kind === "not-found" ? fresh.failure : failure,
    };
  }

  const record = fromLocalApi(fresh.value);
  if (
    !(yield* sourceStillBound(core, held.attachmentKey, source)) ||
    !(yield* publishApiChange(
      core,
      { attachmentKey: held.attachmentKey, source },
      { kind: "observed", record },
    ))
  ) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  yield* dropAttachment(core, held.attachmentKey, held.queryKey);

  if (refusal.write === "tags") return { kind: "re-apply" };
  const conflict = conflictOf(refusal, record);
  if (!conflict) {
    yield* Effect.logDebug(
      "A write conflict resolved to the value Zotero holds",
    ).pipe(Effect.annotateLogs({ annotationKey, write: refusal.write }));
    return IDLE;
  }
  return { kind: "conflict", conflict };
});

const applyWrite = Effect.fnUntraced(function* (
  core: CoreState,
  held: HeldAnnotation,
  {
    write,
    settle,
    lock,
  }: {
    write: ConflictedWrite | "tags";
    settle: "re-read" | "drop";
    lock: LockReason | undefined;
  },
): Effect.fn.Return<{ value: ConfirmedWrite } | { failure: LocalApiFailure }> {
  const { queryKey, attachmentKey, record: sent } = held;
  const annotationKey = sent.key;
  if (settle === "drop") {
    return {
      value: { kind: "deleted", annotationKey, ...(lock && { lock }) },
    };
  }
  const fresh = yield* core.localApi.readAnnotation(
    annotationKey,
    attachmentKey,
  );
  if ("failure" in fresh) {
    yield* Effect.logDebug("A written annotation could not be read back").pipe(
      Effect.annotateLogs({ annotationKey, failure: fresh.failure }),
    );
    yield* core.queries.invalidate(queryKey);
    return fresh;
  }
  const record = fromLocalApi(fresh.value);
  return {
    value: {
      kind: "record",
      record,
      write: write === "delete" ? "color" : write,
    },
  };
});

const publishApiChange = Effect.fnUntraced(function* (
  core: CoreState,
  { attachmentKey, source }: { attachmentKey: string; source: LocalApiSource },
  confirmation: AnnotationConfirmation,
) {
  const previous = core.publishedLists.get(attachmentKey);
  if (
    !previous ||
    previous.source.kind !== "zotero-local-api" ||
    previous.source.serverID !== source.serverID
  )
    return false;
  const key = confirmationKey(confirmation);
  const annotations = previous.annotations.filter(
    (record) => record.key !== key,
  );
  if (confirmation.kind !== "deleted") {
    const index = previous.annotations.findIndex(
      (record) => record.key === key,
    );
    annotations.splice(
      index < 0 ? annotations.length : index,
      0,
      confirmation.record,
    );
  }
  const next = { ...previous, annotations };
  const confirmations = core.confirmedWrites.get(attachmentKey) ?? [];
  core.confirmedWrites.set(attachmentKey, [
    ...confirmations.filter((existing) => confirmationKey(existing) !== key),
    confirmation,
  ]);
  core.publishedLists.set(attachmentKey, next);
  core.publishedStatuses.set(attachmentKey, "fresh");
  if (confirmation.kind === "deleted") {
    yield* reconcileDrafts(
      core,
      { serverID: source.serverID, attachmentKey },
      annotations,
    );
  }
  yield* announceReadPixels(core, previous, next);
  return true;
});

function confirmationKey(confirmation: AnnotationConfirmation): string {
  return confirmation.kind === "deleted"
    ? confirmation.annotationKey
    : confirmation.record.key;
}

function conflictOf(
  attempt: Exclude<WriteAttempt, { write: "tags" }>,
  record: AnnotationRecord,
): WriteConflict | null {
  if (attempt.write === "geometry") {
    const fresh = { position: record.position, text: record.text };
    return sameStoredGeometry(attempt.attempted, fresh)
      ? null
      : {
          write: "geometry",
          attempted: attempt.attempted,
          input: attempt.input,
          fresh,
        };
  }
  const { write, attempted } = attempt;
  const fresh = freshValueOf(record, write);
  return resolvesSilently(write, attempted, fresh)
    ? null
    : { write, attempted, fresh };
}

function proposedGeometry(
  record: AnnotationRecord,
  edit: GeometryEdit,
): ProposedFields {
  const position = parseAnnotationPosition(
    JSON.parse(writePosition(edit.position)) as AnnotationPositionRaw,
    "application/pdf",
  );
  const quotes = record.type === "highlight" || record.type === "underline";
  return {
    ...(position.kind !== "unknown" && { position }),
    sortIndex: edit.sortIndex,
    ...(quotes &&
      edit.text !== undefined && {
        text: edit.text === "" ? null : edit.text,
      }),
  };
}

export {
  UNKNOWN_OUTCOME,
  createAnnotation,
  patchColor,
  patchColors,
  patchComment,
  writeText,
  patchGeometry,
  deleteAnnotation,
  deleteAnnotations,
  retryWrite,
  discardConflict,
  command,
  lockRefusal,
  firstHeldLockRefusal,
  writeBlocked,
};
export type { WriteReadError };
