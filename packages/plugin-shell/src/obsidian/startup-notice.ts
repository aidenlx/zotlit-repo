// The notice that names the service whose start-up failed.
import { Effect } from "effect";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { ServiceStartupFailed } from "#core/startup-failure.ts";

/**
 * Stop plugin load on a service whose acquisition died, naming it on screen
 * and in the console. The onload stack releases what started as the error
 * leaves onload.
 *
 * @throws the startup failure, aborting plugin load.
 */
export function reportStartupFailure(error: unknown, plugin: string): never {
  if (error instanceof ServiceStartupFailed) {
    new BaseNotice(
      BaseNotice.render((renderer) => {
        renderer.setTitle(m.notice_startup_failed({ plugin }));
        renderer.addText(
          m.notice_startup_failed_detail({ plugin, service: error.service }),
        );
      }),
      0,
    );
    Effect.runSyncWith(logServices)(
      Effect.logError("A service failed to start: {reason}").pipe(
        Effect.annotateLogs({ reason: error.message, error: error.cause }),
        withLogCategory("plugin-lifecycle"),
      ),
    );
  }
  throw error;
}
