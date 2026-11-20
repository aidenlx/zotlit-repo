export type {
  Rect,
  StructuredChar,
  StructuredPage,
  ZoteroChar,
} from "#chars.ts";
export { structureChars } from "#chars.ts";
export type { PageLabelSource, PreviousAnnotation } from "#page-label.ts";
export { alignPageLabel, extractPageLabels } from "#page-label.ts";
export type { PdfPageSource } from "#session.ts";
export { PdfTextStructure } from "#session.ts";
export type {
  PdfInkPosition,
  PdfPosition,
  PdfRectsPosition,
} from "#sort-index.ts";
export { computeSortIndex } from "#sort-index.ts";
export type {
  PagePoint,
  RangeAdjustment,
  RangeEnd,
  RangeStep,
  SelectedText,
  TextLayerSelection,
  TextSelection,
} from "#text-selection.ts";
