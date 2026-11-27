import type { SourceIdentity } from "#contract/source-identity.ts";
import type {
  ReplicaApplyTimes,
  WebSyncProblem,
  WebSyncStatus,
} from "#contract/web-worker-rpc.ts";
import type { Duration } from "effect";
import {
  Clock,
  Deferred,
  Effect,
  Exit,
  FiberSet,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";

import type { ZoteroDatabase } from "@zotlit/db";
import { checkDatabaseLayout } from "@zotlit/db/item-query";
import { createReplica, ensureSyncTables } from "@zotlit/db/replica";
import { monotonicMillis } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";
import {
  describeStorageFailure,
  readSyncStatus,
  replicaLocale,
} from "@zotlit/web-library";
import type {
  AppliedLibrary,
  ApplyStep,
  ReplicaStage,
} from "@zotlit/web-library";

import type { OpenClient } from "./connection.ts";
import {
  makeClientRef,
  makeDatabaseGenerations,
  webApiSourceIdentity,
} from "./connection.ts";
import { makeReadGate } from "./read-gate.ts";
import type {
  ReplicaDriver,
  ReplicaHandle,
  ReplicaWrites,
} from "./replica-driver.ts";

import { DbUnavailable } from "#contract/rpc.ts";

export const APPLY_SLICE_MILLIS = 8;

export interface Readable {
  readonly state: "loading" | "ready" | "degraded";
  readonly error: DbUnavailable | null;
}

export interface ReplicaObserver {
  readonly staged: (writes: ReplicaWrites) => void;
  readonly applied: (writes: ReplicaWrites, times: ReplicaApplyTimes) => void;
  readonly maintained?: (writes: ReplicaWrites) => void;
}

export interface ReplicaStoreOptions {
  readonly driver: Effect.Effect<ReplicaDriver, DbUnavailable>;
  readonly file: string;
  readonly readable: SubscriptionRef.SubscriptionRef<Readable>;
  readonly onUnavailable?: (problem: WebSyncProblem) => Effect.Effect<void>;
  readonly holdBack?: Duration.Input;
  readonly sliceMillis?: number;
  readonly betweenSlices?: Effect.Effect<void>;
  readonly observer?: ReplicaObserver;
}

export interface CommittedReplica {
  readonly libraries: WebSyncStatus["libraries"];
  readonly zoteroLocale: string | null;
  readonly identity: SourceIdentity | null;
}

export interface ApplyRequest {
  readonly steps: (
    db: ZoteroDatabase,
  ) => Iterator<ApplyStep, readonly AppliedLibrary[]>;
  readonly visible: (applied: readonly AppliedLibrary[]) => boolean;
  readonly onProgress?: (step: ApplyStep) => void;
  readonly onWaiting?: () => void;
  readonly onCommit?: Effect.Effect<void>;
}

export type ReplicaStoreState =
  | "closed"
  | "open"
  | "applying"
  | "publishing"
  | "recovering"
  | "unavailable";

export interface ReplicaStoreReport {
  readonly state: ReplicaStoreState;
  readonly committed: CommittedReplica;
  readonly lastApply: ReplicaApplyTimes | null;
  readonly fileProblem: WebSyncProblem | null;
  readonly waitingForReaders: boolean;
}

export interface ReplicaStore {
  readonly open: Effect.Effect<void, WebSyncProblem>;
  readonly borrow: Effect.Effect<ZoteroDatabase, DbUnavailable, Scope.Scope>;
  readonly stage: ReplicaStage;
  readonly apply: (
    request: ApplyRequest,
  ) => Effect.Effect<boolean, WebSyncProblem>;
  readonly downloadEnded: Effect.Effect<void>;
  readonly libraries: Effect.Effect<CommittedReplica, WebSyncProblem>;
  readonly report: () => ReplicaStoreReport;
  readonly empty: (
    announce?: Effect.Effect<void>,
  ) => Effect.Effect<void, WebSyncProblem>;
  readonly remove: (
    announce?: Effect.Effect<void>,
  ) => Effect.Effect<void, WebSyncProblem>;
  readonly databaseGeneration: (client: ZoteroDatabase) => number;
}

type Phase =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Open"; readonly handle: ReplicaHandle }
  | { readonly _tag: "Applying"; readonly handle: ReplicaHandle }
  | { readonly _tag: "Publishing"; readonly handle: ReplicaHandle }
  | {
      readonly _tag: "Recovering";
      readonly handle: ReplicaHandle;
      readonly done: Deferred.Deferred<void>;
    }
  | { readonly _tag: "Unavailable"; readonly problem: WebSyncProblem };

interface StoreState {
  readonly phase: Phase;
  readonly committed: CommittedReplica;
  readonly lastApply: ReplicaApplyTimes | null;
  readonly fileProblem: WebSyncProblem | null;
}

const NOTHING_COMMITTED: CommittedReplica = {
  libraries: [],
  zoteroLocale: null,
  identity: null,
};

const REPORTED: Record<Phase["_tag"], ReplicaStoreState> = {
  Closed: "closed",
  Open: "open",
  Applying: "applying",
  Publishing: "publishing",
  Recovering: "recovering",
  Unavailable: "unavailable",
};

const logWarning = (
  message: string,
  annotations: Record<string, unknown> = {},
) =>
  Effect.logWarning(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads", "web-api"),
  );

const storage = <A>(what: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause): WebSyncProblem => ({
      _tag: "storage",
      ...describeStorageFailure(what, cause),
    }),
  });

const unavailableProblem = (cause: DbUnavailable): WebSyncProblem => ({
  _tag: "storage",
  reason: "failed",
  message: cause.message,
});

function readLibraries(db: ZoteroDatabase): WebSyncStatus["libraries"] {
  return readSyncStatus(db)
    .filter((library) => library.lastSync !== null)
    .map((library) => ({
      library: library.library,
      committedVersion: library.committedVersion,
      lastSync: library.lastSync,
      retained: library.retained,
    }));
}

function writesOf(writer: ReplicaHandle): ReplicaWrites {
  return { statements: writer.statements(), changes: writer.changes() };
}

function since(writer: ReplicaHandle, before: ReplicaWrites): ReplicaWrites {
  return {
    statements: writer.statements() - before.statements,
    changes: writer.changes() - before.changes,
  };
}

function handleOf(phase: Phase): ReplicaHandle | null {
  return "handle" in phase ? phase.handle : null;
}

function prepare(db: ZoteroDatabase): void {
  const empty = db.get("select 1 from sqlite_master limit 1") === undefined;
  if (empty) createReplica(db);
  else ensureSyncTables(db);
  checkDatabaseLayout(db);
}

export const makeReplicaStore = Effect.fnUntraced(function* (
  options: ReplicaStoreOptions,
): Effect.fn.Return<ReplicaStore, never, Scope.Scope> {
  const { file, readable, observer } = options;
  const onUnavailable = options.onUnavailable ?? (() => Effect.void);
  const sliceMillis = options.sliceMillis ?? APPLY_SLICE_MILLIS;
  const betweenSlices = options.betweenSlices ?? Effect.yieldNow;
  const gate = yield* makeReadGate(options.holdBack);
  const runFork = yield* FiberSet.makeRuntime();
  const generations = makeDatabaseGenerations();
  let driver: ReplicaDriver | null = null;
  let state: StoreState = {
    phase: { _tag: "Closed" },
    committed: NOTHING_COMMITTED,
    lastApply: null,
    fileProblem: null,
  };
  let moved = Deferred.makeUnsafe<void>();

  const move = (next: Partial<StoreState>) => {
    state = { ...state, ...next };
    const waiting = moved;
    moved = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(waiting, Exit.void);
  };

  const transitions = {
    served: (handle: ReplicaHandle, committed: CommittedReplica) =>
      move({ phase: { _tag: "Open", handle }, committed }),
    began: (handle: ReplicaHandle) =>
      move({ phase: { _tag: "Applying", handle } }),
    committed: (handle: ReplicaHandle) =>
      move({ phase: { _tag: "Publishing", handle } }),
    measured: (lastApply: ReplicaApplyTimes) => move({ lastApply }),
    rolledBack: (handle: ReplicaHandle) =>
      move({ phase: { _tag: "Open", handle } }),
    rollbackFailed: (handle: ReplicaHandle, done: Deferred.Deferred<void>) =>
      move({ phase: { _tag: "Recovering", handle, done } }),
    closed: () =>
      move({ phase: { _tag: "Closed" }, committed: NOTHING_COMMITTED }),
    removed: () =>
      move({
        phase: { _tag: "Closed" },
        committed: NOTHING_COMMITTED,
        lastApply: null,
        fileProblem: null,
      }),
    unavailable: (problem: WebSyncProblem) =>
      move({
        phase: { _tag: "Unavailable", problem },
        committed: NOTHING_COMMITTED,
      }),
    checkpointed: (fileProblem: WebSyncProblem | null) => move({ fileProblem }),
    reread: (committed: CommittedReplica) => move({ committed }),
  };

  const notOpen = (message: string) =>
    SubscriptionRef.getUnsafe(readable).error ?? new DbUnavailable({ message });

  const wrap = (db: ZoteroDatabase) =>
    Effect.gen(function* () {
      const open: OpenClient = { client: db, close: Effect.void };
      yield* generations.record(open, null);
      return open;
    });

  const clients = yield* makeClientRef(
    Effect.suspend(() => {
      const handle = handleOf(state.phase);
      return handle
        ? wrap(handle.db)
        : Effect.fail(notOpen("The replica is not open"));
    }),
  );

  const serve = (db: ZoteroDatabase) =>
    Effect.flatMap(
      Effect.mapError(wrap(db), (cause) => unavailableProblem(cause)),
      (next) => clients.swap(next),
    );

  const lastCommitOf = (db: ZoteroDatabase) =>
    Effect.gen(function* () {
      const libraries = yield* storage(
        "The replica could not read its libraries",
        () => readLibraries(db),
      );
      const zoteroLocale = yield* storage(
        "The replica could not read its language",
        () => replicaLocale(db),
      );
      const identity = yield* Effect.mapError(
        webApiSourceIdentity(db),
        (cause): WebSyncProblem => ({
          _tag: "storage",
          reason: "failed",
          message: `The replica could not read its account: ${cause.message}`,
        }),
      );
      return { libraries, zoteroLocale, identity } satisfies CommittedReplica;
    }).pipe(
      Effect.tapError((problem) =>
        logWarning("The replica could not read its last commit", {
          problem: problem.message,
        }),
      ),
    );

  const loadDriver = Effect.suspend(() =>
    driver
      ? Effect.succeed(driver)
      : Effect.tap(
          Effect.mapError(options.driver, (cause) => unavailableProblem(cause)),
          (loaded) =>
            Effect.sync(() => {
              driver = loaded;
            }),
        ),
  );

  const becomeUnavailable = (problem: WebSyncProblem) =>
    Effect.gen(function* () {
      transitions.unavailable(problem);
      yield* clients.reset;
      yield* onUnavailable(problem);
    });

  const openFile = (replacing: ReplicaHandle | null = null) =>
    Effect.gen(function* () {
      const loaded = yield* loadDriver;
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const current = handleOf(state.phase);
          if (current && current !== replacing) return;
          const opened = yield* storage("The replica could not open", () => {
            const next = loaded.open(file);
            try {
              prepare(next.db);
              return next;
            } catch (cause) {
              next.close();
              throw cause;
            }
          });
          const committed = yield* Effect.andThen(
            serve(opened.db),
            lastCommitOf(opened.db),
          ).pipe(Effect.tapError(() => Effect.sync(() => opened.close())));
          transitions.served(opened, committed);
        }),
      );
    }).pipe(Effect.tapError((problem) => becomeUnavailable(problem)));

  const closeQuietly = (writer: ReplicaHandle, why: string) =>
    Effect.sync(() => writer.close()).pipe(
      Effect.catchDefect((cause) =>
        logWarning("The replica could not close its file", {
          why,
          problem: String(cause),
        }),
      ),
    );

  const closeHandle = Effect.gen(function* () {
    const closing = handleOf(state.phase);
    transitions.closed();
    closing?.close();
    yield* clients.reset;
  });

  const removeFiles = Effect.gen(function* () {
    yield* closeHandle;
    const loaded = yield* Effect.mapError(
      loadDriver,
      (cause): WebSyncProblem => ({
        ...cause,
        message: `The replica could not be removed: ${cause.message}`,
      }),
    );
    yield* storage("The replica could not be removed", () =>
      loaded.remove(file),
    );
    transitions.removed();
  }).pipe(Effect.tapError((problem) => becomeUnavailable(problem)));

  const reopen = (
    writer: ReplicaHandle,
    why: string,
    problem: WebSyncProblem,
  ) =>
    Effect.gen(function* () {
      yield* closeQuietly(writer, why);
      yield* logWarning(`The replica opens its file again after ${why}`, {
        problem: problem.message,
      });
      yield* openFile(writer);
    });

  const recover = (
    writer: ReplicaHandle,
    what: string,
    done: Deferred.Deferred<void>,
  ) =>
    storage(`The replica could not roll back ${what}`, () => {
      if (writer.inTransaction()) writer.exec("rollback");
    }).pipe(
      Effect.tap(() => Effect.sync(() => transitions.rolledBack(writer))),
      Effect.catch((rollback) =>
        Effect.andThen(
          Effect.sync(() => {
            if (state.phase._tag !== "Recovering")
              transitions.rollbackFailed(writer, done);
          }),
          reopen(writer, "a failed rollback", rollback),
        ),
      ),
      Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(done, Exit.void))),
    );

  const admitted = (): DbUnavailable | "wait" | "admit" => {
    const source = SubscriptionRef.getUnsafe(readable);
    if (source.state === "degraded")
      return (
        source.error ??
        new DbUnavailable({ message: "The replica is not available" })
      );
    if (source.state === "loading") return "wait";
    const { phase } = state;
    if (phase._tag === "Unavailable")
      return new DbUnavailable({ message: phase.problem.message });
    if (phase._tag === "Closed") return notOpen("The replica is not open");
    if (phase._tag === "Recovering") return "wait";
    return "admit";
  };

  const waitForChange = Effect.suspend(() => {
    const next = moved;
    return SubscriptionRef.getUnsafe(readable).state === "loading"
      ? Stream.runHead(
          Stream.filter(
            SubscriptionRef.changes(readable),
            (source) => source.state !== "loading",
          ),
        )
      : Deferred.await(next);
  });

  const admission = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      while (true) {
        const before = admitted();
        if (before === "wait") {
          yield* restore(waitForChange);
          continue;
        }
        if (before !== "admit") return yield* before;
        const entry = yield* Scope.make();
        yield* restore(Scope.provide(gate.enter, entry)).pipe(
          Effect.onInterrupt(() => Scope.close(entry, Exit.void)),
        );
        if (admitted() === "admit") {
          yield* Effect.addFinalizer(() => Scope.close(entry, Exit.void));
          return;
        }
        yield* Scope.close(entry, Exit.void);
      }
    }),
  );

  const stage: ReplicaStage = (write) => {
    const { phase } = state;
    if (phase._tag !== "Open") throw new Error("The replica is not open");
    const writer = phase.handle;
    let written: ReturnType<typeof write> | undefined;
    const before = observer ? writesOf(writer) : null;
    try {
      writer.db.transaction((tx) => {
        written = write(tx);
      });
    } catch (cause) {
      if (writer.inTransaction()) {
        const done = Deferred.makeUnsafe<void>();
        transitions.rollbackFailed(writer, done);
        runFork(
          gate
            .exclusive(recover(writer, "a staging write", done))
            .pipe(Effect.ignore),
        ).addObserver(() => Deferred.doneUnsafe(done, Exit.void));
      }
      throw cause;
    }
    if (before) observer?.staged(since(writer, before));
    return written!;
  };

  const checkpointOf = (writer: ReplicaHandle, after: string) =>
    storage(`The replica could not checkpoint its file after ${after}`, () =>
      writer.checkpoint(),
    ).pipe(
      Effect.tap(() => Effect.sync(() => transitions.checkpointed(null))),
      Effect.catch((problem) =>
        Effect.andThen(
          Effect.sync(() => transitions.checkpointed(problem)),
          logWarning("The replica could not checkpoint its file", {
            after,
            problem: problem.message,
          }),
        ),
      ),
    );

  const downloadEnded = Effect.suspend(() => {
    const { phase } = state;
    if (phase._tag !== "Open") return Effect.void;
    const writer = phase.handle;
    const before = observer ? writesOf(writer) : null;
    return Effect.gen(function* () {
      yield* checkpointOf(writer, "a download");
      if (before) observer?.maintained?.(since(writer, before));
      const committed = yield* Effect.result(lastCommitOf(writer.db));
      if (committed._tag === "Failure")
        return yield* becomeUnavailable(committed.failure);
      if (handleOf(state.phase) === writer)
        transitions.reread(committed.success);
    });
  });

  const applyIn = (writer: ReplicaHandle, request: ApplyRequest) =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const elapsed = monotonicMillis(clock);
      let done: readonly AppliedLibrary[] | null = null;
      const before = observer ? writesOf(writer) : null;
      const beganAt = clock.currentTimeMillisUnsafe();
      const began = elapsed();
      const steps = yield* storage(
        "The replica could not begin the apply",
        () => {
          writer.exec("begin immediate");
          return request.steps(writer.db);
        },
      );
      const slice = storage("The replica could not apply the download", () => {
        const start = elapsed();
        do {
          const next = steps.next();
          if (next.done) {
            done = next.value;
            return;
          }
          request.onProgress?.(next.value);
        } while (elapsed() - start < sliceMillis);
      });
      yield* Effect.interruptible(
        Effect.gen(function* () {
          while (true) {
            yield* slice;
            if (done !== null) return;
            yield* betweenSlices;
          }
        }),
      );
      yield* storage("The replica could not commit the apply", () =>
        writer.exec("commit"),
      );
      transitions.committed(writer);
      return {
        applied: done!,
        times: {
          beganAt,
          committedAt: clock.currentTimeMillisUnsafe(),
          applyMillis: elapsed() - began,
        },
        writes: before ? since(writer, before) : null,
      };
    });

  const publish = (writer: ReplicaHandle, changed: boolean) =>
    Effect.gen(function* () {
      const renewed = yield* Effect.gen(function* () {
        const db = changed
          ? yield* storage("The replica could not renew its client", () =>
              writer.renew(),
            )
          : writer.db;
        const committed = yield* lastCommitOf(db);
        if (changed) yield* serve(db);
        return committed;
      }).pipe(Effect.result);
      if (renewed._tag === "Success")
        return { writer, committed: renewed.success };
      yield* reopen(
        writer,
        "a commit that it could not publish",
        renewed.failure,
      );
      const reopened = handleOf(state.phase)!;
      return { writer: reopened, committed: state.committed };
    });

  const apply = (request: ApplyRequest) =>
    Effect.gen(function* () {
      yield* open;
      return yield* gate.exclusiveTimed(
        (closedMillis) =>
          Effect.gen(function* () {
            const { phase } = state;
            if (phase._tag !== "Open")
              return yield* Effect.fail<WebSyncProblem>({
                _tag: "storage",
                reason: "failed",
                message: "The replica is not open",
              });
            const writer = phase.handle;
            transitions.began(writer);
            const exit = yield* Effect.exit(applyIn(writer, request));
            if (Exit.isFailure(exit)) {
              const recovered = yield* Effect.exit(
                recover(writer, "the apply", Deferred.makeUnsafe<void>()),
              );
              if (Exit.isFailure(recovered))
                return yield* Effect.failCause(recovered.cause);
              return yield* Effect.failCause(exit.cause);
            }
            const { applied, times, writes } = exit.value;
            const changed = request.visible(applied);
            const published = yield* publish(writer, changed);
            transitions.served(published.writer, published.committed);
            if (changed && request.onCommit) yield* request.onCommit;
            const beforeCheckpoint = published.writer.statements();
            yield* checkpointOf(published.writer, "an apply");
            const checkpointed =
              published.writer.statements() - beforeCheckpoint;
            const measured: ReplicaApplyTimes = {
              sequence: (state.lastApply?.sequence ?? 0) + 1,
              ...times,
              closedMillis: closedMillis(),
            };
            transitions.measured(measured);
            if (writes)
              observer?.applied(
                {
                  statements: writes.statements + checkpointed,
                  changes: writes.changes,
                },
                measured,
              );
            return changed;
          }),
        request.onWaiting,
      );
    });

  const open: Effect.Effect<void, WebSyncProblem> = Effect.suspend(() => {
    const { phase } = state;
    if (phase._tag === "Recovering")
      return Effect.andThen(Deferred.await(phase.done), open);
    if (handleOf(phase)) return Effect.void;
    return openFile();
  });

  const libraries = Effect.suspend(() => {
    const { phase, committed } = state;
    return phase._tag === "Unavailable"
      ? Effect.fail(phase.problem)
      : Effect.succeed(committed);
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      handleOf(state.phase)?.close();
      transitions.closed();
      driver?.close();
      driver = null;
    }),
  );

  return {
    open,
    borrow: Effect.andThen(admission, clients.borrow),
    stage,
    apply,
    downloadEnded,
    libraries,
    report: () => ({
      state: REPORTED[state.phase._tag],
      committed: state.committed,
      lastApply: state.lastApply,
      fileProblem: state.fileProblem,
      waitingForReaders: gate.waiting(),
    }),
    empty: (announce = Effect.void) =>
      gate.exclusive(
        Effect.gen(function* () {
          yield* announce;
          yield* removeFiles;
          yield* openFile();
        }),
      ),
    remove: (announce = Effect.void) =>
      gate.exclusive(Effect.andThen(announce, removeFiles)),
    databaseGeneration: generations.databaseGeneration,
  } satisfies ReplicaStore;
});
