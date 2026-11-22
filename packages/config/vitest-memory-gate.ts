import { Effect } from "effect";

import {
  MEMORY_GATE_ADMITTED_ENV,
  passMemoryGateOrExit,
} from "./memory-gate.ts";

export default async function setup(): Promise<void> {
  if (await Effect.runPromise(passMemoryGateOrExit()))
    process.env[MEMORY_GATE_ADMITTED_ENV] = "1";
}
