import type { MenuItem, ReaderHost } from "#/core/host.ts";
import type { Subpath } from "#/core/subpath/parse.ts";
import type {
  ContextTarget,
  Observable,
  PdfReader,
  ReaderEvents,
  ReaderExtension,
  ReaderPage,
  SurfaceKind,
} from "#/core/types.ts";

interface Entry<H> {
  readonly extension: ReaderExtension<H>;
  readonly reader: PdfReader;
  readonly offs: Set<() => void>;
  instance: Disposable | null;
  live: boolean;
}

const DEFAULT_KINDS: readonly SurfaceKind[] = ["view"];

export class ExtensionHost<H> {
  readonly #host: ReaderHost;
  readonly #entries: Entry<H>[] = [];

  constructor(host: ReaderHost) {
    this.#host = host;
  }

  attach(
    reader: PdfReader,
    extensions: readonly ReaderExtension<H>[],
    context: { readonly host: H; readonly subpath: Subpath | null },
  ): void {
    for (const extension of extensions) {
      if (!(extension.kinds ?? DEFAULT_KINDS).includes(reader.kind)) continue;
      const entry: Entry<H> = {
        extension,
        reader: this.#facade(reader, () => entry),
        offs: new Set(),
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
  }

  drawPage(page: ReaderPage): void {
    for (const entry of this.#entries) {
      const { extension } = entry;
      if (!entry.live || !extension.drawPage) continue;
      this.#fenced(entry, "draw-page", () => {
        extension.drawPage?.(page, page.layer(extension.id), entry.reader);
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

  #facade(reader: PdfReader, entry: () => Entry<H>): PdfReader {
    const on = <K extends keyof ReaderEvents>(
      event: K,
      listener: ReaderEvents[K],
    ): (() => void) => {
      const owner = entry();
      if (!owner.live) return () => {};
      const fenced = ((payload: Parameters<ReaderEvents[K]>[0]) => {
        if (!owner.live) return;
        this.#fenced(owner, `event:${event}`, () => {
          (listener as (event: typeof payload) => void)(payload);
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
    return Object.create(reader, {
      on: { value: on },
      state: { value: observed("state", reader.state) },
      document: { value: observed("document", reader.document) },
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
