import { FAILURE_COOLDOWN_MILLIS } from "./service.ts";

export interface TestClock {
  readonly now: () => Temporal.Instant;
  passCooldown: () => void;
}

export function testClock(): TestClock {
  let offset = Temporal.Duration.from({ milliseconds: 0 });
  return {
    now: () => Temporal.Now.instant().add(offset),
    passCooldown: () => {
      offset = offset
        .add({ milliseconds: FAILURE_COOLDOWN_MILLIS })
        .add({ milliseconds: 1 });
    },
  };
}
