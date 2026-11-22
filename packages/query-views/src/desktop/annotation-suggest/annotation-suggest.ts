import type { QueryHandle } from "#desktop/item-query/handle.ts";
import { Component, EditorSuggest } from "obsidian";
import type {
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";

import {
  appendExcerptText,
  pageLocator,
} from "@zotlit/annotations/desktop/annot-view/excerpt-parts.tsx";
import type { CommentRenderer } from "@zotlit/annotations/obsidian/annot-view/comment-render.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { CurrentAnswer } from "@zotlit/plugin-services/obsidian/item-lookup/current-answer.ts";
import { DEFAULT_LIMIT } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { insertAnnotation } from "./annotation-insert.ts";
import type { AnnotationInsertDeps } from "./annotation-insert.ts";
import { searchAnnotations } from "./annotation-search.ts";
import type { AnnotationHit } from "./annotation-search.ts";

import { resolveAnnotationTrigger } from "#core/annotation-suggest/annotation-trigger.ts";

export interface AnnotationSuggestDeps extends AnnotationInsertDeps {
  bridge: Pick<EffectBridge, "runSync">;
  activeEditor: () => import("obsidian").MarkdownFileInfo | null;
  query: Pick<QueryHandle, "run">;
  settings: Pick<PluginSettings["Service"], "current">;
  commentRenderer: (owner: Component, sourcePath: string) => CommentRenderer;
}

export class AnnotationEditorSuggest extends EditorSuggest<AnnotationHit> {
  readonly #deps: AnnotationSuggestDeps;
  #searchController?: AbortController;
  #incoming: readonly AnnotationHit[] = [];
  #rows: {
    hits: readonly AnnotationHit[];
    stack: DisposableStack;
    renderComment: CommentRenderer;
  } | null = null;
  readonly #answer = new CurrentAnswer<AnnotationHit>(this.suggestEl);

  constructor(deps: AnnotationSuggestDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.suggestEl.addClass("zt-root");
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_annotation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    const trigger = this.#deps.bridge.runSync(this.#deps.settings.current)[
      "citation.annotation-trigger"
    ];
    const found = resolveAnnotationTrigger(
      editor.getLine(cursor.line),
      cursor.ch,
      {
        trigger,
      },
    );
    if (!found) return null;
    return {
      start: { line: cursor.line, ch: found.start },
      end: { line: cursor.line, ch: found.end },
      query: found.query,
    };
  }

  override getSuggestions(
    context: EditorSuggestContext,
  ): Promise<AnnotationHit[]> {
    return this.#answer.track(this.#search(context)) as Promise<
      AnnotationHit[]
    >;
  }

  async #search(
    context: EditorSuggestContext,
  ): Promise<AnnotationHit[] | null> {
    this.#searchController?.abort();
    const controller = new AbortController();
    this.#searchController = controller;
    const hits =
      (await searchAnnotations(this.#deps.query, context.query, {
        signal: controller.signal,
        limit: this.limit,
      })) ?? [];
    if (controller.signal.aborted) return null;
    this.#incoming = hits;
    return hits;
  }

  override close(): void {
    this.#searchController?.abort();
    this.#rows?.stack.dispose();
    this.#rows = null;
    this.#incoming = [];
    this.#answer.close();
    super.close();
  }

  override renderSuggestion(hit: AnnotationHit, el: HTMLElement): void {
    if (
      this.#rows === null ||
      (this.#rows.hits !== this.#incoming && this.#incoming.includes(hit))
    ) {
      this.#rows?.stack.dispose();
      this.#rows = this.#openRows(this.#incoming);
    }
    const { stack, renderComment } = this.#rows;
    stack.defer(renderAnnotationHit(hit, el, renderComment));
  }

  #openRows(hits: readonly AnnotationHit[]) {
    const stack = new DisposableStack();
    const owner = stack.adopt(new Component(), (component) =>
      component.unload(),
    );
    owner.load();
    return {
      hits,
      stack,
      renderComment: this.#deps.commentRenderer(
        owner,
        this.context?.file?.path ?? "",
      ),
    };
  }

  override selectSuggestion(
    hit: AnnotationHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    this.#answer.choose(hit, evt, (chosen) => this.#insert(chosen));
  }

  #insert(hit: AnnotationHit): void {
    const context = this.context;
    if (!context) return;
    const { editor, file, start, end } = context;
    const info = this.#deps.activeEditor();
    if (!info || info.editor !== editor || info.file !== file) return;
    this.close();
    void insertAnnotation(this.#deps, {
      hit,
      info,
      isCurrent: () => this.#deps.activeEditor()?.editor === editor,
      range: { from: editor.posToOffset(start), to: editor.posToOffset(end) },
    });
  }
}

export function renderAnnotationHit(
  hit: AnnotationHit,
  el: HTMLElement,
  renderComment: CommentRenderer,
): () => void {
  el.addClass("zt:flex", "zt:gap-2");
  const swatch = el.createDiv({
    cls: "zt:mt-1 zt:w-1 zt:shrink-0 zt:self-stretch zt:rounded-sm zt:bg-(--zt-annot-color)",
  });
  if (hit.color) swatch.style.setProperty("--zt-annot-color", hit.color);
  const body = el.createDiv({ cls: "zt:min-w-0 zt:flex-1" });
  if (hit.text) appendExcerptText(body, hit.text, "zt:m-0 zt:line-clamp-3");
  const cleanup = hit.comment
    ? renderComment(
        body.createDiv({
          cls: hit.text
            ? "zt:line-clamp-2 zt:text-sm zt:text-muted-foreground"
            : "zt:line-clamp-3",
        }),
        hit.comment,
      )
    : () => {};
  if (!hit.text && !hit.comment)
    body.createDiv({
      text: m.workbench_annotation_type({ type: hit.type ?? "" }),
    });
  const meta = [
    hit.pageLabel === null || hit.pageLabel === ""
      ? null
      : pageLocator(hit.pageLabel),
    hit.title,
  ].filter((part): part is string => !!part);
  if (meta.length > 0)
    body.createDiv({
      cls: "zt:truncate zt:text-xs zt:text-faint",
      text: meta.join(" · "),
    });
  return cleanup;
}
