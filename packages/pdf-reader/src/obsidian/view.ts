import type { PdfReader, ReaderIntent } from "#/core/index.ts";
import type { Mounted, ReaderLayer } from "#/obsidian/layer.ts";
import type { Menu, TFile, WorkspaceLeaf } from "obsidian";
import { EditableFileView, Scope } from "obsidian";

import { bindReaderKeys } from "#/obsidian/keys.ts";

interface PendingMount {
  readonly file: TFile;
  readonly restored: boolean;
  readonly win: Window;
  readonly timer: number;
  focus: FocusRequest | null;
}

interface FocusRequest {
  readonly from: Element | null;
}

interface DisplayEntry {
  readonly title: string;
  readonly icon: string;
  readonly checked: boolean;
  readonly intent: ReaderIntent;
}

function ephemeral(state: unknown): {
  readonly subpath: string | null;
  readonly focus: boolean;
} {
  if (typeof state !== "object" || state === null) {
    return { subpath: null, focus: false };
  }
  const { subpath, focus } = state as Record<string, unknown>;
  return {
    subpath: typeof subpath === "string" && subpath !== "" ? subpath : null,
    focus: focus === true,
  };
}

function focusWhenReady(reader: PdfReader, request: FocusRequest): void {
  void reader.whenReady().then((document) => {
    if (document && reader.root.ownerDocument.activeElement === request.from)
      reader.focus();
  });
}

export abstract class PdfReaderView extends EditableFileView {
  #pending: PendingMount | null = null;
  #mounted: Mounted | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    bindReaderKeys(this.scope, () => this.reader);
  }

  protected abstract readerLayer(): ReaderLayer;

  get reader(): PdfReader | null {
    return this.#mounted?.reader ?? null;
  }

  override getViewType(): string {
    return this.readerLayer().viewType;
  }

  override getIcon(): string {
    return this.readerLayer().icon;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? this.readerLayer().displayName;
  }

  override canAcceptExtension(extension: string): boolean {
    return extension === "pdf";
  }

  override onload(): void {
    super.onload();
    this.register(
      this.containerEl.onWindowMigrated(() => this.reader?.windowMigrated()),
    );
  }

  override async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    const win = this.containerEl.win;
    this.#pending = {
      file,
      restored:
        this.readerLayer().claimRestored(this.leaf) ||
        !this.app.workspace.layoutReady,
      win,
      timer: win.setTimeout(() => this.#mount(null), 0),
      focus: null,
    };
  }

  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const { subpath, focus } = ephemeral(state);
    const request = focus ? { from: this.containerEl.doc.activeElement } : null;
    const pending = this.#pending;
    if (pending) {
      pending.focus ??= request;
      if (subpath !== null) this.#mount(subpath);
      return;
    }
    const reader = this.reader;
    if (!reader) return;
    if (subpath !== null) void reader.navigate(subpath);
    if (request) focusWhenReady(reader, request);
  }

  override getEphemeralState(): Record<string, unknown> {
    const state = super.getEphemeralState();
    const position = this.reader?.position();
    return position ? { ...state, subpath: position.subpath } : state;
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.#release();
    await super.onUnloadFile(file);
  }

  showSearch(): void {
    this.reader?.set({ find: { open: true } });
  }

  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const reader = this.reader;
    if (!reader) return;
    const { zoom, spread, themed } = reader.state.get();
    const { t } = this.readerLayer();
    const entries: readonly DisplayEntry[] = [
      {
        title: t("pdf_reader_fit_width"),
        icon: "lucide-move-horizontal",
        checked: zoom === "page-width",
        intent: { zoom: "page-width" },
      },
      {
        title: t("pdf_reader_fit_height"),
        icon: "lucide-move-vertical",
        checked: zoom === "page-height",
        intent: { zoom: "page-height" },
      },
      {
        title: t("pdf_reader_single_page"),
        icon: "lucide-rectangle-vertical",
        checked: spread === "none",
        intent: { spread: "none" },
      },
      {
        title: t("pdf_reader_two_page_odd"),
        icon: "lucide-book-open",
        checked: spread === "odd",
        intent: { spread: "odd" },
      },
      {
        title: t("pdf_reader_two_page_even"),
        icon: "lucide-book-open",
        checked: spread === "even",
        intent: { spread: "even" },
      },
      {
        title: t("pdf_reader_adapt_to_theme"),
        icon: "lucide-palette",
        checked: themed,
        intent: { themed: !themed },
      },
    ];
    for (const entry of entries) {
      menu.addItem((item) =>
        item
          .setSection("view")
          .setTitle(entry.title)
          .setIcon(entry.icon)
          .setChecked(entry.checked)
          .onClick(() => reader.set(entry.intent)),
      );
    }
  }

  #mount(subpath: string | null): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    pending.win.clearTimeout(pending.timer);
    this.#mounted = this.readerLayer().mount({
      element: this.contentEl,
      kind: "view",
      file: pending.file,
      view: this,
      component: this,
      sourcePath: null,
      restored: pending.restored,
      subpath,
    });
    if (pending.focus && this.#mounted)
      focusWhenReady(this.#mounted.reader, pending.focus);
  }

  #release(): void {
    const pending = this.#pending;
    this.#pending = null;
    if (pending) pending.win.clearTimeout(pending.timer);
    const mounted = this.#mounted;
    this.#mounted = null;
    mounted?.[Symbol.dispose]();
  }
}

export function viewCreator(
  layer: ReaderLayer,
): (leaf: WorkspaceLeaf) => PdfReaderView {
  class LayerView extends PdfReaderView {
    protected override readerLayer(): ReaderLayer {
      return layer;
    }
  }
  return (leaf) => new LayerView(leaf);
}

export function isPdfReaderView(view: unknown): view is PdfReaderView {
  return view instanceof PdfReaderView;
}
