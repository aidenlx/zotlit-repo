import type { Rect, StructuredPage, ZoteroChar } from "#chars.ts";
import type { PageLabelSource, PreviousAnnotation } from "#page-label.ts";
import type { PdfPosition } from "#sort-index.ts";
import type {
  RangeAdjustment,
  SelectedText,
  TextSelection,
} from "#text-selection.ts";

import { logLibrary } from "@zotlit/shared/logging";

import { structureChars } from "#chars.ts";
import { alignPageLabel, extractPageLabels } from "#page-label.ts";
import { computeSortIndex } from "#sort-index.ts";
import { adjustRange, rectRotation, selectText } from "#text-selection.ts";

const CLOSED = Symbol("closed");

export type PdfPageSource = PageLabelSource & {
  getChars(pageIndex: number): Promise<readonly ZoteroChar[]>;
};

export class PdfTextStructure {
  readonly #source: PdfPageSource;
  readonly #cache = new Map<number, Promise<StructuredPage>>();
  readonly #settled = new Map<number, StructuredPage>();
  readonly #emptyPagesLogged = new Set<number>();
  #pageLabels: Promise<readonly string[]> | null = null;
  readonly #closed = Promise.withResolvers<typeof CLOSED>();

  constructor(source: PdfPageSource) {
    this.#source = source;
  }

  close(): void {
    this.#closed.resolve(CLOSED);
  }

  page(pageIndex: number): Promise<StructuredPage> {
    const cached = this.#cache.get(pageIndex);
    if (cached) return cached;
    const page = this.#structure(pageIndex);
    this.#cache.set(pageIndex, page);
    void page.then(
      (structured) => this.#settled.set(pageIndex, structured),
      () => undefined,
    );
    return page;
  }

  textRotation(pageIndex: number, rect: Rect): number | null {
    const page = this.#settled.get(pageIndex);
    return page ? rectRotation(page.chars, rect) : null;
  }

  async #structure(pageIndex: number): Promise<StructuredPage> {
    const source = this.#source;
    const [viewBox, chars] = await Promise.all([
      source.getViewBox(pageIndex),
      source.getChars(pageIndex),
    ]);
    return structureChars(pageIndex, viewBox, chars);
  }

  pageLabels(): Promise<readonly string[]> {
    this.#pageLabels ??= extractPageLabels(this.#source, async (pageIndex) => {
      const page = await this.page(pageIndex);
      return page.chars;
    });
    return this.#pageLabels;
  }

  async sortIndex(position: PdfPosition): Promise<string> {
    const page = await Promise.race([
      this.page(position.pageIndex),
      this.#closed.promise,
    ]);
    if (page === CLOSED)
      throw new Error("The PDF closed before its page was read");
    if (!page.chars.length && !this.#emptyPagesLogged.has(page.pageIndex)) {
      this.#emptyPagesLogged.add(page.pageIndex);
      logLibrary({
        level: "debug",
        category: ["zotlit", "pdf-structure"],
        message: "Page carries no text layer; Sort Index offset stays 0",
        properties: { pageIndex: page.pageIndex },
      });
    }
    return computeSortIndex(page, position);
  }

  async selectText(selection: TextSelection): Promise<SelectedText | null> {
    const pages = await Promise.all(
      selection.pages.map(({ pageIndex }) => this.page(pageIndex)),
    );
    return selectText(
      selection,
      new Map(pages.map((page) => [page.pageIndex, page])),
    );
  }

  async adjustRange(adjustment: RangeAdjustment): Promise<SelectedText | null> {
    const { position } = adjustment;
    const spills =
      position.nextPageRects !== undefined ||
      ("point" in adjustment
        ? adjustment.point.pageIndex === position.pageIndex + 1
        : adjustment.end === "end" &&
          (adjustment.step === "right" || adjustment.step === "down"));
    const indexes =
      spills && position.pageIndex + 1 < this.#source.numPages
        ? [position.pageIndex, position.pageIndex + 1]
        : [position.pageIndex];
    const pages = await Promise.all(
      indexes.map((pageIndex) => this.page(pageIndex)),
    );
    return adjustRange(
      adjustment,
      new Map(pages.map((page) => [page.pageIndex, page])),
    );
  }

  async pageLabel(
    pageIndex: number,
    previous: readonly PreviousAnnotation[],
  ): Promise<string> {
    const labels = await Promise.race([
      this.pageLabels(),
      this.#closed.promise,
    ]);
    return alignPageLabel(labels === CLOSED ? [] : labels, pageIndex, previous);
  }
}
