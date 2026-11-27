import type { Scope } from "effect";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";

import { UserCancelled } from "@zotlit/plugin-kernel/user-cancel.ts";
import type { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";
import type { WebSyncStatus } from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";

import type { SyncStop, SyncStopState } from "./status.ts";

export interface SyncWorker {
  StopSync(request: {
    readonly syncId: number;
  }): Effect.Effect<boolean, unknown>;
}

export type SyncOutcome = Exit.Exit<void, DbUnavailable | UserCancelled>;

export interface SyncRun {
  readonly done: Deferred.Deferred<void, DbUnavailable | UserCancelled>;
}

export const refreshOutcome = (
  refreshed: Exit.Exit<void, DbUnavailable>,
  checked: Exit.Exit<WebSyncStatus, DbUnavailable>,
): Effect.Effect<WebSyncStatus, DbUnavailable | UserCancelled> => {
  if (Exit.isSuccess(refreshed)) return checked;
  if (Exit.isSuccess(checked) && checked.value.problem?._tag === "stopped")
    return Effect.andThen(
      Effect.logDebug("The sync ended on the user's stop"),
      Effect.fail(new UserCancelled()),
    );
  return Effect.failCause(refreshed.cause);
};

interface Run<W extends SyncWorker> extends SyncRun {
  readonly worker: W;
  readonly key: string;
  fiber: Fiber.Fiber<void> | null;
  superseded: boolean;
}

interface StopRequest<W extends SyncWorker> extends SyncStop {
  readonly worker: W;
  readonly answered: Deferred.Deferred<void>;
}

export const makeSyncRuns = <W extends SyncWorker>(options: {
  readonly stopped: () => DbUnavailable;
  readonly changed: Effect.Effect<void>;
}) => {
  let run: Run<W> | null = null;
  let stop: StopRequest<W> | null = null;

  const finish = (entry: Run<W>, outcome: SyncOutcome) =>
    Deferred.doneUnsafe(entry.done, outcome);

  const settled = (
    exit: Exit.Exit<void, DbUnavailable | UserCancelled>,
  ): SyncOutcome => {
    if (Exit.isSuccess(exit)) return exit;
    const failure = Cause.findErrorOption(exit.cause);
    return failure._tag === "Some"
      ? Exit.fail(failure.value)
      : Exit.fail(options.stopped());
  };

  const begin = ({
    worker,
    key,
    scope,
    refresh,
  }: {
    readonly worker: W;
    readonly key: string;
    readonly scope: Scope.Scope;
    readonly refresh: Effect.Effect<void, DbUnavailable | UserCancelled>;
  }): Effect.Effect<SyncRun> =>
    Effect.suspend(() => {
      const before = run;
      if (before?.worker === worker && before.key === key)
        return Effect.succeed(before);
      const superseded = before?.worker === worker ? before : null;
      const entry: Run<W> = {
        worker,
        key,
        done:
          superseded?.done ??
          Deferred.makeUnsafe<void, DbUnavailable | UserCancelled>(),
        fiber: null,
        superseded: false,
      };
      if (superseded) superseded.superseded = true;
      if (before && !superseded) finish(before, Exit.fail(options.stopped()));
      run = entry;
      return Effect.gen(function* () {
        entry.fiber = yield* Effect.forkIn(
          refresh.pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (run === entry && !entry.superseded) run = null;
                if (entry.superseded) return;
                finish(entry, settled(exit));
              }),
            ),
            Effect.ignore,
          ),
          scope,
          { startImmediately: true },
        );
        if (superseded?.fiber)
          yield* Effect.forkIn(Fiber.interrupt(superseded.fiber), scope);
        return entry;
      });
    });

  const stopSync = (worker: W, syncId: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      const before = stop?.worker === worker ? stop : null;
      if (before?.syncId === syncId && before.state === "requested")
        return Deferred.await(before.answered);
      if (before?.syncId === syncId && before.state !== "failed")
        return Effect.void;
      return Effect.acquireUseRelease(
        Effect.suspend(() => {
          const request: StopRequest<W> = {
            worker,
            syncId,
            state: "requested",
            answered: Deferred.makeUnsafe<void>(),
          };
          stop = request;
          return Effect.as(options.changed, request);
        }),
        () => worker.StopSync({ syncId }),
        (request, exit) =>
          Effect.gen(function* () {
            const state: SyncStopState = Exit.isSuccess(exit)
              ? exit.value
                ? "confirmed"
                : "refused"
              : "failed";
            if (Exit.isFailure(exit))
              yield* Effect.logWarning(
                "The request to stop the sync got no answer from the Worker",
                exit.cause,
              );
            else
              yield* Effect.logDebug(
                exit.value
                  ? "The Worker stopped the sync"
                  : "The Worker refused to stop the sync",
              ).pipe(Effect.annotateLogs({ syncId }));
            if (stop === request) stop = { ...request, state };
            Deferred.doneUnsafe(request.answered, Exit.void);
            yield* options.changed;
          }),
      ).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.void,
        ),
      );
    });

  return {
    begin,
    current: (worker: W | null): SyncRun | null =>
      worker !== null && run?.worker === worker ? run : null,
    supersede: (worker: W) => {
      if (run?.worker === worker) run.superseded = true;
    },
    detach: (worker: W) => {
      const left = run;
      if (left?.worker === worker) {
        run = null;
        finish(left, Exit.fail(options.stopped()));
      }
      if (stop?.worker === worker) stop = null;
    },
    stop: stopSync,
    view: (worker: W | null, syncId: number | null): SyncStop | null =>
      worker !== null && stop?.worker === worker && stop.syncId === syncId
        ? { syncId: stop.syncId, state: stop.state }
        : null,
  };
};
