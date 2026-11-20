import type { MenuItem, ReaderHost } from "#/core/host.ts";
import type { Subpath } from "#/core/subpath/parse.ts";
import type {
  ContextTarget,
  Observable,
  PdfReader,
  ReaderEvents,
  ReaderExtension,
  ReaderPage,
  ReaderSlot,
  SurfaceKind,
} from "#/core/types.ts";

interface Entry<H> {
  readonly extension: ReaderExtension<H>;
  readonly reader: PdfReader;
  readonly offs: Set<() => void>;
  readonly layers: Set<string>;
  readonly slots: Map<ReaderSlot, HTMLElement>;
  readonly pages: WeakMap<ReaderPage, ReaderPage>;
  instance: Disposable | null;
  live: boolean;
}

export interface AttachContext<H> {
  readonly host: H;
  readonly subpath: Subpath | null;
}

const DEFAULT_KINDS: readonly SurfaceKind[] = ["view"];

export class ExtensionHost<H> {
  readonly #host: ReaderHost;
  readonly #reader: PdfReader;
  readonly #dropLayer: (id: string) => void;
  #entries: Entry<H>[] = [];

  constructor(
    host: ReaderHost,
    reader: PdfReader,
    dropLayer: (id: string) => void,
  ) {
    this.#host = host;
    this.#reader = reader;
    this.#dropLayer = dropLayer;
  }

  attach(
    extensions: readonly ReaderExtension<H>[],
    context: AttachContext<H>,
  ): void {
    for (const extension of extensions) this.add(extension, context);
  }

  add(extension: ReaderExtension<H>, context: AttachContext<H>): void {
    const reader = this.#reader;
    if (!(extension.kinds ?? DEFAULT_KINDS).includes(reader.kind)) return;
    const entry: Entry<H> = {
      extension,
      reader: this.#facade(reader, () => entry),
      offs: new Set(),
      layers: new Set(),
      slots: new Map(),
      pages: new WeakMap(),
      instance: null,
      live: true,
    };
    this.#entries.push(entry);
    this.#fenced(entry, "attach", () => {
      const instance = extension.attach?.({
        reader: entry.reader,
        host: context.host,
        subpath: context.subpath,
      });
      if (instance) entry.instance = instance;
    });
  }

  remove(extension: ReaderExtension<H>): void {
    const removed = this.#entries.filter(
      (entry) => entry.extension === extension,
    );
    this.#entries = this.#entries.filter(
      (entry) => entry.extension !== extension,
    );
    for (const entry of removed) {
      this.#retire(entry);
      for (const layer of entry.layers) this.#dropLayer(layer);
      for (const slot of entry.slots.values()) slot.remove();
    }
  }

  drawPage(page: ReaderPage): void {
    for (const entry of this.#entries) {
      const { extension } = entry;
      if (!entry.live || !extension.drawPage) continue;
      this.#fenced(entry, "draw-page", () => {
        const owned = this.#page(entry, page);
        extension.drawPage?.(owned, owned.layer(extension.id), entry.reader);
      });
    }
  }

  contextMenu(target: ContextTarget): MenuItem[] {
    const items: MenuItem[] = [];
    for (const entry of this.#entries) {
      const { extension } = entry;
      if (!entry.live || !extension.contextMenu) continue;
      this.#fenced(entry, "context-menu", () => {
        for (const item of extension.contextMenu?.(target, entry.reader) ??
          []) {
          items.push({
            ...item,
            run: () => {
              if (entry.live)
                this.#fenced(entry, "menu-item", () => item.run());
            },
          });
        }
      });
    }
    return items;
  }

  [Symbol.dispose](): void {
    for (const entry of [...this.#entries].reverse()) this.#retire(entry);
  }

  #page(entry: Entry<H>, page: ReaderPage): ReaderPage {
    const known = entry.pages.get(page);
    if (known) return known;
    const owned = Object.create(page, {
      layer: {
        value: (id: string, options?: Parameters<ReaderPage["layer"]>[1]) => {
          entry.layers.add(id);
          return page.layer(id, options);
        },
      },
    }) as ReaderPage;
    entry.pages.set(page, owned);
    return owned;
  }

  #slot(entry: Entry<H>, reader: PdfReader, name: ReaderSlot): HTMLElement {
    const known = entry.slots.get(name);
    if (known) return known;
    const slot = reader.slot(name);
    const owned = slot.ownerDocument.createElement("div");
    owned.className = "zpr:contents";
    owned.dataset.zprExtension = entry.extension.id;
    slot.append(owned);
    entry.slots.set(name, owned);
    return owned;
  }

  #facade(reader: PdfReader, entry: () => Entry<H>): PdfReader {
    const on = <K extends keyof ReaderEvents>(
      event: K,
      listener: ReaderEvents[K],
    ): (() => void) => {
      const owner = entry();
      if (!owner.live) return () => {};
      const fenced = ((payload: Parameters<ReaderEvents[K]>[0]) => {
        if (!owner.live) return;
        const owned =
          event === "page-rendered"
            ? {
                page: this.#page(
                  owner,
                  (payload as Parameters<ReaderEvents["page-rendered"]>[0])
                    .page,
                ),
              }
            : payload;
        this.#fenced(owner, `event:${event}`, () => {
          (listener as (event: typeof owned) => void)(owned);
        });
      }) as ReaderEvents[K];
      const off = reader.on(event, fenced);
      owner.offs.add(off);
      return () => {
        owner.offs.delete(off);
        off();
      };
    };
    const observed = <T>(
      name: "state" | "document",
      source: Observable<T>,
    ): Observable<T> => ({
      get: () => source.get(),
      subscribe: (listener) => {
        const owner = entry();
        if (!owner.live) return () => {};
        const off = source.subscribe((value, previous) => {
          if (!owner.live) return;
          this.#fenced(owner, `subscribe:${name}`, () => {
            listener(value, previous);
          });
        });
        owner.offs.add(off);
        return () => {
          owner.offs.delete(off);
          off();
        };
      },
    });
    const pageOf = (page: ReaderPage | null) =>
      page && this.#page(entry(), page);
    return Object.create(reader, {
      on: { value: on },
      state: { value: observed("state", reader.state) },
      document: { value: observed("document", reader.document) },
      pageAt: {
        value: (pageIndex: number) => pageOf(reader.pageAt(pageIndex)),
      },
      renderedPages: {
        value: () => reader.renderedPages().map((page) => pageOf(page)!),
      },
      whenRendered: {
        value: async (pageIndex: number) =>
          pageOf(await reader.whenRendered(pageIndex)),
      },
      slot: {
        value: (name: ReaderSlot) => this.#slot(entry(), reader, name),
      },
    }) as PdfReader;
  }

  #fenced(entry: Entry<H>, phase: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.#host.report(error, { extension: entry.extension.id, phase });
      this.#retire(entry);
    }
  }

  #retire(entry: Entry<H>): void {
    if (!entry.live) return;
    entry.live = false;
    for (const off of entry.offs) off();
    entry.offs.clear();
    const instance = entry.instance;
    entry.instance = null;
    if (!instance) return;
    try {
      instance[Symbol.dispose]();
    } catch (error) {
      this.#host.report(error, {
        extension: entry.extension.id,
        phase: "dispose",
      });
    }
  }
}
