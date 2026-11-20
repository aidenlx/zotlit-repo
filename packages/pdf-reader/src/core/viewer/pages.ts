import type { PageBox, PdfRect, ReaderPage } from "#/core/types.ts";
import type {
  PageEvent,
  PageView,
  ReaderViewer,
} from "#/core/viewer/viewer.ts";

import { isFinished } from "#/core/viewer/viewer.ts";

type LayerOrder = "above-text" | "below-text";

interface PageRecord {
  readonly view: PageView;
  readonly page: ReaderPage;
  readonly layers: Map<
    string,
    { readonly element: HTMLElement; readonly order: LayerOrder }
  >;
  canvas: boolean;
  text: boolean;
}

const LAYER_CLASS = "zpr:pointer-events-none zpr:absolute zpr:inset-0";

function percent(value: number, total: number): string {
  return `${(100 * value) / total}%`;
}

function place(record: PageRecord): void {
  const { div } = record.view;
  const text = record.view.textLayer?.div;
  const anchor = text?.parentNode === div ? text : null;
  let below: Element | null = div.querySelector(":scope > .canvasWrapper");
  for (const { element, order } of record.layers.values()) {
    if (order === "above-text") {
      div.append(element);
    } else if (anchor) {
      anchor.before(element);
    } else if (below) {
      below.after(element);
      below = element;
    } else {
      div.prepend(element);
      below = element;
    }
  }
}

export class PageRegistry {
  readonly #viewer: ReaderViewer;
  readonly #onRendered: (page: ReaderPage) => void;
  #records = new Map<number, PageRecord>();

  constructor(viewer: ReaderViewer, onRendered: (page: ReaderPage) => void) {
    this.#viewer = viewer;
    this.#onRendered = onRendered;
  }

  page(pageIndex: number): ReaderPage | null {
    return this.#record(pageIndex)?.page ?? null;
  }

  rendered(): ReaderPage[] {
    const pages: ReaderPage[] = [];
    for (let index = 0; index < this.#viewer.pageCount(); index++) {
      const view = this.#viewer.pageView(index);
      if (view && isFinished(view)) pages.push(this.page(index)!);
    }
    return pages;
  }

  view(pageIndex: number): PageView | null {
    return this.#record(pageIndex)?.view ?? null;
  }

  clear(): void {
    this.#records = new Map();
  }

  dropLayer(id: string): void {
    for (const { layers } of this.#records.values()) {
      layers.get(id)?.element.remove();
      layers.delete(id);
    }
  }

  started(event: PageEvent): void {
    const record = this.#current(event);
    if (!record) return;
    record.canvas = false;
    record.text = false;
  }

  painted(event: PageEvent): void {
    if (event.isDetailView) return;
    const record = this.#current(event);
    if (!record) return;
    record.canvas = true;
    if (!event.cssTransform) record.text = false;
    this.#join(record);
  }

  textPainted(event: PageEvent): void {
    const record = this.#current(event);
    if (!record) return;
    record.text = true;
    this.#join(record);
  }

  #join(record: PageRecord): void {
    if (!record.canvas || !record.text || !isFinished(record.view)) return;
    record.canvas = false;
    record.text = false;
    place(record);
    this.#onRendered(record.page);
  }

  #current(event: PageEvent): PageRecord | null {
    const record = this.#record(event.pageNumber - 1);
    return record && record.view === event.source ? record : null;
  }

  #record(pageIndex: number): PageRecord | null {
    const existing = this.#records.get(pageIndex);
    if (existing) return existing;
    const view = this.#viewer.pageView(pageIndex);
    if (!view) return null;
    const layers: PageRecord["layers"] = new Map();
    const page: ReaderPage = {
      pageIndex,
      get div() {
        return view.div;
      },
      get viewport() {
        return view.viewport;
      },
      get textLayer() {
        const div = view.textLayer?.div;
        return div?.parentNode === view.div ? div : null;
      },
      get rendered() {
        return isFinished(view);
      },
      layer: (id, options = {}) => {
        const existingLayer = layers.get(id);
        if (existingLayer) return existingLayer.element;
        const element = view.div.ownerDocument.createElement("div");
        element.className = LAYER_CLASS;
        element.dataset.zprLayer = id;
        layers.set(id, { element, order: options.order ?? "above-text" });
        place(record);
        return element;
      },
      toBox: (rect: PdfRect): PageBox => {
        const { viewport } = view;
        const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(
          rect[0],
          rect[1],
        ) as number[];
        const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(
          rect[2],
          rect[3],
        ) as number[];
        return {
          left: percent(Math.min(x1, x2), viewport.width),
          top: percent(Math.min(y1, y2), viewport.height),
          width: percent(Math.abs(x2 - x1), viewport.width),
          height: percent(Math.abs(y2 - y1), viewport.height),
        };
      },
    };
    const record: PageRecord = {
      view,
      page,
      layers,
      canvas: false,
      text: false,
    };
    this.#records.set(pageIndex, record);
    return record;
  }
}
