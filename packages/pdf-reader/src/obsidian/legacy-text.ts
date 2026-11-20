import type { LegacyText, LegacyTextRequest } from "#/core/index.ts";

interface LegacyPage {
  getTextContent(options: {
    readonly includeMarkedContent: boolean;
    readonly disableNormalization: boolean;
    readonly includeChars: boolean;
  }): Promise<{ readonly items: readonly { readonly str?: string }[] }>;
}

interface LegacyDocument {
  getPage(pageNumber: number): Promise<LegacyPage>;
}

interface LegacyLoadingTask {
  readonly promise: Promise<LegacyDocument>;
  destroy(): Promise<void>;
}

export interface LegacyPdfJs {
  getDocument(parameters: Readonly<Record<string, unknown>>): LegacyLoadingTask;
}

const OBSIDIAN_DOCUMENT_OPTIONS: Readonly<Record<string, unknown>> = {
  cMapUrl: "/lib/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
  wasmUrl: "/lib/pdfjs/wasm/",
  iccUrl: "/lib/pdfjs/iccs/",
  isEvalSupported: false,
  enableXfa: true,
};

const TEXT_OPTIONS = {
  includeMarkedContent: true,
  disableNormalization: true,
  includeChars: true,
};

export function legacyText(
  load: () => Promise<LegacyPdfJs>,
  request: LegacyTextRequest,
): LegacyText {
  let disposed = false;
  let task: LegacyLoadingTask | null = null;
  let opened: Promise<LegacyDocument | null> | null = null;
  const pages = new Map<number, Promise<readonly string[] | null>>();
  const open = async (): Promise<LegacyDocument | null> => {
    const [library, data] = await Promise.all([load(), request.bytes()]);
    if (disposed || !data) return null;
    task = library.getDocument({
      ...OBSIDIAN_DOCUMENT_OPTIONS,
      data,
      ...(request.password === undefined ? {} : { password: request.password }),
    });
    return task.promise;
  };
  const read = async (pageIndex: number): Promise<readonly string[] | null> => {
    opened ??= open();
    const document = await opened;
    if (!document) return null;
    const page = await document.getPage(pageIndex + 1);
    const content = await page.getTextContent(TEXT_OPTIONS);
    return content.items.flatMap((item) =>
      item.str === undefined ? [] : [item.str],
    );
  };
  return {
    items: (pageIndex) => {
      let cached = pages.get(pageIndex);
      if (!cached) {
        cached = read(pageIndex);
        pages.set(pageIndex, cached);
      }
      return cached;
    },
    [Symbol.dispose]: () => {
      disposed = true;
      pages.clear();
      void task?.destroy();
    },
  };
}
