import { setTooltip } from "obsidian";

import { observeResize } from "@zotlit/obsidian-kit/observe-resize.ts";
import { pointerDrag } from "@zotlit/obsidian-kit/pointer-drag.ts";
import type { PointerDrag } from "@zotlit/obsidian-kit/pointer-drag.ts";
import { paneDivider } from "@zotlit/plugin-kernel/pane-divider.ts";

import { cardWidthBounds } from "./document.ts";

const STEP = 16;

const RESIZING = {
  x: "zt-is-resizing-library-card",
  y: "zt-is-resizing-library-card-height",
} as const;

export interface PaneWidthHost {
  stored(): number | undefined;
  keep(width: number | undefined): void;
  collapse(collapsed: boolean): void;
  close(): void;
  readonly app: PointerDrag["app"];
}

export interface PaneWidthOptions {
  list: HTMLElement;
  shell: HTMLElement;
  side: "start" | "end" | "top";
  property: string;
  fallback: number;
  min: number;
  cls: string;
  hint: string;
  attr: string;
}

export class PaneWidth {
  readonly #pane: HTMLElement;
  readonly #options: PaneWidthOptions;
  readonly #host: PaneWidthHost;
  readonly #handle: HTMLElement;
  readonly #axis: "x" | "y";
  #width: number;
  #observer: Disposable | null = null;
  #drag: AbortController | null = null;

  constructor(
    pane: HTMLElement,
    options: PaneWidthOptions,
    host: PaneWidthHost,
  ) {
    this.#pane = pane;
    this.#options = options;
    this.#host = host;
    this.#width = options.fallback;
    const axis = options.side === "top" ? "y" : "x";
    this.#axis = axis;
    const handle = pane.createDiv({
      cls: `${paneDivider({ flow: "overlay", edge: options.side })} ${options.cls}`,
      attr: {
        role: "separator",
        tabindex: "0",
        "aria-orientation": axis === "x" ? "vertical" : "horizontal",
        [options.attr]: "",
      },
    });
    setTooltip(handle, options.hint, {
      placement: { start: "left", end: "right", top: "top" }[options.side] as
        | "left"
        | "right"
        | "top",
    });
    handle.addEventListener("pointerdown", (event) => this.#resize(event));
    handle.addEventListener("keydown", (event) => this.#key(event));
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      this.#host.keep(undefined);
      this.apply();
    });
    this.#handle = handle;
  }

  load(): void {
    const { shell } = this.#options;
    this.#observer = observeResize(shell, [shell], () => this.apply());
  }

  unload(): void {
    this.#observer?.[Symbol.dispose]();
    this.#observer = null;
    this.#drag?.abort();
  }

  apply(): void {
    if (this.#drag || !this.#beside()) return;
    this.#show(this.#host.stored() ?? this.#options.fallback);
  }

  #beside(): boolean {
    const handle = this.#handle;
    return handle.win.getComputedStyle(handle).display !== "none";
  }

  #bounds(): { min: number; max: number } {
    const size = (el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return this.#axis === "x" ? box.width : box.height;
    };
    const room = size(this.#options.list) + size(this.#pane);
    return cardWidthBounds(
      room === 0 ? Number.POSITIVE_INFINITY : room,
      this.#options.min,
    );
  }

  #show(width: number): number {
    const { min, max } = this.#bounds();
    const shown = Math.round(Math.min(max, Math.max(min, width)));
    this.#width = shown;
    this.#pane.style.setProperty(this.#options.property, `${shown}px`);
    const handle = this.#handle;
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute(
      "aria-valuemax",
      String(Number.isFinite(max) ? max : shown),
    );
    handle.setAttribute("aria-valuenow", String(shown));
    return shown;
  }

  #towardList(): 1 | -1 {
    if (this.#options.side === "top") return -1;
    const rtl = this.#pane.win.getComputedStyle(this.#pane).direction === "rtl";
    return (this.#options.side === "start") === rtl ? 1 : -1;
  }

  #key(event: KeyboardEvent): void {
    const [toList, fromList] =
      this.#axis === "y"
        ? ["ArrowUp", "ArrowDown"]
        : this.#towardList() === 1
          ? ["ArrowRight", "ArrowLeft"]
          : ["ArrowLeft", "ArrowRight"];
    const { min, max } = this.#bounds();
    let width: number;
    if (event.key === toList) width = this.#width + STEP;
    else if (event.key === fromList) width = this.#width - STEP;
    else if (event.key === "Home") width = min;
    else if (event.key === "End") width = max;
    else return;
    event.preventDefault();
    event.stopPropagation();
    this.#host.keep(this.#show(width));
  }

  #resize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.#drag?.abort();
    const controller = new AbortController();
    this.#drag = controller;
    const start = this.#width;
    const sign = this.#towardList();
    const widthAt = (delta: number) => start + sign * delta;
    const { min } = this.#options;
    const closes = (width: number) => width < min - min / 2;
    let kept = false;
    let collapsed = false;
    const collapse = (now: boolean) => {
      if (now === collapsed) return;
      collapsed = now;
      this.#host.collapse(now);
    };
    pointerDrag({
      app: this.#host.app,
      press: event,
      axis: this.#axis,
      handle: this.#handle,
      cursor: RESIZING[this.#axis],
      controller,
      move: (delta) => {
        const width = widthAt(delta);
        collapse(closes(width));
        if (!collapsed) this.#show(width);
      },
      drop: (delta) => {
        const width = widthAt(delta);
        if (closes(width)) {
          this.#host.close();
        } else {
          kept = true;
          this.#host.keep(this.#show(width));
        }
      },
      end: () => {
        if (this.#drag === controller) this.#drag = null;
        collapse(false);
        if (!kept) this.apply();
      },
    });
  }
}
