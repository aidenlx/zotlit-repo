import { Effect } from "effect";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import {
  enableStartupLogging,
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { registerFileMenu } from "@zotlit/plugin-services/obsidian/file-menu.ts";
import { startI18n } from "@zotlit/plugin-services/obsidian/language-pack/start.ts";

import type { HostDeclaration, LinkActionsCheck } from "./compose.ts";
import { shellEntry } from "./entry.ts";
import type { StartShell } from "./entry.ts";
import type { Feature, LinkActionsOf } from "./feature.ts";
import { logLateRelease } from "./late-release.ts";
import { createShellRuntime, runFeatureHooks } from "./runtime.ts";
import { reportStartupFailure } from "./startup-notice.ts";

export function shellStart<
  const F extends readonly Feature<any, any, any>[],
  const L extends readonly string[] = never,
>(
  host: HostDeclaration<F>,
  options?: {
    readonly preflight?: () => void;
    readonly linkActions?: L;
  } & ([L] extends [never]
    ? unknown
    : LinkActionsCheck<LinkActionsOf<F>, L[number]>),
): StartShell {
  return async (plugin) => {
    if (__DEV__) enableStartupLogging();

    const languagePack = startI18n(
      plugin.app,
      host.languagePack,
      plugin.manifest,
    );

    options?.preflight?.();

    await using stack = new AsyncDisposableStack();

    const lateRelease = await plugin.waitForPreviousAndHoldRelease(stack);
    if (plugin.unloaded) return undefined;

    const { services, context } = await createShellRuntime(plugin, stack, {
      host,
      languagePack,
    }).catch((error: unknown) =>
      reportStartupFailure(error, plugin.manifest.name),
    );
    if (lateRelease) logLateRelease(plugin.manifest.id);

    if (plugin.unloaded) return undefined;

    const menus = runFeatureHooks(host, context);
    registerFileMenu(plugin, menus.fileMenu, menus.folderMenu);

    const owned = stack.move();
    return {
      services,
      runCli: services.runCli,
      unload: () => {
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

export function shellPlugin<const F extends readonly Feature<any, any, any>[]>(
  host: HostDeclaration<F>,
) {
  return shellEntry(() => Promise.resolve(shellStart(host)), "onload");
}
