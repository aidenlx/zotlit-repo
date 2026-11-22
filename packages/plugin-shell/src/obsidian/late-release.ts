import { Effect } from "effect";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import { PREVIOUS_RELEASE_WAIT_MS } from "./lifecycle.ts";

export function logLateRelease(pluginId: string): void {
  Effect.runSyncWith(logServices)(
    Effect.logWarning(
      "Started before the previous instance released what it held",
    ).pipe(
      Effect.annotateLogs({
        pluginId,
        elapsedMs: PREVIOUS_RELEASE_WAIT_MS,
      }),
      withLogCategory("plugin-lifecycle"),
    ),
  );
}
