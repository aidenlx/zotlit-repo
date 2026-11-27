import type { App, HoverParent, Modifier } from "obsidian";
import { PopoverState, Scope } from "obsidian";
import type { HTMLAttributes, Ref, RefObject } from "react";
import {
  Fragment,
  createContext,
  useContext,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { composing } from "@zotlit/ui";

import { useObsidianApp } from "#app-context.ts";
import { HoverPopover } from "#hover-popover.ts";
import { observeResize } from "#observe-resize.ts";

import "./pinned-popover.css";

export interface PinnedPopoverHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  contains(node: Node): boolean;
}

export interface PageKey {
  readonly modifiers: Modifier[];
  readonly key: string;
}

export interface PinnedPopoverProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "popover"
> {
  anchor: RefObject<HTMLElement | null>;
  handle?: Ref<PinnedPopoverHandle>;
  inset?: RefObject<HTMLElement | null>;
  beside?: RefObject<HTMLElement | null>;
  within?: RefObject<HTMLElement | null>;
  onEscape?: () => boolean;
  initialFocus?: boolean;
  pageKeys?: readonly PageKey[];
  onOpenChange?: (open: boolean) => void;
  ref?: Ref<HTMLDivElement>;
}

export const PINNED_POPOVER_BODY = "zt-pinned-popover-body";

const OBSIDIAN_FLOATING =
  ".menu, .suggestion-container, .popover:not(.zt-pinned-popover)";

interface PinnedHoverPopoverOptions {
  app: App;
  parent: HoverParent;
  anchor: HTMLElement;
  body: HTMLElement;
  inset: HTMLElement | null;
  beside: HTMLElement | null;
  within: HTMLElement | null;
  onEscape: () => boolean;
  initialFocus: boolean;
  pageKeys: readonly PageKey[];
  holds: (element: Element) => boolean;
  onHidden: () => void;
}

class PinnedHoverPopover extends HoverPopover {
  readonly #options: PinnedHoverPopoverOptions;
  readonly #scope: Scope;

  constructor(options: PinnedHoverPopoverOptions) {
    super(options.parent, options.anchor, 0);
    this.#options = options;
    this.#scope = new Scope(options.app.scope);
    this.setIsFocused(true);
    this.hoverEl.addClasses(["zt-root", "zt-pinned-popover"]);
    this.hoverEl.tabIndex = -1;
    this.hoverEl.append(options.body);
  }

  override onload(): void {
    const { app, anchor, holds, body } = this.#options;
    this.#scope.register([], "Escape", (event) => {
      if (composing(event)) return;
      if (!this.#options.onEscape()) this.hide();
      return false;
    });
    for (const { modifiers, key } of this.#options.pageKeys)
      this.#scope.register(modifiers, key, () => true);
    app.keymap.pushScope(this.#scope);
    this.register(() => app.keymap.popScope(this.#scope));
    const { inset, beside } = this.#options;
    const resize = observeResize(
      anchor,
      [body, inset, beside].filter((box) => box !== null),
      () => this.position(),
    );
    if (beside) {
      this.registerDomEvent(this.hoverEl.doc, "scroll", () => this.position(), {
        capture: true,
      });
    }
    this.register(() => resize[Symbol.dispose]());
    this.registerDomEvent(
      this.hoverEl.doc,
      "pointerdown",
      ({ target }) => {
        if (!(target as Node | null)?.instanceOf(Element)) return;
        const element = target as Element;
        if (anchor.contains(element) || holds(element)) return;
        if (element.closest(OBSIDIAN_FLOATING)) return;
        const held = this.hoverEl.contains(this.hoverEl.doc.activeElement);
        this.hide();
        if (!held) return;
        const { doc, win } = this.hoverEl;
        win.setTimeout(() => {
          const active = doc.activeElement;
          if (!active || active === doc.body)
            anchor.focus({ preventScroll: true });
        });
      },
      { capture: true },
    );
    if (this.#options.initialFocus) this.hoverEl.focus({ preventScroll: true });
  }

  override position(): void {
    super.position();
    if (this.#options.beside) {
      this.#placeBeside(this.#options.beside);
      return;
    }
    const box = this.#options.inset;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const gap = gapOf(box);
    const { style } = this.hoverEl;
    style.top = `${rect.top + gap}px`;
    style.height = `${Math.max(rect.height - 2 * gap, 0)}px`;
    style.maxWidth = `${Math.max(rect.width - 2 * gap, 0)}px`;
    style.left = `${rect.right - gap - this.hoverEl.offsetWidth}px`;
  }

  #placeBeside(box: HTMLElement): void {
    const rect = box.getBoundingClientRect();
    const row = this.#options.anchor.getBoundingClientRect();
    const bounds = this.#options.within?.getBoundingClientRect() ?? {
      left: 0,
      right: box.win.innerWidth,
    };
    const gap = gapOf(box);
    const { style } = this.hoverEl;
    style.setProperty("--zt-pinned-max-height", `${rect.height}px`);
    const width = this.hoverEl.offsetWidth;
    const height = Math.min(this.hoverEl.offsetHeight, rect.height);
    const leftRoom = rect.left - bounds.left;
    const rightRoom = bounds.right - rect.right;
    const left =
      leftRoom >= rightRoom ? rect.left - gap - width : rect.right + gap;
    style.left = `${Math.max(bounds.left, Math.min(left, bounds.right - width))}px`;
    style.top = `${Math.max(rect.top, Math.min(row.top, rect.bottom - height))}px`;
  }

  override hide(): void {
    if (this.state === PopoverState.Hidden) return;
    const { anchor, onHidden } = this.#options;
    const held = this.hoverEl.contains(this.hoverEl.doc.activeElement);
    super.hide();
    if (held) anchor.focus({ preventScroll: true });
    onHidden();
  }
}

function gapOf(box: HTMLElement): number {
  return Number.parseFloat(
    box.win.getComputedStyle(box).getPropertyValue("--size-4-2"),
  );
}

class PopoverNode {
  readonly children = new Set<PopoverNode>();
  live: PinnedHoverPopover | null = null;

  contains(node: Node): boolean {
    return (
      this.live?.hoverEl.contains(node) === true ||
      [...this.children].some((child) => child.contains(node))
    );
  }
}

const NO_PAGE_KEYS: readonly PageKey[] = [];

const EnclosingPopover = createContext<PopoverNode | null>(null);

export function PinnedPopover({
  anchor,
  handle,
  inset,
  beside,
  within,
  onEscape,
  initialFocus = true,
  pageKeys = NO_PAGE_KEYS,
  onOpenChange,
  ref,
  children,
  ...rest
}: PinnedPopoverProps) {
  const app = useObsidianApp();
  const enclosing = useContext(EnclosingPopover);
  const [node] = useState(() => new PopoverNode());
  const [parent] = useState<HoverParent>(() => ({ hoverPopover: null }));
  const [body] = useState(() => {
    const box = document.createElement("div");
    box.className = inset
      ? `${PINNED_POPOVER_BODY} zt:h-full`
      : PINNED_POPOVER_BODY;
    return box;
  });
  const [mounted, setMounted] = useState<{
    doc: Document;
    round: number;
  } | null>(null);
  const notify = useRef(onOpenChange);
  const escape = useRef(onEscape);
  useLayoutEffect(() => {
    notify.current = onOpenChange;
    escape.current = onEscape;
  });

  useLayoutEffect(() => {
    enclosing?.children.add(node);
    return () => {
      enclosing?.children.delete(node);
      node.live?.hide();
    };
  }, [enclosing, node]);

  useImperativeHandle(handle, () => {
    const show = () => {
      if (node.live || !anchor.current) return;
      const { doc } = anchor.current;
      setMounted((last) =>
        last?.doc === doc ? last : { doc, round: (last?.round ?? 0) + 1 },
      );
      node.live = new PinnedHoverPopover({
        app,
        parent,
        anchor: anchor.current,
        body,
        inset: inset?.current ?? null,
        beside: beside?.current ?? null,
        within: within?.current ?? null,
        onEscape: () => escape.current?.() ?? false,
        initialFocus,
        pageKeys,
        holds: (element) => node.contains(element),
        onHidden: () => {
          node.live = null;
          notify.current?.(false);
        },
      });
      notify.current?.(true);
      node.live.showNow();
    };
    const hide = () => node.live?.hide();
    return {
      show,
      hide,
      toggle: () => (node.live ? hide() : show()),
      contains: (target) => node.contains(target),
    };
  }, [
    anchor,
    app,
    beside,
    body,
    initialFocus,
    inset,
    node,
    pageKeys,
    parent,
    within,
  ]);

  return createPortal(
    <EnclosingPopover.Provider value={node}>
      <div ref={ref} {...rest}>
        {mounted && <Fragment key={mounted.round}>{children}</Fragment>}
      </div>
    </EnclosingPopover.Provider>,
    body,
  );
}
