import type { Scope } from "effect";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Latch,
  Semaphore,
} from "effect";

import { monotonicMillis } from "@zotlit/plugin-kernel/worker/effect-clock.ts";

export const READ_GATE_HOLD_BACK = Duration.seconds(1);

export interface ReadGate {
  readonly enter: Effect.Effect<void, never, Scope.Scope>;
  readonly exclusive: <A, E>(
    run: Effect.Effect<A, E>,
    onBlocked?: () => void,
  ) => Effect.Effect<A, E>;
  readonly exclusiveTimed: <A, E>(
    run: (closedMillis: () => number) => Effect.Effect<A, E>,
    onBlocked?: () => void,
  ) => Effect.Effect<A, E>;
  readonly waiting: () => boolean;
}

export const makeReadGate = Effect.fnUntraced(function* (
  holdBack: Duration.Input = READ_GATE_HOLD_BACK,
) {
  const open = yield* Latch.make(true);
  const writers = yield* Semaphore.make(1);
  const holders = new Set<number>();
  let next = 0;
  let waiting = false;
  const elapsed = monotonicMillis(yield* Clock.Clock);
  let watch: {
    readonly tokens: ReadonlySet<number> | null;
    readonly done: Deferred.Deferred<void>;
  } | null = null;

  const settle = () => {
    if (!watch) return;
    const held = watch.tokens
      ? [...watch.tokens].some((token) => holders.has(token))
      : holders.size > 0;
    if (!held) Deferred.doneUnsafe(watch.done, Exit.void);
  };

  const released = (tokens: ReadonlySet<number> | null) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        watch = { tokens, done: Deferred.makeUnsafe<void>() };
        settle();
        return watch.done;
      }),
      (done) => Deferred.await(done),
      () =>
        Effect.sync(() => {
          watch = null;
        }),
    );

  const leave = (token: number) =>
    Effect.sync(() => {
      holders.delete(token);
      settle();
    });

  const enter = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      while (true) {
        yield* restore(open.await);
        if (!Latch.isOpen(open)) continue;
        const token = next++;
        holders.add(token);
        yield* Effect.addFinalizer(() => leave(token));
        return;
      }
    }),
  );

  const exclusiveTimed = <A, E>(
    run: (closedMillis: () => number) => Effect.Effect<A, E>,
    onBlocked?: () => void,
  ): Effect.Effect<A, E> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        waiting = true;
        while (true) {
          yield* open.close;
          const closedAt = elapsed();
          yield* restore(
            released(null).pipe(Effect.timeoutOption(holdBack), Effect.asVoid),
          );
          if (holders.size === 0) {
            waiting = false;
            return yield* run(() => elapsed() - closedAt);
          }
          const blockers = new Set(holders);
          onBlocked?.();
          yield* open.open;
          yield* restore(released(blockers));
        }
      }).pipe(
        Effect.ensuring(
          Effect.andThen(
            Effect.sync(() => {
              waiting = false;
            }),
            open.open,
          ),
        ),
      ),
    ).pipe(writers.withPermits(1));

  const exclusive = <A, E>(
    run: Effect.Effect<A, E>,
    onBlocked?: () => void,
  ): Effect.Effect<A, E> => exclusiveTimed(() => run, onBlocked);

  return {
    enter,
    exclusive,
    waiting: () => waiting,
    exclusiveTimed,
  } satisfies ReadGate;
});
