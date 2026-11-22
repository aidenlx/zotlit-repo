import { Notice } from "obsidian";
import type {
  ObsidianProtocolData,
  ObsidianProtocolHandler,
  Plugin,
} from "obsidian";

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

export type ShellEntryPlugin = UnloadAwarePlugin & CliHost;

export interface StartedShell {
  readonly services: unknown;
  readonly runCli: CliRunner;
  readonly unload: () => void;
}

export type StartShell = (
  plugin: ShellEntryPlugin,
) => Promise<StartedShell | undefined>;

export type ShellStartTime = "onload" | "layout-ready";

export function shellEntry(
  load: () => Promise<StartShell>,
  when: ShellStartTime,
  linkActions: readonly string[] = [],
) {
  return class ShellEntry extends UnloadAwarePlugin implements CliHost {
    #started?: StartedShell;
    readonly #linkHandlers = new Map<string, ObsidianProtocolHandler | null>();
    #heldLinks: ObsidianProtocolData[] = [];

    get services(): unknown {
      if (!this.#started) throw new Error("Plugin not loaded");
      return this.#started.services;
    }

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

    registerCliCommand(
      name: string,
      { description, flags, handler }: CliCommand,
    ): void {
      this.registerCliHandler(name, description, flags, (params) => {
        if (!this.#started) throw new Error("Plugin not loaded");
        return this.#started.runCli(handler(params));
      });
    }

    override registerObsidianProtocolHandler(
      action: string,
      handler: ObsidianProtocolHandler,
    ): void {
      if (this.#linkHandlers.has(action))
        this.#linkHandlers.set(action, handler);
      else super.registerObsidianProtocolHandler(action, handler);
    }

    override async onload(): Promise<void> {
      await super.onload();
      const { workspace } = this.app;
      if (when === "onload" || workspace.layoutReady) return this.#start();
      for (const action of linkActions) {
        this.#linkHandlers.set(action, null);
        super.registerObsidianProtocolHandler(action, (data) => {
          if (this.#started) this.#linkHandlers.get(action)?.(data);
          else this.#heldLinks.push(data);
        });
      }
      workspace.onLayoutReady(() => {
        this.#start().catch((error: unknown) => {
          new Notice(`Failed to load plugin ${this.manifest.name}`);
          // oxlint-disable-next-line effecttsgo/global-console, zotlit-logging/effect-logging-only -- the entry module stays free of Effect
          console.error(`Plugin failure: ${this.manifest.id}`, error);
        });
      });
    }

    async #start(): Promise<void> {
      const start = await load();
      if (this.unloaded) return;
      this.#started = await start(this);
      if (!this.#started) return;
      const held = this.#heldLinks;
      this.#heldLinks = [];
      for (const data of held) this.#linkHandlers.get(data.action)?.(data);
    }

    override onunload(): void {
      const started = this.#started;
      this.#started = undefined;
      started?.unload();
    }
  };
}
