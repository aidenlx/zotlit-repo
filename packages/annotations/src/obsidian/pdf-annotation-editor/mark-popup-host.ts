import { Effect } from "effect";
import type { HoverParent } from "obsidian";
import type { ReactNode } from "react";
import { createElement, Fragment } from "react";

import { hasActiveMenu } from "@zotlit/obsidian-kit/menu.ts";
import { watch } from "@zotlit/obsidian-kit/view-atoms.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import type { Point } from "./hit-test.ts";
import { MarkPopup } from "./mark-popup.tsx";
import type { ReaderSurface } from "./reader-surface-model.ts";
import { current } from "./reader-surface-model.ts";
import type { Floating, PopuplessFloating } from "./reader-surface-state.ts";
import { drawsNoPopup, selectFloatingHead } from "./reader-surface-state.ts";

export interface MarkPopupVariant {
  anchor: () => Point | null;
  render: (content: HTMLElement) => ReactNode | undefined;
  unanchored?: () => void;
}

export interface MarkPopupHostDeps {
  parent: HoverParent;
  doc: () => Document;
  surface: ReaderSurface;
  shown: () => boolean;
  variants: Record<
    Exclude<Floating["kind"], PopuplessFloating["kind"]>,
    MarkPopupVariant
  >;
}

export class MarkPopupHost implements Disposable {
  readonly #deps;
  readonly #unsubscribe;
  #popup: MarkPopup | null = null;
  #changedWhileCovered = false;

  constructor(deps: MarkPopupHostDeps) {
    this.#deps = deps;
    this.#unsubscribe = watch(
      deps.surface.registry,
      deps.surface.model.popup,
      () => this.#place({ refresh: true }),
    );
    this.#place({ refresh: false });
  }

  contains(node: Node | null): boolean {
    const hoverEl = this.#popup?.hoverEl;
    if (!hoverEl) return false;
    return hoverEl.contains(node) || hasActiveMenu(hoverEl);
  }

  sync(): void {
    this.#place({ refresh: false });
  }

  [Symbol.dispose](): void {
    this.#unsubscribe();
    this.#hide();
  }

  #place(options: { refresh: boolean }): void {
    const covered = !this.#deps.shown();
    this.#popup?.hoverEl.toggleAttribute("data-zt-covered", covered);
    if (covered) {
      this.#changedWhileCovered ||= options.refresh;
      return;
    }
    const refresh = options.refresh || this.#changedWhileCovered;
    this.#changedWhileCovered = false;
    const state = current(this.#deps.surface);
    const { floating } = state;
    const variant =
      drawsNoPopup(floating) ||
      (floating.kind === "selected" &&
        (floating.quiet ||
          (floating.adjust !== undefined &&
            floating.adjust.phase !== "saving")))
        ? null
        : this.#deps.variants[floating.kind];
    const anchor = variant?.anchor() ?? null;
    const head = selectFloatingHead(state);
    const action = !anchor
      ? this.#popup && "hide"
      : !this.#popup
        ? "open"
        : refresh
          ? "refresh"
          : null;
    if (action)
      Effect.runSyncWith(logServices)(
        Effect.logDebug("Mark Popup placed").pipe(
          Effect.annotateLogs({
            action,
            kind: head.kind,
            key: head.key,
            commenting: head.commenting,
            tagging: head.tagging,
          }),
          withLogCategory("pdf-annotation-editor"),
        ),
      );
    if (!anchor) {
      this.#hide();
      if (variant) variant.unanchored?.();
      return;
    }
    if (this.#popup) {
      if (refresh) this.#popup.refresh();
      this.#popup.retarget(anchor);
      return;
    }
    const popup: MarkPopup = new MarkPopup({
      parent: this.#deps.parent,
      anchor,
      doc: this.#deps.doc,
      render: (content) => this.#render(content),
      onHide: () => {
        if (this.#popup === popup) this.#popup = null;
      },
    });
    this.#popup = popup;
    popup.open();
  }

  #render(content: HTMLElement): ReactNode | undefined {
    const state = current(this.#deps.surface);
    const { floating } = state;
    if (drawsNoPopup(floating)) return undefined;
    const view = this.#deps.variants[floating.kind].render(content);
    if (view === undefined) return undefined;
    const { kind, key } = selectFloatingHead(state);
    return createElement(Fragment, { key: `${kind}:${key}` }, view);
  }

  #hide(): void {
    const popup = this.#popup;
    this.#popup = null;
    popup?.hide();
  }
}
