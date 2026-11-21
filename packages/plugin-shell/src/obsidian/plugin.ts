// The plugin body over a host's composition: start-up, the interrupted
// start-up release, and unload. `shellPlugin` is the class of a host that
// starts it inside `onload`.
import { Effect } from "effect";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import {
  enableStartupLogging,
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { registerFileMenu } from "@zotlit/plugin-services/obsidian/file-menu.ts";
import { startI18n } from "@zotlit/plugin-services/obsidian/language-pack/start.ts";

import type { HostDeclaration } from "./compose.ts";
import { shellEntry } from "./entry.ts";
import type { StartShell } from "./entry.ts";
import type { Feature } from "./feature.ts";
import { logLateRelease } from "./late-release.ts";
import { createShellRuntime, runFeatureHooks } from "./runtime.ts";
import { reportStartupFailure } from "./startup-notice.ts";

/**
 * The start of `host`'s body, for `shellEntry`.
 *
 * `preflight` is a host's check before the plugin acquires anything. Throw to
 * stop the load; the Language Pack is already applied, so a notice reads in
 * the user's language.
 */
export function shellStart<const F extends readonly Feature<any, any, any>[]>(
  host: HostDeclaration<F>,
  options?: { readonly preflight?: () => void },
): StartShell {
  return async (plugin) => {
    if (__DEV__) enableStartupLogging();

    // Install the current session's pack before any copy shows: the
    // preflight and startup-failure notices read `m.*` outside the service
    // graph. The graph's LanguagePack carries on from here and shows the
    // consent notice or the refresh toast once it builds.
    const languagePack = startI18n(
      plugin.app,
      host.languagePack,
      plugin.manifest,
    );

    options?.preflight?.();

    // Local stack gives automatic rollback if any startup acquisition or
    // wiring fails before the plugin commits ownership with `stack.move()`.
    await using stack = new AsyncDisposableStack();

    // Start once the instance a quick off and on unloaded has released its
    // commands, zotlit:* names and port.
    const lateRelease = await plugin.waitForPreviousAndHoldRelease(stack);
    if (plugin.unloaded) return undefined;

    const { services, context } = await createShellRuntime(plugin, stack, {
      host,
      languagePack,
    }).catch((error: unknown) =>
      reportStartupFailure(error, plugin.manifest.name),
    );
    // Logged now: the runtime's logging layer has given the logger its sinks.
    if (lateRelease) logLateRelease(plugin.manifest.id);

    // A disable during the build has already unloaded this instance: leave
    // now, and the stack releases the services the build acquired.
    if (plugin.unloaded) return undefined;

    const menus = runFeatureHooks(host, context);
    // Every entry on Obsidian's file menu. Each entry names its own
    // section; the host's menu order is the order of the rows inside each
    // section.
    registerFileMenu(plugin, menus.fileMenu, menus.folderMenu);

    // Owns every service/resource registered during start-up from here on.
    const owned = stack.move();
    return {
      services,
      runCli: services.runCli,
      unload: () => {
        // Start the last settings write now rather than at the end of
        // disposal, so an instance enabled straight after reads it; a view
        // that saves as it closes after this hands its write on the same way.
        services.bridge.runSync(services.settings.release);

        void owned.disposeAsync().catch((error: unknown) => {
          Effect.runSyncWith(logServices)(
            Effect.logError("Could not clean up the plugin's resources").pipe(
              Effect.annotateLogs({ error }),
              withLogCategory("plugin-lifecycle"),
            ),
          );
          new BaseNotice(
            `Failed to clean up ${plugin.manifest.name} resources`,
          );
        });
      },
    };
  };
}

/**
 * The plugin class of a host that starts its body inside `onload`. A host's
 * default export extends it and adds only what differs per host.
 */
export function shellPlugin<const F extends readonly Feature<any, any, any>[]>(
  host: HostDeclaration<F>,
) {
  return shellEntry(() => Promise.resolve(shellStart(host)), "onload");
}
