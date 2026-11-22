import {
  Deferred,
  Effect,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";

import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";

import { ResourcePackPlatform } from "./pack-platform.ts";

export interface PackStatusApi {
  readonly check: Effect.Effect<PackBinaryStatus>;
  readonly current: Effect.Effect<PackBinaryStatus | null>;
  readonly changes: Stream.Stream<PackBinaryStatus>;
}

const sameStatus = (a: PackBinaryStatus | null, b: PackBinaryStatus) =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "ready" || (b.kind === "ready" && a.version === b.version)) &&
  (a.kind !== "failed" || (b.kind === "failed" && a.detail === b.detail));

export const makePackStatus = Effect.fn("PackStatus.make")(function* (
  read: Effect.Effect<PackBinaryStatus>,
) {
  const platform = yield* ResourcePackPlatform;
  const status = yield* SubscriptionRef.make<PackBinaryStatus | null>(null);
  let reading: Deferred.Deferred<PackBinaryStatus> | null = null;
  const scope = yield* Scope.Scope;
  const publish = Effect.fn("PackStatus.publish")(function* (
    next: PackBinaryStatus,
  ) {
    if (!sameStatus(yield* SubscriptionRef.get(status), next))
      yield* SubscriptionRef.set(status, Object.freeze(next));
    return next;
  });
  const check = Effect.suspend(() => {
    if (reading) return Deferred.await(reading);
    const answer = (reading = Deferred.makeUnsafe<PackBinaryStatus>());
    return read.pipe(
      Effect.flatMap((status) => publish(status)),
      Effect.onExit((exit) => {
        if (reading === answer) reading = null;
        return Deferred.done(answer, exit);
      }),
      Effect.forkIn(scope),
      Effect.andThen(Deferred.await(answer)),
    );
  }).pipe(Effect.withSpan("PackStatus.check"));
  const checkChanged = Effect.suspend(() =>
    reading
      ? Deferred.await(reading).pipe(Effect.exit, Effect.andThen(check))
      : check,
  );
  yield* Effect.addFinalizer(() => PubSub.shutdown(status.pubsub));
  const current = Effect.gen(function* () {
    if (!(yield* platform.locate))
      return yield* publish({ kind: "pack-absent" });
    const last = yield* SubscriptionRef.get(status);
    return last?.kind === "pack-absent" ? null : last;
  }).pipe(Effect.withSpan("PackStatus.current"));
  return {
    publish,
    check,
    checkChanged,
    current,
    changes: SubscriptionRef.changes(status).pipe(
      Stream.filter((current) => current !== null),
    ),
  };
});
