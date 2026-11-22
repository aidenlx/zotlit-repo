import type { PdfPageSource, Rect, ZoteroChar } from "@zotlit/pdf-structure";
import type { ReaderDocument, TextChar } from "@zotlit/reader-api";

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
