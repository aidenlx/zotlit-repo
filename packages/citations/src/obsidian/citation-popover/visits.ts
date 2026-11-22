import type { Component, HoverParent } from "obsidian";
import type { ReactNode } from "react";

import { CitationHoverPopover } from "./popover.ts";

export interface HoverVisit<T> {
  readonly popover: CitationHoverPopover;
  readonly subscriptions: DisposableStack;
  readonly state: T;
}

export interface PopoverPart {
  owner: Component;
  subscriptions: DisposableStack;
  draw: (content: ReactNode) => boolean;
}

interface Visit<T> {
  popover: CitationHoverPopover;
  window: Window;
  subscriptions: DisposableStack;
  state: T;
}

export class HoverVisits<T> {
  readonly #visits = new Map<HoverParent, Visit<T>>();
  readonly #fresh;

  constructor(fresh: () => T) {
    this.#fresh = fresh;
  }

  open(hoverParent: HoverParent, targetEl: HTMLElement): HoverVisit<T> {
    let visit = this.#visits.get(hoverParent);
    if (visit && visit.window !== targetEl.win) {
      visit.popover.hide();
      visit = undefined;
    }
    if (!visit) {
      const popover = new CitationHoverPopover(hoverParent, targetEl);
      const opened: Visit<T> = {
        popover,
        window: targetEl.win,
        subscriptions: new DisposableStack(),
        state: this.#fresh(),
      };
      this.#visits.set(hoverParent, opened);
      popover.register(() => {
        opened.subscriptions.dispose();
        if (this.#visits.get(hoverParent) === opened) {
          this.#visits.delete(hoverParent);
        }
      });
      return targetVisit(opened);
    }
    visit.subscriptions.dispose();
    visit.subscriptions = new DisposableStack();
    visit.state = this.#fresh();
    visit.popover.render(null);
    visit.popover.retarget(targetEl);
    return targetVisit(visit);
  }

  hide(hoverParent: HoverParent, targetEl?: HTMLElement): void {
    const popover = this.#visits.get(hoverParent)?.popover;
    if (popover && (!targetEl || popover.targetEl === targetEl)) popover.hide();
  }

  hideAll(): void {
    for (const { popover } of this.#visits.values()) popover.hide();
  }
}

function targetVisit<T>({
  popover,
  subscriptions,
  state,
}: Visit<T>): HoverVisit<T> {
  return { popover, subscriptions, state };
}
