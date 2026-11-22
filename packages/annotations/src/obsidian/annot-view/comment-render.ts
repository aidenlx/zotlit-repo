import { Effect } from "effect";
import { Keymap, MarkdownRenderChild, MarkdownRenderer } from "obsidian";
import type { App, Component } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import {
  commentToMarkdown,
  createCommentTurndown,
} from "@zotlit/plugin-kernel/turndown/comment.ts";

import { postProcessComment } from "#core/annot-view/comment-postprocess.ts";

export interface CommentRenderDeps {
  app: App;
  component: Component;
  getSourcePath: () => string;
}

export type CommentRenderer = (el: HTMLElement, html: string) => () => void;

export function createCommentRenderer(
  deps: CommentRenderDeps,
): CommentRenderer {
  let turndown: ReturnType<typeof createCommentTurndown> | null = null;

  return (el, html) => {
    turndown ??= createCommentTurndown(TurndownService);
    const markdown = commentToMarkdown(turndown, html);
    let disposed = false;

    el.empty();
    const child = deps.component.addChild(new MarkdownRenderChild(el));
    child.registerDomEvent(el, "click", (evt) =>
      openInternalLink(deps.app, deps.getSourcePath(), evt),
    );
    MarkdownRenderer.render(deps.app, markdown, el, deps.getSourcePath(), child)
      .then(() => {
        if (!disposed) postProcessComment(el);
      })
      .catch((error: unknown) => {
        Effect.runSyncWith(logServices)(
          Effect.logWarning("Failed to render annotation comment").pipe(
            Effect.annotateLogs({ error }),
            withLogCategory("views", "annot-view"),
          ),
        );
      });

    return () => {
      disposed = true;
      deps.component.removeChild(child);
    };
  };
}

function openInternalLink(app: App, sourcePath: string, evt: MouseEvent): void {
  const target = evt.target as Node | null;
  if (!target?.instanceOf(HTMLElement)) return;
  const anchor = target.closest("a.internal-link");
  if (!anchor?.instanceOf(HTMLAnchorElement)) return;
  const href = anchor.dataset.href ?? anchor.getAttribute("href");
  if (!href) return;
  evt.preventDefault();
  void app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(evt));
}
