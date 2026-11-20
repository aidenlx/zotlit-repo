import type { PdfReader, SurfaceKind } from "#/core/index.ts";
import type { Mounted, ReaderLayer } from "#/obsidian/layer.ts";
import type { EmbedContext } from "#/obsidian/private.ts";
import type { TFile } from "obsidian";
import { Component, Menu, setIcon, setTooltip } from "obsidian";

import { parseSubpath } from "#/core/index.ts";
import { showBelow } from "#/obsidian/host.ts";
import { vaultSource } from "#/obsidian/source.ts";

const STATIC_SCALE = 2;

function kindOf(context: EmbedContext): SurfaceKind {
  if (context.displayMode === true) return "static";
  if (context.containerEl.parentElement?.hasClass("hover-popover")) {
    return "hover";
  }
  if (context.containerEl.hasClass("canvas-node-content")) return "canvas";
  return "embed";
}

export class PdfEmbed extends Component {
  readonly #layer: ReaderLayer;
  readonly #context: EmbedContext;
  readonly #file: TFile;
  readonly #subpath: string;
  readonly kind: SurfaceKind;
  readonly #stopped = new AbortController();
  #mounted: Mounted | null = null;

  constructor(embed: {
    readonly layer: ReaderLayer;
    readonly context: EmbedContext;
    readonly file: TFile;
    readonly subpath: string;
  }) {
    super();
    this.#layer = embed.layer;
    this.#context = embed.context;
    this.#file = embed.file;
    this.#subpath = embed.subpath;
    this.kind = kindOf(embed.context);
    embed.context.containerEl.addClass("pdf-embed");
  }

  get reader(): PdfReader | null {
    return this.#mounted?.reader ?? null;
  }

  async loadFile(): Promise<void> {
    if (this.#mounted || this.#stopped.signal.aborted) return;
    if (this.kind === "static") {
      await this.#paintStatic();
      return;
    }
    const { containerEl, sourcePath } = this.#context;
    const mounted = this.#layer.mount({
      element: containerEl,
      kind: this.kind,
      file: this.#file,
      view: null,
      component: this,
      sourcePath,
      restored: false,
      subpath: this.#subpath === "" ? null : this.#subpath,
    });
    if (!mounted) return;
    this.#mounted = mounted;
    const { reader } = mounted;
    this.register(
      containerEl.onWindowMigrated(() => this.reader?.windowMigrated()),
    );
    reader.set({ sidebar: { open: false } });
    if (this.kind === "embed") {
      reader.root.addClass("interactive-child");
      this.#addMoreButton(reader);
      this.#fitHeight(reader);
    } else if (this.kind === "canvas") {
      reader.container.addEventListener("pointerdown", (event) => {
        const target = event.targetNode;
        if (!target?.instanceOf(HTMLElement)) return;
        const layer = target.closest(".textLayer");
        if (layer && layer !== target) event.stopPropagation();
      });
    }
  }

  override onunload(): void {
    this.#stopped.abort();
    const mounted = this.#mounted;
    this.#mounted = null;
    mounted?.[Symbol.dispose]();
  }

  #fitHeight(reader: PdfReader): void {
    const { height } = parseSubpath(this.#subpath);
    const { containerEl } = this.#context;
    const apply = () => {
      const content =
        height !== null && height > 0
          ? height
          : reader.pageAt(reader.state.get().pageIndex)?.viewport.height;
      if (content === undefined) return;
      containerEl.style.setProperty("--zpr-embed-height", `${content}px`);
      containerEl.addClass("zpr-fit-height");
    };
    apply();
    reader.state.subscribe((state, previous) => {
      if (
        state.scale !== previous.scale ||
        state.pageIndex !== previous.pageIndex
      ) {
        apply();
      }
    });
    reader.on("ready", apply);
  }

  #addMoreButton(reader: PdfReader): void {
    const { app, linktext, sourcePath } = this.#context;
    const { t } = this.#layer;
    const button = reader
      .slot("toolbar-end")
      .createDiv({ cls: "clickable-icon" });
    setTooltip(button, t("pdf_reader_embed_more_options"));
    setIcon(button, "lucide-more-vertical");
    button.addEventListener("click", () => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setSection("open")
          .setTitle(t("pdf_reader_embed_open"))
          .setIcon("lucide-file-symlink")
          .onClick(() => {
            void app.workspace.openLinkText(linktext, sourcePath);
          }),
      );
      app.workspace.handleLinkContextMenu(menu, linktext, sourcePath);
      showBelow(menu, button);
    });
  }

  async #paintStatic(): Promise<void> {
    const { signal } = this.#stopped;
    const { app, containerEl } = this.#context;
    containerEl.addClass("zpr-static");
    const document = await this.#layer.engine
      .load(vaultSource(app, this.#file), {
        signal,
        ownerDocument: containerEl.doc,
      })
      .catch((error: unknown) => {
        if (!signal.aborted) this.#layer.report(error, { phase: "static" });
        return null;
      });
    if (!document) return;
    try {
      const { page: wanted } = parseSubpath(this.#subpath);
      const last = document.proxy.numPages - 1;
      const pageIndex = Math.min(Math.max((wanted ?? 1) - 1, 0), last);
      const page = await document.page(pageIndex);
      if (!page || signal.aborted) return;
      const viewport = page.getViewport({ scale: STATIC_SCALE });
      const canvas = containerEl.doc.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      if (signal.aborted) return;
      containerEl.createEl("img", {
        attr: { src: canvas.toDataURL(), alt: this.#file.basename },
      });
    } catch (error) {
      if (!signal.aborted) this.#layer.report(error, { phase: "static" });
    } finally {
      await document[Symbol.asyncDispose]();
    }
  }
}
