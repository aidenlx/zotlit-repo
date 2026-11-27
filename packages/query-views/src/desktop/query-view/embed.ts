import type {
  EmbedComponent,
  EmbedContext,
  EmbedCreator,
} from "#obsidian/query-view/obsidian-private/embed-registry.ts";
import type { App, EventRef, TFile } from "obsidian";
import { Component, Keymap } from "obsidian";

import {
  processLiveText,
  readLiveText,
} from "@zotlit/obsidian-kit/live-text.ts";

import { NoteQueryHost } from "./note-host.ts";
import { inPreview, renderPreviewPlaceholder } from "./preview-placeholder.ts";
import type { QueryViewDeps } from "./view.tsx";

import { parseQueryFile } from "#core/query-view/query-file.ts";

export class QueryFileEmbed extends Component implements EmbedComponent {
  readonly #app: App;
  readonly #file: TFile;
  readonly #host: NoteQueryHost | null;
  readonly #placeholder: {
    el: HTMLElement;
    name: string;
    viewName: string | null;
  } | null = null;
  readonly #events: [{ offref(ref: EventRef): void }, EventRef][] = [];

  constructor(
    deps: QueryViewDeps,
    {
      context,
      file,
      viewName,
    }: {
      context: EmbedContext;
      file: TFile;
      viewName: string | null;
    },
  ) {
    super();
    this.#app = deps.app;
    this.#file = file;
    if (inPreview(context.containerEl)) {
      const name =
        viewName === null ? file.basename : `${file.basename} › ${viewName}`;
      renderPreviewPlaceholder(context.containerEl, { name });
      this.#placeholder = { el: context.containerEl, name, viewName };
      this.#host = null;
      return;
    }
    this.#host = new NoteQueryHost(deps, {
      el: context.containerEl,
      sourcePath: () => context.sourcePath,
      storage: {
        save: (text) => processLiveText(this.#app, this.#file, () => text),
        openFile: (event) => this.#open(event),
      },
      view: `${file.path}#${viewName ?? ""}`,
    });
    this.#host.selectView(viewName);
  }

  override onload(): void {
    if (this.#host === null) return;
    this.addChild(this.#host);
    const { vault } = this.#app;
    this.#events.push([
      vault,
      vault.on("modify", (changed) => {
        if (changed === this.#file) void this.loadFile();
      }),
    ]);
  }

  override onunload(): void {
    for (const [source, ref] of this.#events) source.offref(ref);
    this.#events.length = 0;
  }

  async loadFile(): Promise<void> {
    const host = this.#host;
    if (host === null) {
      const placeholder = this.#placeholder;
      if (placeholder === null) return;
      const file = parseQueryFile(await readLiveText(this.#app, this.#file));
      renderPreviewPlaceholder(placeholder.el, { ...placeholder, file });
      return;
    }
    host.setText(await readLiveText(this.#app, this.#file));
    await host.shown();
  }

  #open(event: MouseEvent): void {
    const view = this.#host?.viewName ?? null;
    void this.#app.workspace
      .getLeaf(Keymap.isModEvent(event))
      .openFile(this.#file, {
        active: true,
        state: view === null ? {} : { view },
      });
  }
}

export function createQueryFileEmbed(
  deps: QueryViewDeps,
): (...args: Parameters<EmbedCreator>) => QueryFileEmbed {
  return (context, file, subpath) =>
    new QueryFileEmbed(deps, {
      context,
      file,
      viewName:
        subpath.startsWith("#") && subpath.length > 1 ? subpath.slice(1) : null,
    });
}
