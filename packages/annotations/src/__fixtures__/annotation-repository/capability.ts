import { DateTime, Duration } from "effect";

import { fromInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";

export function cooldownFailureOf(seconds: number) {
  return { kind: "cooldown", retryAfter: Duration.seconds(seconds) } as const;
}

export function deadlineAfter(
  instant: { readonly epochMilliseconds: number },
  seconds: number,
): DateTime.Utc {
  return DateTime.addDuration(fromInstant(instant), Duration.seconds(seconds));
}
