import type { StructuredChar } from "#chars.ts";

export declare function getNormalizedUnits(
  text: string | null | undefined,
): string[];

export declare function alignTextUnits(
  domUnits: readonly string[],
  readerUnits: readonly string[],
): number[];

export declare function buildReaderUnitMap(chars: readonly StructuredChar[]): {
  readerUnits: string[];
  readerStartOffsets: number[];
  readerEndOffsets: number[];
};

export declare function selectionTextMatches(
  selectionText: string,
  rangeText: string,
): boolean;
