import { Clock, Effect, Redacted } from "effect";

import type { RequestPause } from "@zotlit/web-library";

export function makeKeyPauses() {
  const deadlines = new Map<string, number>();
  const of = (
    baseUrl: string,
    apiKey: Redacted.Redacted<string>,
  ): RequestPause => {
    const entry = `${baseUrl}\n${Redacted.value(apiKey)}`;
    return {
      until: Effect.map(Clock.currentTimeMillis, (now) => {
        const until = deadlines.get(entry) ?? 0;
        if (until > now) return until;
        deadlines.delete(entry);
        return 0;
      }),
      extend: (until) =>
        Effect.sync(() => {
          const next = Math.max(deadlines.get(entry) ?? 0, until);
          deadlines.set(entry, next);
          return next;
        }),
    };
  };
  return { of, size: () => deadlines.size };
}
