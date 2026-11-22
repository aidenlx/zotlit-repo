import { Cause, Deferred, Effect, Exit, Option, Ref, Stream } from "effect";

import { formatErrorMessage } from "@zotlit/obsidian-kit/toast.ts";
import { exitOver, valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { settleAtEdge } from "@zotlit/plugin-kernel/signal-edge.ts";

export interface BatchFailure {
  label: string;
  message: string;
  recovery?: { action: "switch-profile"; path: string };
}

export interface BatchClassifyControls {
  onProgress: (classified: number) => void;
  signal: AbortSignal;
}

export interface BatchRunControls {
  onItemSettled: (
    event:
      | { id: number; status: "done" }
      | { id: number; status: "skipped" }
      | { id: number; status: "failed"; failure: BatchFailure },
  ) => void;
  stop: Deferred.Deferred<void>;
}

export function makeStopRequest(): {
  stop: BatchRunControls["stop"];
  request: () => void;
} {
  const stop = Deferred.makeUnsafe<void>();
  return {
    stop,
    request: () => {
      Deferred.doneUnsafe(stop, Exit.void);
    },
  };
}

export interface BatchRunResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
}

export function classifyStream<A, E>(
  {
    itemIDs,
    read,
  }: {
    itemIDs: readonly number[];
    read: (itemIDs: readonly number[]) => Stream.Stream<readonly A[], E>;
  },
  controls: Pick<BatchClassifyControls, "onProgress">,
  processSlice: (slice: readonly A[]) => void,
): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    function* requests() {
      for (let start = 0; start < itemIDs.length; start += 500) {
        yield itemIDs.slice(start, start + 500);
      }
    }
    const slices = Stream.fromIterable(requests(), { chunkSize: 1 }).pipe(
      Stream.flatMap((ids) => read(ids)),
    );
    let classified = 0;
    yield* Stream.runForEach(slices, (slice) =>
      Effect.sync(() => {
        processSlice(slice);
        classified += slice.length;
        controls.onProgress(classified);
      }),
    );
  });
}

export interface BatchRunTask {
  id: number;
  label: string;
}

export type RunOutcome = "created" | "updated" | "skipped";

export function executeBatchRun<T extends BatchRunTask, E>(opts: {
  tasks: readonly T[];
  controls: BatchRunControls;
  concurrency: number;
  run: (task: T) => Effect.Effect<RunOutcome, E>;
  onTaskFailed?: (task: T, error: unknown) => void;
  haltOn?: (error: E) => boolean;
}): Effect.Effect<BatchRunResult, E> {
  const { tasks, controls, concurrency, run, onTaskFailed, haltOn } = opts;

  return Effect.gen(function* () {
    const result = yield* Ref.make<BatchRunResult>({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
    });
    const halt = yield* Ref.make<Cause.Cause<E> | null>(null);
    const settled = yield* Effect.forEach(
      tasks,
      (task) =>
        Effect.exit(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              if (yield* Deferred.isDone(controls.stop))
                return yield* Effect.interrupt;
              if ((yield* Ref.get(halt)) !== null)
                return yield* Effect.interrupt;
              const exit = yield* Effect.exit(restore(run(task)));
              if (Exit.isFailure(exit)) {
                if (Cause.hasInterruptsOnly(exit.cause))
                  return yield* Effect.failCause(exit.cause);
                const error = Cause.squash(exit.cause);
                const failure = Cause.findErrorOption(exit.cause);
                if (haltOn && Option.isSome(failure) && haltOn(failure.value)) {
                  yield* Ref.update(halt, (current) => current ?? exit.cause);
                  return yield* Effect.interrupt;
                }
                const recovery = profileRecovery(error);
                yield* Effect.sync(() =>
                  controls.onItemSettled({
                    id: task.id,
                    status: "failed",
                    failure: {
                      label: task.label,
                      message: formatErrorMessage(error),
                      ...(recovery ? { recovery } : {}),
                    },
                  }),
                );
                return yield* Effect.failCause(exit.cause);
              }

              const outcome = exit.value;
              yield* Ref.update(result, (current) => ({
                ...current,
                [outcome]: current[outcome] + 1,
              }));
              const status: "done" | "skipped" =
                outcome === "skipped" ? "skipped" : "done";
              yield* Effect.sync(() =>
                controls.onItemSettled({ id: task.id, status }),
              );
            }),
          ),
        ),
      { concurrency },
    );

    let completed = 0;
    for (const [i, entry] of settled.entries()) {
      if (Exit.isSuccess(entry)) {
        completed += 1;
      } else if (!Cause.hasInterruptsOnly(entry.cause)) {
        const error = Cause.squash(entry.cause);
        yield* Ref.update(result, (current) => ({
          ...current,
          failed: current.failed + 1,
        }));
        completed += 1;
        onTaskFailed?.(tasks[i]!, error);
      }
    }

    const halted = yield* Ref.get(halt);
    if (halted !== null) return yield* Effect.failCause(halted);
    const stopped = yield* Deferred.isDone(controls.stop);
    yield* Ref.update(result, (current) => ({
      ...current,
      cancelled: stopped && completed < tasks.length,
    }));
    return yield* Ref.get(result);
  });
}

function profileRecovery(error: unknown): BatchFailure["recovery"] {
  if (!Error.isError(error) || !("diagnostic" in error)) return undefined;
  const diagnostic = error.diagnostic;
  if (
    typeof diagnostic !== "object" ||
    diagnostic === null ||
    !("code" in diagnostic) ||
    diagnostic.code !== "unknown-literature-note-profile" ||
    !("path" in diagnostic) ||
    typeof diagnostic.path !== "string" ||
    !diagnostic.path
  )
    return undefined;
  return { action: "switch-profile", path: diagnostic.path };
}

export function runBatchWith<R = never>(
  runExit: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Exit.Exit<A, E>>,
) {
  return async <A, E>(
    effect: Effect.Effect<A, E, R>,
    signal?: AbortSignal,
  ): Promise<A> => {
    signal?.throwIfAborted();
    const exit = await runExit(
      effect,
      signal === undefined ? undefined : { signal },
    );
    return settleAtEdge(exit, signal);
  };
}

export const modalRunner = Effect.fnUntraced(function* <R>(
  bridge: Pick<EffectBridge, "runPromiseExit">,
) {
  const runExit = exitOver(bridge, yield* Effect.context<R>());
  return {
    run: runBatchWith(runExit),
    settle: async <A, E>(
      effect: Effect.Effect<A, E, R>,
    ): Promise<A | undefined> =>
      valueOr<A | undefined, E>(await runExit(effect), undefined),
  };
});
