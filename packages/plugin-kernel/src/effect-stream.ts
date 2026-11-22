import type { ManagedRuntime, Scope } from "effect";
import { Effect, Stream } from "effect";

import { logAndContinue } from "#effect-log.ts";
import { isScopeClosed } from "#effect-scope.ts";

export function filterTag<
  A extends { readonly _tag: string },
  T extends A["_tag"],
>(
  stream: Stream.Stream<A>,
  ...tags: [T, ...T[]]
): Stream.Stream<Extract<A, { _tag: T }>> {
  const wanted = new Set<string>(tags);
  return stream.pipe(
    Stream.filter((event): event is Extract<A, { _tag: T }> =>
      wanted.has(event._tag),
    ),
  );
}

export type SubscriptionRuntime = Pick<
  ManagedRuntime.ManagedRuntime<never, never>,
  "runFork" | "scope"
>;

export function forkEach<A, R, R2 = never>(
  stream: Stream.Stream<A, never, R>,
  handle: (value: A) => Effect.Effect<unknown, unknown, R2> | void,
) {
  return Stream.runForEach(stream, (value) =>
    Effect.suspend(() => handle(value) ?? Effect.void).pipe(
      logAndContinue("Stream consumer failed", "effect-stream"),
    ),
  ).pipe(Effect.forkScoped({ startImmediately: true }));
}

export function subscribe<A, R>(
  runtime: Pick<ManagedRuntime.ManagedRuntime<R, never>, "runFork"> & {
    readonly scope: Scope.Scope;
  },
  stream: Stream.Stream<A, never, R>,
  callback: (value: A) => void,
): () => void {
  if (isScopeClosed(runtime.scope)) return () => {};
  let active = true;
  const fiber = runtime.runFork(
    Stream.runForEach(stream, (value) =>
      Effect.sync(() => {
        if (active) callback(value);
      }).pipe(logAndContinue("Stream subscriber failed", "effect-stream")),
    ),
  );
  fiber.currentDispatcher.flush();
  return () => {
    active = false;
    fiber.interruptUnsafe();
  };
}
