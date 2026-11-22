import type { Rect, StructuredChar } from "#chars.ts";

export interface PageLabelDocument {
  readonly catalog: {
    readonly numPages: number;
    readonly pageLabels: readonly string[] | null;
  };
  readonly pdfManager: {
    ensureCatalog(field: "pageLabels"): Promise<readonly string[] | null>;
  };
  getPage(pageIndex: number): Promise<{ readonly view: Rect }>;
}

export type StructuredCharsProvider = (
  pageIndex: number,
) => Promise<readonly StructuredChar[]>;

export interface ExtractedPageLabel {
  pageIndex: number;
  type: "arabic" | "roman";
  integer: number;
  chars: readonly StructuredChar[];
}

export declare function getPageLabel(
  pdfDocument: PageLabelDocument,
  structuredCharsProvider: StructuredCharsProvider,
  pageIndex: number,
): Promise<ExtractedPageLabel | null>;

export declare function predictPageLabels(
  extractedPageLabels: readonly ExtractedPageLabel[] | null,
  catalogPageLabels: readonly string[] | null,
  pagesCount: number,
): string[];

export declare function getPageLabels(
  pdfDocument: PageLabelDocument,
  structuredCharsProvider: StructuredCharsProvider,
): Promise<string[]>;
