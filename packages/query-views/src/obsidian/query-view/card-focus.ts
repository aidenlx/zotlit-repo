import type { App, Scope } from "obsidian";

import type { HistorySurface } from "@zotlit/annotations/obsidian/annotation-repository/actions.ts";
import { inTextEntry } from "@zotlit/annotations/obsidian/pdf-annotation-editor/capability-affordance.ts";
import { disposable } from "@zotlit/obsidian-kit/disposables.ts";

const OVER_THE_VIEW = ".modal-container";

interface Held {
  el: HTMLElement;
  surface: HistorySurface;
}

export class QueryCardFocus {
  readonly #app: Pick<App, "keymap">;
  #last: Held | null = null;

  constructor(app: Pick<App, "keymap">) {
    this.#app = app;
  }

  hold(el: HTMLElement, scope: Scope, surface: HistorySurface): Disposable {
    const { keymap } = this.#app;
    let pushed = false;
    const held: Held = { el, surface };
    const release = () => {
      if (pushed) keymap.popScope(scope);
      pushed = false;
    };
    const onFocusIn = (event: FocusEvent) => {
      this.#last = held;
      if (pushed || inTextEntry(event.target)) return;
      keymap.pushScope(scope);
      pushed = true;
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next !== null && el.contains(next)) return;
      release();
      const over =
        next?.instanceOf(HTMLElement) === true &&
        next.closest(OVER_THE_VIEW) !== null;
      if (next !== null && !over && this.#last === held) this.#last = null;
    };
    const onDragStart = (event: DragEvent) => event.stopPropagation();
    el.addEventListener("focusin", onFocusIn, true);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("dragstart", onDragStart);
    return disposable(() => {
      el.removeEventListener("focusin", onFocusIn, true);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("dragstart", onDragStart);
      release();
      if (this.#last === held) this.#last = null;
    });
  }

  surfaceIn(container: HTMLElement): HistorySurface | null {
    const last = this.#last;
    if (!last?.el.isConnected || !container.contains(last.el)) return null;
    return last.surface;
  }
}
