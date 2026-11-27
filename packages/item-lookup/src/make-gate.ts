import { Effect, Latch } from "effect";

export interface Gate {
  readonly closed: boolean;
  readonly close: Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
  readonly held: Effect.Effect<void>;
  readonly rearm: Effect.Effect<void>;
  readonly pass: Effect.Effect<void>;
}

export const makeGate = (options?: {
  readonly once?: boolean;
}): Effect.Effect<Gate> =>
  Effect.gen(function* () {
    let closed = false;
    const gate = yield* Latch.make(true);
    const arrived = yield* Latch.make(false);
    return {
      get closed() {
        return closed;
      },
      close: Effect.suspend(() => {
        closed = true;
        return Effect.andThen(gate.close, arrived.close);
      }).pipe(Effect.asVoid),
      open: Effect.suspend(() => {
        closed = false;
        return gate.open;
      }).pipe(Effect.asVoid),
      held: arrived.await,
      rearm: arrived.close.pipe(Effect.asVoid),
      pass: Effect.suspend(() => {
        if (!closed) return Effect.void;
        if (options?.once) closed = false;
        return Effect.andThen(arrived.open, gate.await);
      }),
    } satisfies Gate;
  });
