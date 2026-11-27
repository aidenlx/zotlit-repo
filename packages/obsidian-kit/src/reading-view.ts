import { Effect } from "effect";
import type { MarkdownPostProcessorContext, MarkdownView } from "obsidian";
import { MarkdownRenderChild } from "obsidian";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

export function isDraftMarkdown(element: HTMLElement): boolean {
  return element.closest("[data-zotlit-draft]") !== null;
}

export function markdownViewOf(
  views: readonly MarkdownView[],
  element: HTMLElement,
): MarkdownView | null {
  return views.find((view) => view.containerEl.contains(element)) ?? null;
}

export interface SectionRange {
  from: number;
  to: number;
}

export function sectionRange(
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
): SectionRange | null {
  const info = ctx.getSectionInfo(el);
  if (info === null) return null;
  return {
    from: lineStart(info.text, info.lineStart),
    to: lineStart(info.text, info.lineEnd + 1),
  };
}

function lineStart(text: string, line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}

export function rerenderReadingViews(views: readonly MarkdownView[]): number {
  for (const view of views) view.previewMode.rerender(true);
  return views.length;
}

interface LiveSection {
  path: string;
  show: Effect.Effect<void>;
}

export class LiveSections {
  readonly #sections = new Map<HTMLElement, LiveSection>();

  hold(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    show: Effect.Effect<void>,
  ): void {
    const held = this.#sections.get(el);
    if (held !== undefined) {
      held.show = show;
      return;
    }
    this.#sections.set(el, { path: ctx.sourcePath, show });
    const child = new MarkdownRenderChild(el);
    child.onunload = () => {
      this.#sections.delete(el);
    };
    ctx.addChild(child);
  }

  refresh(path?: string): Effect.Effect<void> {
    const sections = this.#sections;
    return Effect.gen(function* () {
      let count = 0;
      for (const section of sections.values()) {
        if (path !== undefined && section.path !== path) continue;
        yield* section.show;
        count += 1;
      }
      yield* Effect.logTrace("Refreshed live sections").pipe(
        Effect.annotateLogs({ path, count }),
      );
    }).pipe(withLogCategory("reading-view"));
  }
}
