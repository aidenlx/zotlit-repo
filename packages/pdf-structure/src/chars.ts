import { getStructuredChars } from "#vendor/structure.js";

/** `[x1, y1, x2, y2]` in PDF page space. */
export type Rect = readonly [number, number, number, number];

/** A character in the shape Zotero's `structure.js` consumes. */
export interface ZoteroChar {
  c: string;
  u: string;
  rect: Rect;
  fontSize: number;
  fontName: string;
  /** Snapped to 0, 90, 180 or 270. */
  rotation: number;
  baseline: number;
}

/** A `ZoteroChar` after the line grouping ran over its page. */
export interface StructuredChar extends ZoteroChar {
  /** Index into the page's Structured Characters — what a Sort Index carries. */
  offset: number;
  /** `rect`, stretched to the height (or width) of its line. */
  inlineRect: Rect;
  /** Stamped by the caller, as Zotero's own provider does. */
  pageIndex?: number;
  spaceAfter?: boolean;
  wordBreakAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  ignorable?: boolean;
}

/** One page's Structured Characters, with the page box the Sort Index needs. */
export interface StructuredPage {
  readonly pageIndex: number;
  /** `page.view` — the PDF page box. */
  readonly viewBox: Rect;
  readonly chars: readonly StructuredChar[];
}

export function structureChars(
  pageIndex: number,
  viewBox: Rect,
  zoteroChars: readonly ZoteroChar[],
): StructuredPage {
  const chars = getStructuredChars(zoteroChars);
  for (const char of chars) char.pageIndex = pageIndex;
  return { pageIndex, viewBox, chars };
}
