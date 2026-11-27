import type { MarkdownPostProcessorContext, Plugin } from "obsidian";
import { MarkdownRenderChild } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { NoteQueryHost } from "./note-host.ts";
import { inPreview, renderPreviewPlaceholder } from "./preview-placeholder.ts";
import type { QueryViewDeps } from "./view.tsx";

import {
  parseQueryFile,
  QUERY_FILE_EXTENSION,
} from "#core/query-view/query-file.ts";
import {
  writeBlockAt,
  writeBlockCode,
} from "#obsidian/query-view/block-write.ts";

const IN_QUERY_VIEW = ".zt-query-view";
const IN_COMMENT = ".zt-annot-comment";

type QueryBlockPlugin = Pick<Plugin, "registerMarkdownCodeBlockProcessor">;

export function registerQueryBlock(
  plugin: QueryBlockPlugin,
  deps: QueryViewDeps,
): void {
  plugin.registerMarkdownCodeBlockProcessor(
    QUERY_FILE_EXTENSION,
    (source, el, ctx) => {
      const block = new QueryBlock(el, deps, { ctx, source });
      ctx.addChild(block);
      return block.shown;
    },
  );
}

class QueryBlock extends MarkdownRenderChild {
  readonly #deps: QueryViewDeps;
  readonly #ctx: MarkdownPostProcessorContext;
  #source: string;
  #host: NoteQueryHost | null = null;
  #lineStart: number | null = null;
  #leaving = false;

  constructor(
    el: HTMLElement,
    deps: QueryViewDeps,
    { ctx, source }: { ctx: MarkdownPostProcessorContext; source: string },
  ) {
    super(el);
    this.#deps = deps;
    this.#ctx = ctx;
    this.#source = source;
  }

  override onload(): void {
    if (this.containerEl.closest(IN_QUERY_VIEW) !== null) {
      this.containerEl.createEl("pre").createEl("code", { text: this.#source });
      return;
    }
    if (inPreview(this.containerEl)) {
      renderPreviewPlaceholder(this.containerEl, {
        name: null,
        file: parseQueryFile(this.#source),
      });
      return;
    }
    const sourcePath = this.#ctx.sourcePath;
    const host = new NoteQueryHost(this.#deps, {
      el: this.containerEl,
      sourcePath: () => sourcePath,
      storage: {
        save: (text) => this.#save(text),
        canSave: () => this.#canSave(),
      },
      view: this.#source,
    });
    this.addChild(host);
    host.setText(this.#source);
    this.#host = host;
  }

  override unload(): void {
    this.#leaving = true;
    super.unload();
  }

  get shown(): Promise<void> {
    return this.#host?.shown() ?? Promise.resolve();
  }

  #canSave(): boolean {
    if (this.#leaving) return this.#lineStart !== null;
    const el = this.containerEl;
    if (el.closest(IN_COMMENT) !== null) return false;
    const info = this.#ctx.getSectionInfo(el);
    if (info !== null) this.#lineStart = info.lineStart;
    return info !== null;
  }

  async #save(file: string): Promise<void> {
    const text = file.replace(/\n$/, "");
    const previous = this.#source;
    if (text === previous) return;
    this.#source = text;
    this.#host?.showsAs(text);
    try {
      const edit = { previous, next: text };
      if (this.#leaving && this.#lineStart !== null)
        await writeBlockAt(
          this.#deps.app,
          { sourcePath: this.#ctx.sourcePath, lineStart: this.#lineStart },
          edit,
        );
      else
        await writeBlockCode(
          this.#deps.app,
          { ctx: this.#ctx, el: this.containerEl },
          edit,
        );
    } catch (error) {
      this.#source = previous;
      new BaseNotice(m.query_block_save_failed());
      throw error;
    }
  }
}
