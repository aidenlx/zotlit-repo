import { describe, expect, it } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { PdfTextPosition } from "@zotlit/db";

import {
  anchorCorner,
  fitFreeTextBox,
  freeTextLayout,
  freeTextLines,
} from "./free-text-layout.ts";
import type { FitMode, TextMeasure } from "./free-text-layout.ts";

import { viewport } from "#__fixtures__/pdf-annotation-editor.ts";

const RECT = [398.804, 685.107, 560.804, 702.107] as const;
const FONT_SIZE = 14;
const PADDING = 1.5;

const CASES = [
  {
    name: "a straight page takes no turn at all",
    page: 0,
    stored: 0,
    baseline: [398.804, 103.893],
    turns: [],
    ring: { rect: [397.304, 88.393, 562.304, 108.393], turns: [] },
    hit: [398.804, 89.893, 560.804, 106.893],
  },
  {
    name: "a quarter-turned page reads down its own long edge",
    page: 90,
    stored: 0,
    baseline: [688.107, 398.804],
    turns: [{ angle: 90, pivot: [688.107, 398.804] }],
    ring: { rect: [683.607, 397.304, 703.607, 562.304], turns: [] },
    hit: [685.107, 398.804, 702.107, 560.804],
  },
  {
    name: "an upside-down page reads back the way it came",
    page: 180,
    stored: 0,
    baseline: [213.196, 688.107],
    turns: [{ angle: 180, pivot: [213.196, 688.107] }],
    ring: { rect: [49.696, 683.607, 214.696, 703.607], turns: [] },
    hit: [51.196, 685.107, 213.196, 702.107],
  },
  {
    name: "a three-quarter-turned page reads up its own long edge",
    page: 270,
    stored: 0,
    baseline: [103.893, 213.196],
    turns: [{ angle: -90, pivot: [103.893, 213.196] }],
    ring: { rect: [88.393, 49.696, 108.393, 214.696], turns: [] },
    hit: [89.893, 51.196, 106.893, 213.196],
  },
  {
    name: "an Annotation turned on a straight page turns about its own centre",
    page: 0,
    stored: 90,
    baseline: [398.804, 103.893],
    turns: [{ angle: -90, pivot: [479.804, 98.393] }],
    ring: {
      rect: [397.304, 88.393, 562.304, 108.393],
      turns: [{ angle: -90, pivot: [479.804, 98.393] }],
    },
    hit: [471.304, 17.393, 488.304, 179.393],
  },
  {
    name: "both turns compose, the page's own applied first",
    page: 90,
    stored: 90,
    baseline: [688.107, 398.804],
    turns: [
      { angle: -90, pivot: [693.607, 479.804] },
      { angle: 90, pivot: [688.107, 398.804] },
    ],
    ring: {
      rect: [683.607, 397.304, 703.607, 562.304],
      turns: [{ angle: -90, pivot: [693.607, 479.804] }],
    },
    hit: [612.607, 471.304, 774.607, 488.304],
  },
] as const;

function position(rotation: number): PdfTextPosition {
  return parseAnnotationPosition(
    {
      pageIndex: 0,
      fontSize: FONT_SIZE,
      rotation,
      rects: [[...RECT]],
    },
    "application/pdf",
  ) as PdfTextPosition;
}

for (const testCase of CASES) {
  it(testCase.name, () => {
    const page = viewport({ rotation: testCase.page });

    const layout = freeTextLayout(
      (x, y) => page.convertToViewportPoint(x, y),
      position(testCase.stored),
      PADDING,
    );

    expect(round(layout)).toEqual({
      baseline: testCase.baseline,
      turns: testCase.turns,
      ring: testCase.ring,
      hit: testCase.hit,
    });
  });
}

it("reaches the whole run it draws, wherever the two are turned", () => {
  for (const { page, stored } of CASES) {
    const turned = viewport({ rotation: page });
    const layout = freeTextLayout(
      (x, y) => turned.convertToViewportPoint(x, y),
      position(stored),
      PADDING,
    );
    const [left, top, right, bottom] = layout.hit;
    const width = RECT[2] - RECT[0];
    const height = RECT[3] - RECT[1];
    const longer = Math.max(width, height);

    expect({
      page,
      stored,
      holdsTheRun:
        right - left >= Math.min(width, height) - 0.01 &&
        bottom - top >= Math.min(width, height) - 0.01 &&
        Math.max(right - left, bottom - top) >= longer - 0.01,
    }).toEqual({ page, stored, holdsTheRun: true });
  }
});

const MONO: TextMeasure = (text, fontSize) => text.length * fontSize * 0.5;

describe("breaking free text into lines as Zotero's canvas render does, but not counting a line's trailing space", () => {
  const at = (text: string, width: number) =>
    freeTextLines(text, width, { fontSize: 10, measure: MONO });

  it("keeps one empty line for empty text", () => {
    expect(at("", 100)).toEqual([""]);
  });

  it("breaks a word too long for the line inside the word", () => {
    expect(at("abcdefghij", 22)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("starts a line at every newline, an empty one included", () => {
    expect(at("ab cd\nef", 100)).toEqual(["ab cd", "ef"]);
    expect(at("a\n\nb", 100)).toEqual(["a", "", "b"]);
  });

  it("wraps between words, not counting the space a line ends on", () => {
    expect(at("aa bb cc", 27)).toEqual(["aa bb", "cc"]);
    expect(at("aa bb", 25)).toEqual(["aa bb"]);
  });
});

describe("fitting a free-text box, as Zotero's reader fits it", () => {
  const PAGE_BOX = [0, 0, 612, 792] as const;

  const fit = (
    text: string,
    rect: [number, number, number, number] = [100, 700, 110, 710],
    rotation = 0,
  ) =>
    round(
      fitFreeTextBox(
        text,
        { rects: [rect], rotation, fontSize: 10 },
        { measure: MONO, pageBox: PAGE_BOX },
      ),
    );

  it("fits empty text one letter and the padding wide, one line high", () => {
    expect(fit("")).toEqual([100, 698, 110, 710]);
  });

  it("fits one line to its own width plus 5 points, keeping the top-left corner", () => {
    expect(fit("hello")).toEqual([100, 698, 130, 710]);
  });

  it("caps a long line at 300 points and wraps it", () => {
    const text = Array.from({ length: 13 }, () => "abcdefghi").join(" ");
    expect(fit(text)).toEqual([100, 674, 400, 710]);
  });

  it("keeps the width of a box two font sizes high and lays the text out in it", () => {
    expect(fit("aaaa bbbb cccc", [100, 680, 150, 710])).toEqual([
      100, 686, 150, 710,
    ]);
  });

  it("fits text its newlines make two lines tall to its widest line, with no padding", () => {
    expect(fit("aa\nbbbb")).toEqual([100, 686, 120, 710]);
  });

  it("widens a box sized to its text by what it reaches past the page's left inset", () => {
    expect(fit("hello", [2, 700, 12, 710])).toEqual([2, 698, 35, 710]);
  });

  it("leaves a box sized to its text where it is when it reaches past the page's bottom inset", () => {
    expect(fit("hello", [100, 2, 110, 12])).toEqual([100, 0, 130, 12]);
  });

  it("keeps the top-left corner of a turned box where it was on the page", () => {
    expect(fit("hello", [100, 700, 110, 710], 90)).toEqual([91, 709, 121, 721]);
  });

  it("moves a box of fixed width back 5 points inside the page", () => {
    expect(fit("aa", [590, 700, 640, 730])).toEqual([557, 718, 607, 730]);
    expect(fit("aa", [100, 770, 150, 800])).toEqual([100, 775, 150, 787]);
  });

  it("narrows a box sized to its text by what it reaches past the page's right inset", () => {
    expect(fit("hello", [580, 700, 590, 710])).toEqual([580, 698, 607, 710]);
  });
});

describe("fitting a free-text box after a Geometry Edit, as Zotero's reader fits it", () => {
  const PAGE_BOX = [0, 0, 612, 792] as const;
  const fit = (
    text: string,
    rect: [number, number, number, number],
    mode: FitMode,
  ) =>
    round(
      fitFreeTextBox(
        text,
        { rects: [rect], rotation: 0, fontSize: 10 },
        { measure: MONO, pageBox: PAGE_BOX, mode },
      ),
    );

  it("keeps the width of a box one line high while an edge is dragged", () => {
    expect(fit("hello", [100, 700, 110, 710], "keep-width")).toEqual([
      100, 674, 110, 710,
    ]);
  });

  it("sizes a box one line high to its text without the 300-point cap when an edge drag ends", () => {
    const text = Array.from({ length: 13 }, () => "abcdefghi").join(" ");
    expect(fit(text, [100, 700, 110, 710], "single-line")).toEqual([
      100, 686, 607, 710,
    ]);
  });

  it("keeps the width of a box two font sizes high when an edge drag ends", () => {
    expect(fit("hello", [100, 680, 110, 710], "single-line")).toEqual([
      100, 674, 110, 710,
    ]);
  });
});

describe("anchoring a resized box by one corner", () => {
  it("keeps the named corner where it was", () => {
    expect(
      round(
        anchorCorner([100, 700, 200, 720], [150, 30], {
          rotation: 0,
          corner: "br",
        }),
      ),
    ).toEqual([50, 700, 200, 730]);
  });

  it("keeps the named corner of a turned box where it was on the page", () => {
    expect(
      round(
        anchorCorner([100, 700, 200, 720], [150, 30], {
          rotation: 90,
          corner: "tl",
        }),
      ),
    ).toEqual([80, 720, 230, 750]);
  });
});

function round<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "number" ? Math.round(item * 1000) / 1000 : item,
    ),
  ) as T;
}
