// Where one binary of the Resource Pack stands, as its watchers read it: the
// status last stated, the read that states the next one, and each change.
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

/** The status of one binary, for the settings row and each feature that needs the binary. */
export interface PackStatusApi {
  /**
   * Reads the pack and answers where the binary stands. A call reads the
   * pack file again, so it sees a pack installed since the last call; a call
   * made while another one reads joins that read and gets its answer.
   */
  readonly check: Effect.Effect<PackBinaryStatus>;
  /**
   * Where the binary stands, with no read of the pack file: `pack-absent`
   * with no pack installed, else the status of the last read. `null` while
   * the installed pack is unread. A `pack-absent` answer is also stated to
   * `changes`, so a watcher learns of a missing pack with no read.
   */
  readonly current: Effect.Effect<PackBinaryStatus | null>;
  /**
   * The status last stated, then each one that differs; none before the
   * first. The service reads the pack again and states its status each time
   * Obsidian installs, updates or removes the pack.
   */
  readonly changes: Stream.Stream<PackBinaryStatus>;
}

const sameStatus = (a: PackBinaryStatus | null, b: PackBinaryStatus) =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "ready" || (b.kind === "ready" && a.version === b.version)) &&
  (a.kind !== "failed" || (b.kind === "failed" && a.detail === b.detail));

/**
 * The status of one binary over `read`, one read of where the binary stands
 * in the installed pack. `publish` states a status that another step learned,
 * and `checkChanged` is the read to run after the pack changed. The status
 * ends with the caller's Scope.
 */
export const makePackStatus = Effect.fn("PackStatus.make")(function* (
  read: Effect.Effect<PackBinaryStatus>,
) {
  const platform = yield* ResourcePackPlatform;
  const status = yield* SubscriptionRef.make<PackBinaryStatus | null>(null);
  /** The status read that runs now; each `check` made meanwhile joins it. */
  let reading: Deferred.Deferred<PackBinaryStatus> | null = null;
  const scope = yield* Scope.Scope;
  const publish = Effect.fn("PackStatus.publish")(function* (
    next: PackBinaryStatus,
  ) {
    if (!sameStatus(yield* SubscriptionRef.get(status), next))
      yield* SubscriptionRef.set(status, Object.freeze(next));
    return next;
  });
  // The read runs on the layer's Scope, so a caller that leaves does not end
  // the read the others joined.
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
  /** A status read that starts after the pack changed. */
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
    // A pack installed after that status is unread.
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
