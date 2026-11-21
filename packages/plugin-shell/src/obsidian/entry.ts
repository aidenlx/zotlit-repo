// The plugin class Obsidian loads: a small entry that starts the plugin body.
// It imports no Effect and no feature code, so a host can load the body after
// Obsidian's own start-up.
import type { Plugin } from "obsidian";

import type {
  CliCommand,
  CliHost,
  CliRunner,
} from "@zotlit/obsidian-kit/cli-command.ts";
import {
  handlerCheckedFlags,
  printableCliHandler,
} from "@zotlit/obsidian-kit/cli-rejection.ts";

import { UnloadAwarePlugin } from "./lifecycle.ts";

/** The plugin a start acts on. */
export type ShellEntryPlugin = UnloadAwarePlugin & CliHost;

/** What a finished start hands the entry. */
export interface StartedShell {
  /** The debug surface: the shell's values and each feature's handles. */
  readonly services: unknown;
  readonly runCli: CliRunner;
  /** Release what the start acquired. The entry calls it as Obsidian unloads the plugin. */
  readonly unload: () => void;
}

/**
 * Start the plugin body on `plugin`: build its services and register what it
 * owns. It resolves with nothing when a disable interrupted it, and has then
 * released what it acquired.
 */
export type StartShell = (
  plugin: ShellEntryPlugin,
) => Promise<StartedShell | undefined>;

/**
 * When the entry starts the body:
 * - `"onload"`: inside `onload`, which Obsidian awaits before it loads the
 *   next plugin, the vault and the layout.
 * - `"layout-ready"`: once the layout is ready, on a start of the app, so the
 *   body's modules evaluate and its services build after Obsidian's own
 *   start-up. A plugin that is turned on while the app runs finds the layout
 *   ready and starts inside `onload`.
 */
export type ShellStartTime = "onload" | "layout-ready";

/**
 * The plugin class over a body that `load` gives. A host's default export
 * extends it. With `"layout-ready"`, give `load` a dynamic `import()` of the
 * body module: the bundle then evaluates the body's modules at the start, not
 * with `main.js`.
 */
export function shellEntry(
  load: () => Promise<StartShell>,
  when: ShellStartTime,
) {
  return class ShellEntry extends UnloadAwarePlugin implements CliHost {
    #started?: StartedShell;

    /**
     * The plugin runtime's values, for `obsidian eval` callers outside the
     * bundle — `packages/e2e` and `packages/scripts` reach it through a
     * string, so they keep working while TypeScript sees nothing to navigate.
     *
     * Typed `unknown` on purpose: it stays unset until the start commits, so
     * anything inside the bundle that reads a service through it gets a value
     * that throws at exactly the wrong moment. Take the service as an explicit
     * dependency instead.
     */
    get services(): unknown {
      if (!this.#started) throw new Error("Plugin not loaded");
      return this.#started.services;
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
        if (!this.#started) throw new Error("Plugin not loaded");
        return this.#started.runCli(handler(params));
      });
    }

    override async onload(): Promise<void> {
      await super.onload();
      const { workspace } = this.app;
      if (when === "onload" || workspace.layoutReady) return this.#start();
      workspace.onLayoutReady(() => {
        // Obsidian reports a failed `onload` this way; nothing awaits this start.
        this.#start().catch((error: unknown) => {
          // oxlint-disable-next-line effecttsgo/global-console, zotlit-logging/effect-logging-only -- the entry module stays free of Effect
          console.error(`Plugin failure: ${this.manifest.id}`, error);
        });
      });
    }

    async #start(): Promise<void> {
      const start = await load();
      if (this.unloaded) return;
      this.#started = await start(this);
    }

    override onunload(): void {
      const started = this.#started;
      // Drop the service bag before async disposal so late callers fail clearly.
      this.#started = undefined;
      started?.unload();
    }
  };
}
