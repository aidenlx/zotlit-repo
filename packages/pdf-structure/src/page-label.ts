import type { Rect, StructuredChar } from "#chars.ts";
import type {
  PageLabelDocument,
  StructuredCharsProvider,
} from "#vendor/page-label.js";

import { getPageLabels } from "#vendor/page-label.js";

export interface PageLabelSource {
  readonly numPages: number;
  getViewBox(pageIndex: number): Promise<Rect>;
  getCatalogPageLabels(): Promise<readonly string[] | null>;
}

export async function extractPageLabels(
  source: PageLabelSource,
  structuredChars: (pageIndex: number) => Promise<readonly StructuredChar[]>,
): Promise<readonly string[]> {
  const document: PageLabelDocument = {
    catalog: { numPages: source.numPages, pageLabels: null },
    pdfManager: { ensureCatalog: () => source.getCatalogPageLabels() },
    getPage: async (pageIndex) => ({
      view: await source.getViewBox(pageIndex),
    }),
  };
  const provider: StructuredCharsProvider = (pageIndex) =>
    structuredChars(pageIndex);
  return getPageLabels(document, provider);
}

export interface PreviousAnnotation {
  readonly pageLabel: string;
  readonly pageIndex: number;
  readonly readOnly?: boolean;
}

function readsAsItsOwnInteger(label: string): boolean {
  return Number.parseInt(label) === Number(label);
}

const PAGE_RANGE = /[0-9]+[-–][0-9]+/u;

export function alignPageLabel(
  pageLabels: readonly string[],
  pageIndex: number,
  previous: readonly PreviousAnnotation[],
): string {
  const extracted = pageLabels[pageIndex];
  let pageLabel = extracted || (pageIndex + 1).toString();

  for (let i = previous.length - 1; i >= 0; i--) {
    const annotation = previous[i]!;
    if (
      annotation.readOnly ||
      annotation.pageLabel === "-" ||
      annotation.pageIndex > pageIndex
    ) {
      continue;
    }
    const deltaPageLabel =
      Number.parseInt(extracted ?? "") -
      Number.parseInt(pageLabels[annotation.pageIndex] ?? "");
    const deltaPageIndex = pageIndex - annotation.pageIndex;
    if (
      deltaPageLabel === deltaPageIndex &&
      (readsAsItsOwnInteger(annotation.pageLabel) ||
        PAGE_RANGE.test(annotation.pageLabel))
    ) {
      pageLabel = (
        pageIndex +
        (Number.parseInt(annotation.pageLabel) - annotation.pageIndex)
      ).toString();
    }
    break;
  }

  return pageLabel;
}
