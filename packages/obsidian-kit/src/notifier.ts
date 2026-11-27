import type { NoticeMessage } from "#notice.ts";
import type { Duration } from "effect";
import type { Scope } from "effect";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Option,
} from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { isUserStop } from "@zotlit/plugin-kernel/user-cancel.ts";

import { BaseNotice, LazyNotice, loadingNotice, noticeText } from "#notice.ts";

export type { NoticeMessage } from "#notice.ts";

export interface NoticeOptions {
  readonly duration?: number;
}

export interface NoticeHandle {
  readonly hide: Effect.Effect<void>;
  setMessage(message: NoticeMessage): Effect.Effect<void>;
}

export interface ProgressNotice {
  setMessage(message: NoticeMessage): Effect.Effect<void>;
}

export class Notifier extends Context.Service<
  Notifier,
  {
    show(
      message: NoticeMessage,
      options?: NoticeOptions,
    ): Effect.Effect<NoticeHandle>;
    readonly progress: Effect.Effect<ProgressNotice, never, Scope.Scope>;
    track(notice: Effect.Effect<void>): Effect.Effect<void>;
  }
>()("zotlit/obsidian/Notifier") {}

export const noticeFibers = Effect.fnUntraced(function* (
  base: Omit<Notifier["Service"], "track">,
) {
  const fibers = yield* FiberSet.make();
  return Notifier.of({
    ...base,
    track: Effect.fn("Notifier.track")(function* (notice) {
      yield* FiberSet.run(fibers, notice);
    }),
  });
});

export const layerNotifier: Layer.Layer<Notifier> = Layer.effect(
  Notifier,
  noticeFibers({
    show: Effect.fn("Notifier.show")((message, options) =>
      Effect.sync(() => {
        const notice = new BaseNotice(message, options?.duration);
        return {
          hide: Effect.sync(() => notice.hide()),
          setMessage: (next) => Effect.sync(() => void notice.setMessage(next)),
        };
      }),
    ),
    progress: Effect.map(
      Effect.acquireDisposable(Effect.sync(() => new LazyNotice())),
      (notice) => ({
        setMessage: (message) => Effect.sync(() => notice.setMessage(message)),
      }),
    ),
  }),
);

export interface ProgressCopy<A = unknown> {
  readonly loading: NoticeMessage;
  readonly success: NoticeMessage | ((result: A) => NoticeMessage);
  readonly error: NoticeMessage | ((error: unknown) => NoticeMessage);
  readonly successDuration?: Duration.Input;
}

export const reportProgress = Effect.fn("Notifier.reportProgress")(function* <
  A,
  E,
>(outcome: Effect.Effect<Exit.Exit<A, E>>, copy: ProgressCopy<A>) {
  const notifier = yield* Notifier;
  const notice = yield* notifier.progress;
  const early = yield* Effect.timeoutOption(outcome, "200 millis");
  if (Option.isNone(early))
    yield* notice.setMessage(loadingNotice(copy.loading));
  const exit = Option.isSome(early) ? early.value : yield* outcome;
  if (Exit.isSuccess(exit)) {
    const { success } = copy;
    yield* notice.setMessage(
      typeof success === "function" ? success(exit.value) : success,
    );
    yield* Effect.sleep(copy.successDuration ?? "2 seconds");
    return;
  }
  if (Cause.hasInterruptsOnly(exit.cause)) return;
  const { error } = copy;
  const message = yield* failureMessage(
    exit.cause,
    typeof error === "function" ? error : () => error,
  );
  if (message === undefined) return;
  yield* notice.setMessage(message);
  yield* Effect.sleep("4 seconds");
}, Effect.scoped);

const failureMessage = Effect.fnUntraced(function* (
  cause: Cause.Cause<unknown>,
  copy: (error: unknown) => NoticeMessage | undefined,
) {
  const error = Cause.squash(cause);
  if (isUserStop(error)) return undefined;
  const message = copy(error);
  yield* Effect.logError("Toast reported error").pipe(
    Effect.annotateLogs({
      message: message === undefined ? undefined : noticeText(message),
      error,
    }),
    withLogCategory("toast"),
  );
  return message;
});

export const withProgress = <A, E, R>(
  task: Effect.Effect<A, E, R>,
  copy: ProgressCopy<A>,
): Effect.Effect<A, E, R | Notifier> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const notifier = yield* Notifier;
      const outcome = yield* Deferred.make<Exit.Exit<A, E>>();
      yield* notifier.track(
        reportProgress(Deferred.await(outcome), copy).pipe(
          Effect.provideService(Notifier, notifier),
        ),
      );
      return yield* restore(task).pipe(
        Effect.onExit((exit) => Deferred.succeed(outcome, exit)),
      );
    }),
  );

export interface OutcomeCopy<A> {
  readonly success: (result: A) => NoticeMessage | undefined;
  readonly error: (error: unknown) => NoticeMessage | undefined;
}

export const reportOutcome = Effect.fn("Notifier.reportOutcome")(function* <
  A,
  E,
  R,
>(task: Effect.Effect<A, E, R>, copy: OutcomeCopy<A>) {
  const notifier = yield* Notifier;
  const exit = yield* Effect.exit(task);
  if (Exit.isSuccess(exit)) {
    const message = copy.success(exit.value);
    if (message) yield* notifier.show(message, { duration: 2000 });
    return;
  }
  if (Cause.hasInterruptsOnly(exit.cause))
    return yield* Effect.failCause(exit.cause);
  const message = yield* failureMessage(exit.cause, copy.error);
  if (message) yield* notifier.show(message, { duration: 4000 });
});

export const withOutcome = <A, E, R>(
  task: Effect.Effect<A, E, R>,
  copy: OutcomeCopy<A>,
): Effect.Effect<A, E, R | Notifier> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(task);
    yield* reportOutcome(exit, copy);
    return yield* exit;
  });
