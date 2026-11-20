// The plugin class a host extends: start-up over the host's composition, the
// interrupted start-up release, and unload.
import type { Plugin } from "obsidian";

import type { CliCommand, CliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import {
  handlerCheckedFlags,
  printableCliHandler,
} from "@zotlit/obsidian-kit/cli-rejection.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import {
  enableStartupLogging,
  setLogCategoryRoot,
} from "@zotlit/plugin-kernel/log.ts";
import { registerFileMenu } from "@zotlit/plugin-services/obsidian/file-menu.ts";
import { startI18n } from "@zotlit/plugin-services/obsidian/language-pack/start.ts";

import type { HostDeclaration } from "./compose.ts";
import type { Feature } from "./feature.ts";
import { logLateRelease, UnloadAwarePlugin } from "./lifecycle.ts";
import { createShellRuntime, runFeatureHooks } from "./runtime.ts";
import type { ShellServices } from "./runtime.ts";
import { reportStartupFailure } from "./startup-notice.ts";

/**
 * The plugin class of `host`. A host's default export extends it and adds
 * only what differs per host, such as a check before start-up
 * ({@link preflight}).
 */
export function shellPlugin<const F extends readonly Feature<any, any, any>[]>(
  host: HostDeclaration<F>,
) {
  return class ShellPlugin extends UnloadAwarePlugin implements CliHost {
    // Owns every service/resource registered during onload after startup commits.
    #stack?: AsyncDisposableStack;

    // Debug/escape-hatch access only. Services should depend on each other via DI.
    #services?: ShellServices<F>;

    /**
     * The plugin runtime's values, for `obsidian eval` callers outside the
     * bundle — `packages/e2e` and `packages/scripts` reach it through a
     * string, so they keep working while TypeScript sees nothing to navigate.
     *
     * Typed `unknown` on purpose: it stays unset until `onload()` commits, so
     * anything inside the bundle that reads a service through it gets a value
     * that throws at exactly the wrong moment. Take the service as an explicit
     * dependency instead.
     */
    get services(): unknown {
      if (!this.#services) throw new Error("Plugin not loaded");
      return this.#services;
    }

    /**
     * Every zotlit:* command registers here, so each handler rejects with the
     * text of its error: Obsidian prints any other rejection as [object
     * Object]. Its decoder, not Obsidian, reports a missing parameter.
     */
    override registerCliHandler(
      ...[command, description, flags, handler]: Parameters<
        Plugin["registerCliHandler"]
      >
    ): void {
      super.registerCliHandler(
        command,
        description,
        handlerCheckedFlags(flags),
        printableCliHandler(handler),
      );
    }

    /**
     * Register a zotlit:* command whose handler is an Effect, run on the
     * plugin's runtime (`@zotlit/obsidian-kit/cli-command.ts`).
     */
    registerCliCommand(
      name: string,
      { description, flags, handler }: CliCommand,
    ): void {
      this.registerCliHandler(name, description, flags, (params) => {
        if (!this.#services) throw new Error("Plugin not loaded");
        return this.#services.runCli(handler(params));
      });
    }

    /**
     * A host's check before the plugin acquires anything. Throw to stop the
     * load; the Language Pack is already applied, so a notice reads in the
     * user's language.
     */
    protected preflight(): void {}

    override async onload(): Promise<void> {
      setLogCategoryRoot(this.manifest.id);
      await super.onload();

      if (__DEV__) enableStartupLogging();

      // Install the current session's pack before any copy shows: the
      // preflight and startup-failure notices read `m.*` outside the service
      // graph. The graph's LanguagePack carries on from here and shows the
      // consent notice or the refresh toast once it builds.
      const languagePack = startI18n(
        this.app,
        host.languagePack,
        this.manifest,
      );

      this.preflight();

      // Local stack gives automatic rollback if any startup acquisition or
      // wiring fails before the plugin commits ownership with `stack.move()`.
      await using stack = new AsyncDisposableStack();

      // Start once the instance a quick off and on unloaded has released its
      // commands, zotlit:* names and port.
      const lateRelease = await this.waitForPreviousAndHoldRelease(stack);
      if (this.unloaded) return;

      const { services, context } = await createShellRuntime(this, stack, {
        host,
        languagePack,
      }).catch((error: unknown) =>
        reportStartupFailure(error, this.manifest.name),
      );
      // Logged now: the runtime's logging layer has given LogTape its sinks.
      if (lateRelease) logLateRelease(this.manifest.id);

      // A disable during the build has already unloaded this instance: leave
      // now, and the stack releases the services the build acquired.
      if (this.unloaded) return;

      const menus = runFeatureHooks(host, context);
      // Every entry on Obsidian's file menu. Each entry names its own
      // section; the host's menu order is the order of the rows inside each
      // section.
      registerFileMenu(this, menus.fileMenu, menus.folderMenu);

      this.#services = services;
      this.#stack = stack.move();
    }

    override onunload(): void {
      // Start the last settings write now rather than at the end of
      // disposal, so an instance enabled straight after reads it; a view that
      // saves as it closes after this hands its write on the same way.
      if (this.#services)
        this.#services.bridge.runSync(this.#services.settings.release);
      // Drop the service bag before async disposal so late callers fail clearly.
      this.#services = undefined;

      const stack = this.#stack;
      this.#stack = undefined;

      void stack?.disposeAsync().catch((error: unknown) => {
        console.error("ZotLit cleanup error:", error);
        new BaseNotice(`Failed to clean up ${this.manifest.name} resources`);
      });
    }
  };
}
