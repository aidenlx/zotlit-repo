import type { FieldPopupKeyHost } from "#core/language/index.ts";
import type { Extension } from "@codemirror/state";
import type { App } from "obsidian";
import { Scope } from "obsidian";

import { composing } from "@zotlit/ui";

import { onEditorWindowMigrated } from "#core/editor/editor-migration.ts";
import { fieldPopupKeyHost } from "#core/language/index.ts";

export function popupScope(
  app: Pick<App, "scope" | "keymap">,
): FieldPopupKeyHost {
  return (keys) => {
    const scope = new Scope(app.scope);
    let pushed = true;
    let unwatch: (() => void) | undefined;
    const release = () => {
      unwatch?.();
      unwatch = undefined;
      if (pushed) app.keymap.popScope(scope);
      pushed = false;
    };
    const letGo = () => {
      release();
      keys.released();
    };
    const take = (act: () => boolean) => (event: KeyboardEvent) =>
      composing(event) || !act() ? undefined : false;
    scope.register([], "Tab", take(keys.accept));
    scope.register([], "Enter", take(keys.accept));
    scope.register([], "Escape", take(keys.close));
    scope.register(["Shift"], "Tab", () => {
      letGo();
      return undefined;
    });
    app.keymap.pushScope(scope);
    unwatch = onEditorWindowMigrated(keys.view, letGo);
    return release;
  };
}

export function obsidianPopupKeys(app: App): Extension {
  return fieldPopupKeyHost.of(popupScope(app));
}
