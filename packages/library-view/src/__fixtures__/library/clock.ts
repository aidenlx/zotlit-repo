import { vi } from "vitest";

export function holdNow(iso: string) {
  return vi
    .spyOn(Temporal.Now, "instant")
    .mockReturnValue(Temporal.Instant.from(iso));
}

