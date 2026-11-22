import { Effect } from "effect";

import { passMemoryGateOrExit } from "@zotlit/config/memory-gate";

export function admitMemoryRun(): Promise<boolean> {
  return Effect.runPromise(passMemoryGateOrExit());
}
