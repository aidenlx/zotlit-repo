import type { PDFDocumentProxy, PDFPageProxy, TextContent } from "#/pdfjs.ts";

export interface ReaderDocument {
  readonly proxy: PDFDocumentProxy;
  readonly fingerprint: string;
  readonly key: string;
  current(): boolean;
  bytes(): Promise<Uint8Array | null>;
  page(pageIndex: number): Promise<PDFPageProxy | null>;
  textContent(pageIndex: number): Promise<TextContent | null>;
}

export type HeadlessDocument = ReaderDocument & AsyncDisposable;

export interface ManagedDocument {
  readonly document: ReaderDocument;
  retire(): void;
}

function whileLive(
  live: () => boolean,
): <A>(read: () => Promise<A>) => Promise<A | null> {
  return async (read) => {
    if (!live()) return null;
    try {
      const value = await read();
      return live() ? value : null;
    } catch (error) {
      if (!live()) return null;
      throw error;
    }
  };
}

export function holdDocument(inner: ReaderDocument): ManagedDocument {
  let live = true;
  const whileHeld = whileLive(() => live);
  return {
    document: {
      proxy: inner.proxy,
      fingerprint: inner.fingerprint,
      key: inner.key,
      current: () => live && inner.current(),
      bytes: () => whileHeld(() => inner.bytes()),
      page: (pageIndex) => whileHeld(() => inner.page(pageIndex)),
      textContent: (pageIndex) => whileHeld(() => inner.textContent(pageIndex)),
    },
    retire: () => {
      live = false;
    },
  };
}

export function manageDocument(
  proxy: PDFDocumentProxy,
  key: string,
): ManagedDocument {
  let live = true;
  const texts = new Map<number, Promise<TextContent>>();
  const whileCurrent = whileLive(() => live);
  const text = (pageIndex: number): Promise<TextContent> => {
    let cached = texts.get(pageIndex);
    if (!cached) {
      const read = proxy
        .getPage(pageIndex + 1)
        .then((page) => page.getTextContent({ includeChars: true }));
      void read.catch(() => texts.delete(pageIndex));
      texts.set(pageIndex, read);
      cached = read;
    }
    return cached;
  };
  return {
    document: {
      proxy,
      fingerprint: proxy.fingerprints[0]!,
      key,
      current: () => live,
      bytes: () => whileCurrent(() => proxy.getData()),
      page: (pageIndex) => whileCurrent(() => proxy.getPage(pageIndex + 1)),
      textContent: (pageIndex) => whileCurrent(() => text(pageIndex)),
    },
    retire: () => {
      live = false;
      texts.clear();
    },
  };
}
