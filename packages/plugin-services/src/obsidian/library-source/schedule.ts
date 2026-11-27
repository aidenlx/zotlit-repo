import { Duration, Effect, Stream } from "effect";

export const SYNC_INTERVAL = Duration.minutes(5);

export const runSyncSchedule = Effect.fn("LibrarySource.runSyncSchedule")(
  function* <E, R>(
    sync: Effect.Effect<void, E, R>,
    focused: Stream.Stream<boolean>,
  ) {
    const focus = Stream.runHead(Stream.filter(focused, (on) => on));
    yield* Effect.ignore(sync);
    for (;;) {
      yield* Effect.sleep(SYNC_INTERVAL);
      yield* focus;
      yield* Effect.ignore(sync);
    }
  },
);
