// The open PDF as the Sort Index and Page Label port reads it: per-glyph text
// content from the fork, the page boxes, and the catalog's page labels.
//
// @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
import type { ReaderDocument } from "@zotlit/pdf-reader";
import type { TextChar } from "@zotlit/pdf-reader/pdfjs";
import type { PdfPageSource, Rect, ZoteroChar } from "@zotlit/pdf-structure";

export function readerPageSource(document_: ReaderDocument): PdfPageSource {
  return {
    numPages: document_.proxy.numPages,
    getViewBox: async (pageIndex) =>
      (await requireOpen(document_.page(pageIndex))).view as unknown as Rect,
    getChars: async (pageIndex) => {
      const { items } = await requireOpen(document_.textContent(pageIndex));
      return items.flatMap((item) =>
        "chars" in item ? (item.chars ?? []).map(zoteroChar) : [],
      );
    },
    getCatalogPageLabels: () => document_.proxy.getPageLabels(),
  };
}

async function requireOpen<A>(read: Promise<A | null>): Promise<A> {
  const value = await read;
  if (value === null)
    throw new Error("The PDF closed before its page was read");
  return value;
}

function zoteroChar(char: TextChar): ZoteroChar {
  const [x1, y1, x2, y2] = char.rect as [number, number, number, number];
  return {
    c: char.c,
    u: char.u,
    rect: [x1, y1, x2, y2],
    fontSize: char.fontSize,
    fontName: char.fontName,
    rotation: char.rotation,
    baseline: char.baseline,
  };
}
