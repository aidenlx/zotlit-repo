// The warning for a start-up that the previous instance's release did not
// precede.
import { Effect } from "effect";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import { PREVIOUS_RELEASE_WAIT_MS } from "./lifecycle.ts";

/**
 * Warn that `pluginId` started before the previous instance released what it
 * held. Call it once the runtime's logging layer has built: until then a
 * production build's logger has no sinks, and the record is lost.
 */
export function logLateRelease(pluginId: string): void {
  // Only the bound ends the wait this way, so it took the whole bound.
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
