import { Clock, Context, Effect } from "effect";

export const QueryTimeZone = Context.Reference<string>(
  "@zotlit/item-query/QueryTimeZone",
  { defaultValue: () => Temporal.Now.timeZoneId() },
);

export interface QueryClock {
  readonly now: Temporal.Instant;
  readonly timeZone: string;
}

export const readQueryClock: Effect.Effect<QueryClock> = Effect.gen(
  function* () {
    const millis = yield* Clock.currentTimeMillis;
    const timeZone = yield* QueryTimeZone;
    return { now: Temporal.Instant.fromEpochMilliseconds(millis), timeZone };
  },
);
