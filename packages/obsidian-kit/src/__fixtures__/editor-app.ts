import type { App, Scope } from "obsidian";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { keymapApp } from "#__fixtures__/keymap.ts";

export function editorApp(): App & { scopes: Scope[] } {
  return stubService<App & { scopes: Scope[] }>("App", {
    ...keymapApp(),
    commands: stubService<App["commands"]>("Commands", {
      editorCommands: {},
    }),
    workspace: stubService<App["workspace"]>("Workspace", {
      trigger: () => {},
    }),
    hotkeyManager: stubService<App["hotkeyManager"]>("HotkeyManager", {
      getHotkeys: () => undefined,
      getDefaultHotkeys: () => undefined,
    }),
  });
}

export function pressSubmit(app: { scopes: Scope[] }): void {
  const scope = app.scopes.at(-1) as unknown as
    | {
        handlers: {
          modifiers: string[] | null;
          key: string | null;
          func: (event: KeyboardEvent) => unknown;
        }[];
      }
    | undefined;
  scope?.handlers
    .find(
      ({ modifiers, key }) => modifiers?.join() === "Mod" && key === "Enter",
    )
    ?.func(new KeyboardEvent("keydown"));
}
