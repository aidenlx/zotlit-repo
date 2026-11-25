import { DateTime, Option } from "effect";
import type { Clock } from "effect";

export function monotonicMillis(clock: Clock.Clock): () => number {
  return () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
}

export function instantClock(clock: Clock.Clock): () => Temporal.Instant {
  return () =>
    Temporal.Instant.fromEpochMilliseconds(clock.currentTimeMillisUnsafe());
}

export function dateTimeClock(clock: Clock.Clock): () => DateTime.Utc {
  return () => DateTime.makeUnsafe(clock.currentTimeMillisUnsafe());
}

export function toInstant(dateTime: DateTime.DateTime): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(
    DateTime.toEpochMillis(dateTime),
  );
}

export function fromInstant(instant: {
  readonly epochMilliseconds: number;
}): DateTime.Utc {
  return DateTime.makeUnsafe(instant.epochMilliseconds);
}

export function parseInstant(text: string): Option.Option<DateTime.Utc> {
  try {
    return Option.some(fromInstant(Temporal.Instant.from(text)));
  } catch {
    return Option.none();
  }
}
