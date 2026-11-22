import { getStructuredChars } from "#vendor/structure.js";

export type Rect = readonly [number, number, number, number];

export interface ZoteroChar {
  c: string;
  u: string;
  rect: Rect;
  fontSize: number;
  fontName: string;
  rotation: number;
  baseline: number;
}

export interface StructuredChar extends ZoteroChar {
  offset: number;
  inlineRect: Rect;
  pageIndex?: number;
  spaceAfter?: boolean;
  wordBreakAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  ignorable?: boolean;
}

export interface StructuredPage {
  readonly pageIndex: number;
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
