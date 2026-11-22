import type { HoverParent } from "obsidian";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { SingletonHoverPopover } from "@zotlit/obsidian-kit/singleton-hover-popover.ts";

import "./style.css";

const WAIT_TIME = 300;

export const PLACEMENT_CLASS = {
  above: "zt-citation-popover-above",
  below: "zt-citation-popover-below",
} as const;

export class CitationHoverPopover extends SingletonHoverPopover {
  #root: Root | null;

  constructor(parent: HoverParent, targetEl: HTMLElement) {
    super(parent, targetEl, WAIT_TIME);
    this.hoverEl.classList.add("zt-citation-popover");
    const mount = this.hoverEl.createDiv();
    mount.classList.add("zt-root", "zt-citation-popover-content");
    this.#root = createRoot(mount);
    this.watchResize(mount);
    this.register(() => {
      this.#root?.unmount();
      this.#root = null;
    });
    this.load();
  }

  render(content: ReactNode): boolean {
    if (!this.#root) return false;
    flushSync(() => this.#root?.render(content));
    if (this.hoverEl.isConnected) this.position();
    return true;
  }

  override retarget(target: HTMLElement): void {
    this.staticPos = null;
    super.retarget(target);
    if (this.hoverEl.isConnected) this.position();
  }

  override position(): void {
    super.position();
    const { style } = this.hoverEl;
    this.hoverEl.classList.toggle(PLACEMENT_CLASS.above, style.bottom !== "");
    this.hoverEl.classList.toggle(PLACEMENT_CLASS.below, style.top !== "");
  }
}
