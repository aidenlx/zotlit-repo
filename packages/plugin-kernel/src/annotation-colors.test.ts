import { describe, expect, it } from "vitest";

import {
  ANNOTATION_COLORS,
  offeredSwatches,
  withRecentColor,
} from "./annotation-colors.ts";

describe("the recent colours", () => {
  const [yellow, red, green, blue, purple] = ANNOTATION_COLORS;

  it("offers the recent swatches first, then the palette in Zotero's order", () => {
    expect(offeredSwatches([purple!, "#FF6666", "#123456"], 4)).toEqual([
      purple,
      red,
      yellow,
      green,
    ]);
  });

  it("puts a use first and keeps each colour once, whatever its case", () => {
    expect(withRecentColor([red!, blue!.toUpperCase(), green!], blue!)).toEqual(
      [blue, red, green],
    );
  });

  it("keeps no more colours than the palette holds", () => {
    const full = ANNOTATION_COLORS.toReversed();

    expect(withRecentColor(full, "#123456")).toHaveLength(
      ANNOTATION_COLORS.length,
    );
  });
});
