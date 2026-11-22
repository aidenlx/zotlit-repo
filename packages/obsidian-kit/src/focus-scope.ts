import type { App, Scope } from "obsidian";

import { disposable } from "./disposables.ts";

export interface FocusScope extends Disposable {
  release(): void;
}

export function holdScopeWhileFocused(
  el: HTMLElement,
  scope: Scope,
  {
    keymap,
    when = () => true,
  }: {
    keymap: Pick<App["keymap"], "pushScope" | "popScope">;
    when?: () => boolean;
  },
): FocusScope {
  let pushed = false;
  const release = () => {
    if (pushed) keymap.popScope(scope);
    pushed = false;
  };
  const hold = () => {
    if (!when()) return;
    if (pushed) keymap.popScope(scope);
    keymap.pushScope(scope);
    pushed = true;
  };
  const leave = (event: FocusEvent) => {
    if (!el.contains(event.relatedTarget as Node | null)) release();
  };
  el.addEventListener("focusin", hold);
  el.addEventListener("focusout", leave);
  const unwatch = el.onWindowMigrated(release);
  if (el.contains(el.doc.activeElement)) hold();
  return {
    release,
    ...disposable(() => {
      el.removeEventListener("focusin", hold);
      el.removeEventListener("focusout", leave);
      unwatch();
      release();
    }),
  };
}
