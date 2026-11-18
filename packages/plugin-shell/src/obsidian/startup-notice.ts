// The notice that names the service whose start-up failed.
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { ServiceStartupFailed } from "#core/startup-failure.ts";

/**
 * Stop plugin load on a service whose acquisition died, naming it on screen
 * and in the console. The onload stack releases what started as the error
 * leaves onload.
 *
 * @throws the startup failure, aborting plugin load.
 */
export function reportStartupFailure(error: unknown): never {
  if (error instanceof ServiceStartupFailed) {
    new BaseNotice(
      BaseNotice.render((renderer) => {
        renderer.setTitle(m.notice_startup_failed());
        renderer.addText(
          m.notice_startup_failed_detail({ service: error.service }),
        );
      }),
      0,
    );
    console.error(`ZotLit: ${error.message}`, error.cause);
  }
  throw error;
}
