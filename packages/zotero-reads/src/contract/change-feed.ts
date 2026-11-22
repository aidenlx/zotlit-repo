import { Effect, PubSub, Stream } from "effect";

import type { ChangeEvent, DbUnavailable, EffectiveReadMode } from "./rpc.ts";

export const makeChangeFeed = Effect.fnUntraced(function* (
  seed: () => readonly [ChangeEvent, ...ChangeEvent[]],
) {
  const events = yield* PubSub.unbounded<ChangeEvent>();
  return {
    publish: (event: ChangeEvent) =>
      PubSub.publish(events, event).pipe(Effect.asVoid),
    changes: Stream.unwrap(
      Effect.map(PubSub.subscribe(events), (subscription) =>
        Stream.concat(
          Stream.fromIterable(seed()),
          Stream.fromSubscription(subscription),
        ),
      ),
    ),
  };
});

export interface FeedState {
  readonly state: "loading" | "ready" | "degraded";
  readonly error: DbUnavailable | null;
  readonly readMode?: EffectiveReadMode | null | undefined;
  readonly moved?: boolean | undefined;
  readonly missing: boolean;
}

export const makeStateFeed = (current: () => FeedState) =>
  makeChangeFeed(() => {
    const { state, error, readMode, moved, missing } = current();
    const seed: ChangeEvent = {
      _tag: "state",
      state,
      error,
      ...(state === "ready" && readMode && { readMode }),
      ...(state === "ready" && error !== null && { moved: moved ?? false }),
    };
    return missing && state !== "ready"
      ? [seed, { _tag: "db-file-missing" }]
      : [seed];
  });
