import type { Suggestion, SuggestionSource } from "#core/language/index.ts";
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, Rect, ViewUpdate } from "@codemirror/view";
import type { HoverParent, Point } from "obsidian";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { SingletonHoverPopover } from "@zotlit/obsidian-kit/singleton-hover-popover.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";

import { hoverHint } from "#core/language/semantics.ts";

const WAIT_TIME = 300;

class TemplateHoverPopover extends SingletonHoverPopover {
  #root: Root | null;
  readonly #box: () => Rect | null;
  constructor(
    parent: HoverParent,
    token: HTMLElement,
    card: { option: Suggestion; box: () => Rect | null },
  ) {
    super(parent, token, WAIT_TIME);
    this.#box = card.box;
    const mount = this.hoverEl.createDiv({
      cls: ["zt-root", themeHook.templateHover],
    });
    this.#root = createRoot(mount);
    this.#root.render(<HoverFacts option={card.option} />);
    this.watchResize(mount);
    this.register(() => {
      this.#root?.unmount();
      this.#root = null;
    });
    this.load();
  }

  render(option: Suggestion): void {
    flushSync(() => this.#root?.render(<HoverFacts option={option} />));
    if (this.hoverEl.isConnected) this.position();
  }

  override position(): void {
    const box = this.#box();
    this.staticPos = box
      ? ({ x: box.left, y: (box.top + box.bottom) / 2 } satisfies Point)
      : null;
    super.position();
    if (!box) return;
    const card = this.hoverEl.getBoundingClientRect();
    if (card.top >= box.bottom) this.hoverEl.style.top = `${box.bottom + 4}px`;
    else if (card.bottom <= box.top)
      this.hoverEl.style.top = `${box.top - card.height - 4}px`;
  }
}

function HoverFacts({ option }: { option: Suggestion }) {
  return (
    <div className="zt:flex zt:flex-col zt:gap-2 zt:p-2 zt:text-sm zt:leading-normal zt:break-words zt:select-text">
      <div className="zt:flex zt:flex-wrap zt:items-baseline zt:gap-x-2 zt:gap-y-0.5">
        <strong className="zt:max-w-full zt:min-w-0">
          {option.path ?? option.displayLabel ?? option.label}
        </strong>
        {option.type && (
          <span className="zt:max-w-full zt:min-w-0 zt:font-mono zt:text-xs zt:text-muted-foreground">
            {option.type}
          </span>
        )}
      </div>
      <p>{option.detail}</p>
      {option.syntax && (
        <code className="zt:block zt:font-mono zt:text-xs zt:break-words zt:whitespace-pre-wrap">
          {option.syntax}
        </code>
      )}
      {option.example !== undefined && (
        <code className="zt:block zt:max-h-48 zt:overflow-auto zt:font-mono zt:text-xs zt:break-words zt:whitespace-pre-wrap zt:text-muted-foreground">
          {option.example}
        </code>
      )}
    </div>
  );
}

export function templateHover(read: SuggestionSource, parent: HoverParent) {
  return ViewPlugin.fromClass(
    class {
      #popover: TemplateHoverPopover | null = null;
      #target: HTMLElement | null = null;
      #range: { from: number; to: number } | null = null;
      #pending: {
        range: { from: number; to: number };
        timer: number;
        win: Window;
      } | null = null;
      readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;

        view.contentDOM.addEventListener("mouseout", this.#handoff, true);
      }

      readonly #handoff = (event: MouseEvent) => {
        if (this.#popover) this.move(event, event.relatedTarget);
      };

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged)
          this.close();
      }

      move(event: MouseEvent, element = event.target) {
        const node = element as Node | null;
        const target = node?.instanceOf(HTMLElement)
          ? node.closest<HTMLElement>(".cm-line span, .cm-line")
          : null;
        if (!target || !this.view.contentDOM.contains(target)) {
          this.#target = null;
          this.#cancelSwap();
          return;
        }
        const position = this.view.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });
        if (
          target === this.#target &&
          position !== null &&
          this.#range !== null &&
          position >= this.#range.from &&
          position <= this.#range.to
        )
          return;
        this.#target = target;
        const config = position === null ? null : read(position);
        const hint =
          config && position !== null
            ? hoverHint(this.view.state.doc.toString(), position, config)
            : null;
        const option = hint?.options[0];
        if (!hint || !option || !this.#over(hint, event)) {
          this.#cancelSwap();
          return;
        }
        this.#popover?.retarget(target);
        if (this.#range?.from === hint.from && this.#range.to === hint.to) {
          this.#cancelSwap();
          return;
        }
        const popover = this.#popover;
        if (popover?.hoverEl.isConnected) {
          if (
            this.#pending?.range.from === hint.from &&
            this.#pending.range.to === hint.to
          )
            return;
          this.#cancelSwap();
          const range = { from: hint.from, to: hint.to };
          const win = this.view.dom.win;
          this.#pending = {
            range,
            win,
            timer: win.setTimeout(() => {
              this.#pending = null;
              this.#range = range;
              popover.render(option);
            }, WAIT_TIME),
          };
          return;
        }
        this.#range = { from: hint.from, to: hint.to };
        if (popover) {
          popover.render(option);
          return;
        }
        const opened = new TemplateHoverPopover(parent, target, {
          option,
          box: () => this.#box(),
        });
        this.#popover = opened;
        opened.register(() => {
          if (this.#popover !== opened) return;
          this.#popover = null;
          this.#target = null;
          this.#range = null;
          this.#cancelSwap();
        });
      }

      #box(): Rect | null {
        return this.#range === null
          ? null
          : this.view.coordsAtPos(this.#range.from, 1);
      }

      #over(range: { from: number; to: number }, event: MouseEvent): boolean {
        const start = this.view.coordsAtPos(range.from, 1);
        const end = this.view.coordsAtPos(range.to, -1);
        return (
          !!start &&
          !!end &&
          event.clientX >= Math.min(start.left, end.left) &&
          event.clientX <= Math.max(start.right, end.right) &&
          event.clientY >= start.top &&
          event.clientY <= end.bottom
        );
      }

      #cancelSwap() {
        if (!this.#pending) return;
        this.#pending.win.clearTimeout(this.#pending.timer);
        this.#pending = null;
      }

      close() {
        const popover = this.#popover;
        this.#popover = null;
        this.#target = null;
        this.#range = null;
        this.#cancelSwap();
        popover?.hide();
      }

      leave(event: MouseEvent) {
        const relatedTarget = event.relatedTarget as Node | null;
        if (
          relatedTarget?.instanceOf(Node) &&
          this.#popover?.hoverEl.contains(relatedTarget)
        )
          return;
        this.close();
      }

      destroy() {
        this.view.contentDOM.removeEventListener(
          "mouseout",
          this.#handoff,
          true,
        );
        this.close();
      }
    },
    {
      eventObservers: {
        mousemove(event) {
          this.move(event);
        },
        mouseleave(event) {
          this.leave(event);
        },
        mousedown() {
          this.close();
        },
        keydown() {
          this.close();
        },
        scroll() {
          this.close();
        },
      },
    },
  );
}
