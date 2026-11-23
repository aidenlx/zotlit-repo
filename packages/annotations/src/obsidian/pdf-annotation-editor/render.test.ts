// @vitest-environment happy-dom

import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import { describe, expect, it } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";

import { fitFreeTextBox } from "./free-text-layout.ts";
import { HANDLE_RADIUS } from "./geometry-edit.ts";
import { markAnchor, marksAtPoint, pagePointOf } from "./hit-test.ts";
import type { PageBox } from "./hit-test.ts";
import {
  groupAnnotationsByPage,
  markTargets,
  patchSelectedMark,
  renderAnnotationOverlay,
  unitPointOf,
  unitsPerPixel,
  withPosition,
} from "./render.ts";
import type { MeasuredFont, OverlayPageView } from "./render.ts";

import { annotation, viewport } from "#__fixtures__/pdf-annotation-editor.ts";

const OFFSET_BOX = [10, 20, 622, 812] as const;

const FIXTURE_COLORS: Record<string, string> = {
  PUPR5FG5: "#2ea8e5",
  K3JRFLFQ: "#ff6666",
  C94NJNYG: "#ffd400",
  FDRFQ7C2: "#ffd400",
  TYY6Z6ZF: "#5fb236",
  HRK7BG32: "#a28ae5",
};

const MONO: MeasuredFont = {
  family: "monospace",
  measure: (text, fontSize) => text.length * fontSize * 0.4,
};

const RECT = [100, 700, 200, 720] as const;

const ROTATIONS = [
  { rotation: 0, box: "612 792", mark: ["100", "72", "100", "20"] },
  { rotation: 90, box: "792 612", mark: ["700", "100", "20", "100"] },
  { rotation: 180, box: "612 792", mark: ["412", "700", "100", "20"] },
  { rotation: 270, box: "792 612", mark: ["72", "412", "20", "100"] },
] as const;

it.each(ROTATIONS)(
  "places a mark where PDF.js's own transform puts it at rotation $rotation",
  ({ rotation, box, mark }) => {
    const page = pageView(viewport({ rotation }));

    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([highlight()]),
    });

    expect(overlayIn(page).getAttribute("viewBox")).toBe(`0 0 ${box}`);
    expect(overlayIn(page).getAttribute("preserveAspectRatio")).toBe("none");
    expect(rectOf(page, "PUPR5FG5")).toEqual(mark);
  },
);

it("carries the page's own `/UserUnit` into the page-unit box", () => {
  const page = pageView(viewport({ userUnit: 0.5 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(overlayIn(page).getAttribute("viewBox")).toBe("0 0 306 396");
  expect(rectOf(page, "PUPR5FG5")).toEqual(["50", "36", "50", "10"]);
});

it("draws each part of an overlong word on its own line inside the fitted box", () => {
  const page = pageView();
  const text = "aa abcdef";
  const position = { fontSize: 12.5, rotation: 0 };
  const box = fitFreeTextBox(
    text,
    { ...position, rects: [[100, 680, 120, 710]] },
    { measure: MONO.measure, pageBox: page.viewport.viewBox },
  );

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([
      {
        ...record("HRK7BG32", "text", {
          ...position,
          pageIndex: 0,
          rects: [box],
        }),
        comment: text,
      },
    ]),
  });

  expect(
    [...markIn(page, "HRK7BG32").querySelectorAll("tspan")].map((line) => [
      line.textContent,
      line.getAttribute("y"),
    ]),
  ).toEqual([
    ["aa", "94.5"],
    ["abcd", "109.5"],
    ["ef", "124.5"],
  ]);
});

it("measures from the page box's own origin rather than from zero", () => {
  const page = pageView(viewport({ box: OFFSET_BOX }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(overlayIn(page).getAttribute("viewBox")).toBe("0 0 612 792");
  expect(rectOf(page, "PUPR5FG5")).toEqual(["90", "92", "100", "20"]);
});

it("builds the same overlay at every zoom step", () => {
  const markup = (scale: number) => {
    const page = pageView(viewport({ scale }));
    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([highlight()]),
    });
    return overlayIn(page).outerHTML;
  };

  const reference = markup(1);

  expect(reference).toContain('viewBox="0 0 612 792"');
  for (const scale of [0.25, 0.5, 1.1, 2.5, 10]) {
    expect(markup(scale), `scale ${scale}`).toBe(reference);
  }
});

it("divides the built viewport out when the seam offers no rebuild", () => {
  const built = viewport({ scale: 2 });
  const page = pageView({ ...built, clone: undefined });

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(overlayIn(page).getAttribute("viewBox")).toBe("0 0 612 792");
  expect(rectOf(page, "PUPR5FG5")).toEqual(["100", "72", "100", "20"]);
});

it("draws a spilled-over mark on the next page from that page's own rectangles", () => {
  const spilled = record("PUPR5FG5", "highlight", {
    pageIndex: 0,
    rects: [RECT],
    nextPageRects: [[100, 80, 200, 100]],
  });
  const first = pageView();
  const second = pageView();
  const annotations = groupAnnotationsByPage([spilled]);

  renderAnnotationOverlay(first, {
    font: MONO,
    annotations: annotations.get(0) ?? [],
  });
  renderAnnotationOverlay(second, {
    font: MONO,
    annotations: annotations.get(1) ?? [],
  });

  expect(rectOf(first, "PUPR5FG5")).toEqual(["100", "72", "100", "20"]);
  expect(rectOf(second, "PUPR5FG5")).toEqual(["100", "692", "100", "20"]);
});

it("casts a selected ink stroke's own path under it, wider, rather than framing it in a box", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([
      record("TYY6Z6ZF", "ink", {
        pageIndex: 0,
        width: 2,
        paths: [[60, 700, 60, 660, 100, 660]],
      }),
    ]),
    selected: new Set(["TYY6Z6ZF"]),
  });

  const overlay = overlayIn(page);
  const casing = overlay.querySelector<SVGPathElement>(
    `.${themeHook.pdfAnnotationSelectionOutline}`,
  )!;
  const stroke = markIn(page, "TYY6Z6ZF");

  expect(casing.getAttribute("d")).toBe(stroke.getAttribute("d"));
  expect(casing.style.strokeWidth).toBe("5");
  expect(stroke.getAttribute("stroke-width")).toBe("2");
  expect(overlay.firstElementChild).toBe(casing);
  expect(casing.compareDocumentPosition(stroke)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

it("draws a single-point ink stroke as a round dot, in the page's colour when none is stored", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([
      record("DOT23456", "ink", {
        pageIndex: 0,
        width: 4,
        paths: [[100, 700]],
      }),
    ]),
  });

  expect(attributesOf(page, "DOT23456")).toMatchObject({
    d: "M 100 92 L 100 92",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-width": "4",
  });
});

it("draws nothing for a type whose stored position is not the shape it pairs with", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([
      record("PUPR5FG5", "highlight", {
        pageIndex: 0,
        width: 2,
        paths: [[10, 20, 30, 40]],
      }),
    ]),
  });

  expect(page.div.childElementCount).toBe(0);
});

it("keys the annotations by the page that draws them, parsing nothing per page", () => {
  const grouped = groupAnnotationsByPage([
    record("PUPR5FG5", "highlight", {
      pageIndex: 0,
      rects: [RECT],
    }),
    record("TYY6Z6ZF", "ink", {
      pageIndex: 2,
      width: 2,
      paths: [[10, 20, 30, 40]],
    }),
    record("HRK7BG32", "text", {
      pageIndex: 2,
      fontSize: 14,
      rotation: 0,
      rects: [[10, 40, 100, 55]],
    }),
  ]);

  expect([...grouped.keys()].toSorted((a, b) => a - b)).toEqual([0, 2]);
  expect(grouped.get(2)?.map(({ annotation }) => annotation.key)).toEqual([
    "TYY6Z6ZF",
    "HRK7BG32",
  ]);
  expect(grouped.get(0)?.[0]?.position.kind).toBe("pdf-rects");
});

it("places a spilled-over annotation on both of its pages", () => {
  const grouped = groupAnnotationsByPage([
    record("PUPR5FG5", "highlight", {
      pageIndex: 3,
      rects: [RECT],
      nextPageRects: [[100, 80, 200, 100]],
    }),
  ]);

  expect([...grouped.keys()].toSorted((a, b) => a - b)).toEqual([3, 4]);
  expect(grouped.get(4)?.[0]?.annotation.key).toBe("PUPR5FG5");
});

it("drops an annotation whose position is not a PDF position", () => {
  const grouped = groupAnnotationsByPage([
    {
      key: "EPUBMRK2",
      type: "highlight",
      color: "#ffd400",
      comment: null,
      text: null,
      parentKey: "EPUBBK23",
      pageLabel: null,
      sortIndex: "00000|000000|00000",
      tags: [],
      position: parseAnnotationPosition(
        { type: "FragmentSelector", value: "epubcfi(/6/4!/4/2)" },
        "application/epub+zip",
      ),
      version: null,
      lock: null,
    },
  ]);

  expect(grouped.size).toBe(0);
});

describe("the ink hit test", () => {
  const LOOP = [[100, 600, 200, 600, 200, 700, 100, 700, 100, 600]];

  const PAGE_BOX: PageBox = {
    left: 0,
    top: 0,
    width: 612,
    height: 792,
    unitWidth: 612,
    unitHeight: 792,
  };

  function clickedAt(
    records: readonly AnnotationRecord[],
    x: number,
    y: number,
  ): string[] {
    const at = pagePointOf(PAGE_BOX, { x, y })!;
    return marksAtPoint(markTargets(pageView(), pageAnnotations(records)), at);
  }

  const ink = (width: number, paths: number[][]) =>
    record("4PE492KU", "ink", { pageIndex: 0, width, paths });

  it("takes no click in the empty middle of a loop", () => {
    expect(clickedAt([ink(2, LOOP)], 150, 142)).toEqual([]);
    expect(clickedAt([ink(2, LOOP)], 150, 182)).toEqual([]);
  });

  it("takes a click closer than seven points to a thin stroke", () => {
    expect(clickedAt([ink(2, LOOP)], 150, 192)).toEqual(["4PE492KU"]);
    expect(clickedAt([ink(2, LOOP)], 150, 198.5)).toEqual(["4PE492KU"]);
    expect(clickedAt([ink(2, LOOP)], 150, 199)).toEqual([]);
  });

  it("reaches a wide pen's full width from its stroke", () => {
    expect(clickedAt([ink(30, LOOP)], 150, 221.5)).toEqual(["4PE492KU"]);
    expect(clickedAt([ink(30, LOOP)], 150, 222)).toEqual([]);
  });

  it("measures to the segments, so sparse points still take a click between them", () => {
    const turn = [[100, 600, 200, 600, 200, 700]];
    expect(clickedAt([ink(2, turn)], 150, 192)).toEqual(["4PE492KU"]);
  });

  it("takes a click on a single-point dot, and on straight ink with a flat box", () => {
    expect(clickedAt([ink(4, [[100, 600]])], 103, 195)).toEqual(["4PE492KU"]);
    expect(clickedAt([ink(4, [[100, 600]])], 100, 199)).toEqual([]);
    expect(clickedAt([ink(2, [[100, 600, 200, 600]])], 150, 196)).toEqual([
      "4PE492KU",
    ]);
  });

  it("hangs the Mark Popup of a dot under the dot", () => {
    const [target] = markTargets(
      pageView(),
      pageAnnotations([ink(4, [[100, 600]])]),
    );
    expect(markAnchor(target?.rects ?? [], PAGE_BOX)).toEqual({
      x: 100,
      y: 194,
    });
  });
});

function figure(rect = [100, 300, 300, 500]): AnnotationRecord {
  return record("FDRFQ7C2", "image", { pageIndex: 0, rects: [rect] });
}

function handlesIn(page: OverlayPageView): Record<string, number[]> {
  return Object.fromEntries(
    [
      ...page.div.querySelectorAll<SVGElement>(
        `.${themeHook.pdfAnnotationHandle}`,
      ),
    ].map((handle) => [
      handle.dataset.ztGrip,
      ["x", "y", "width", "height"].map((name) =>
        round(handle.getAttribute(name)),
      ),
    ]),
  );
}

it("draws each Mark Handle where a press on it is measured, on a page turned a quarter turn", () => {
  const page = pageView(viewport({ rotation: 90, scale: 1.5 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([figure()]),
    selected: new Set(["FDRFQ7C2"]),
    handles: true,
  });

  const side = 20 / 3;
  const around = ({ x, y }: { x: number; y: number }) =>
    [x - side / 2, y - side / 2, side, side].map((value) =>
      round(String(value)),
    );
  expect(handlesIn(page).br).toEqual(around({ x: 300, y: 300 }));
  expect(handlesIn(page).tl).toEqual(around({ x: 500, y: 100 }));
  expect(unitPointOf(page, [300, 300])).toEqual({ x: 300, y: 300 });
  expect(HANDLE_RADIUS * unitsPerPixel(page)).toBeCloseTo(side / 2, 9);
});

it("draws no Mark Handle while editing is not live, or off the selection", () => {
  const drawn = (options: {
    selected?: ReadonlySet<string>;
    handles?: boolean;
  }) => {
    const page = pageView();
    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([figure(), highlight()]),
      ...options,
    });
    return {
      handles: Object.keys(handlesIn(page)),
      body: markIn(page, "FDRFQ7C2").dataset.ztGrip,
    };
  };

  expect(drawn({ selected: new Set(["FDRFQ7C2"]) })).toEqual({
    handles: [],
    body: undefined,
  });
  expect(drawn({ handles: true })).toEqual({ handles: [], body: undefined });
});

it("draws a selected highlight's two end strips, three pixels either side of its edges", () => {
  const page = pageView(viewport({ scale: 2 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
    selected: new Set(["PUPR5FG5"]),
    handles: true,
  });

  expect(handlesIn(page)).toEqual({
    start: [98.5, 72, 3, 20],
    end: [198.5, 72, 3, 20],
  });
  const end = page.div.querySelector<SVGElement>('[data-zt-grip="end"]')!;
  expect(end.dataset.ztCursor).toBe("ew-resize");
  expect(markIn(page, "PUPR5FG5").dataset.ztGrip).toBeUndefined();
});

it("turns a selected range's strips, and their cursor, with the text under them", () => {
  const page = pageView(viewport({ scale: 2 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
    selected: new Set(["PUPR5FG5"]),
    handles: true,
    textRotation: () => 90,
  });

  expect(handlesIn(page)).toEqual({
    start: [100, 90.5, 100, 3],
    end: [100, 70.5, 100, 3],
  });
  const end = page.div.querySelector<SVGElement>('[data-zt-grip="end"]')!;
  expect(end.dataset.ztCursor).toBe("ns-resize");
});

it("draws a spilled-over range's start on its first page and its end on the next", () => {
  const spilled = record("PUPR5FG5", "highlight", {
    pageIndex: 0,
    rects: [RECT],
    nextPageRects: [[72, 740, 150, 752]],
  });
  const grouped = groupAnnotationsByPage([spilled]);
  const drawnOn = (pageIndex: number) => {
    const page = pageView();
    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: grouped.get(pageIndex) ?? [],
      selected: new Set(["PUPR5FG5"]),
      handles: true,
    });
    return Object.keys(handlesIn(page));
  };

  expect(drawnOn(0)).toEqual(["start"]);
  expect(drawnOn(1)).toEqual(["end"]);
});

it("patches the selected mark, its outline, and its handles in place", () => {
  const page = pageView();
  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([figure(), highlight()]),
    selected: new Set(["FDRFQ7C2"]),
    handles: true,
  });
  const overlay = overlayIn(page);
  const mark = markIn(page, "FDRFQ7C2");
  const children = [...overlay.children];

  const patched = patchSelectedMark(
    page,
    pageAnnotations([figure([100, 280, 340, 500])])[0]!,
    {
      handles: true,
      font: MONO,
    },
  );

  expect(patched).toBe(true);
  expect(overlayIn(page)).toBe(overlay);
  expect([...overlay.children]).toEqual(children);
  expect(markIn(page, "FDRFQ7C2")).toBe(mark);
  expect(rectOf(page, "FDRFQ7C2")).toEqual(["100", "292", "240", "220"]);
  expect(
    overlay
      .querySelector(`.${themeHook.pdfAnnotationSelectionOutline}`)!
      .getAttribute("d"),
  ).toBe("M 98.5 290.5 L 341.5 290.5 L 341.5 513.5 L 98.5 513.5 Z");
  expect(handlesIn(page).br).toEqual([335, 507, 10, 10]);
  expect(rectOf(page, "PUPR5FG5")).toEqual(["100", "72", "100", "20"]);
});

it("patches a scaled ink stroke, the width of its casing, and its four handles in place", () => {
  const stroke = (paths: number[][], width: number) =>
    record("4PE492KU", "ink", { pageIndex: 0, width, paths });
  const page = pageView();
  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([stroke([[100, 300, 200, 400]], 2)]),
    selected: new Set(["4PE492KU"]),
    handles: true,
  });
  const overlay = overlayIn(page);
  const children = [...overlay.children];
  expect(markIn(page, "4PE492KU").dataset.ztGrip).toBe("body");
  expect(Object.keys(handlesIn(page)).sort()).toEqual(["bl", "br", "tl", "tr"]);

  const patched = patchSelectedMark(
    page,
    pageAnnotations([stroke([[100, 200, 300, 400]], 4)])[0]!,
    { handles: true, font: MONO },
  );

  expect(patched).toBe(true);
  expect([...overlay.children]).toEqual(children);
  const mark = markIn(page, "4PE492KU");
  expect(mark.getAttribute("d")).toBe("M 100 592 L 100 592 L 300 392");
  expect(mark.getAttribute("stroke-width")).toBe("4");
  const casing = overlay.querySelector<SVGElement>(
    `.${themeHook.pdfAnnotationSelectionOutline}`,
  )!;
  expect(casing.getAttribute("d")).toBe("M 100 592 L 100 592 L 300 392");
  expect(casing.style.strokeWidth).toBe("7");
  expect(handlesIn(page).br).toEqual([300, 592, 10, 10]);
});

it("draws a proposed position in the mark's own place in its page's list", () => {
  const marks = groupAnnotationsByPage([figure(), highlight()]);

  const proposed = withPosition(marks, "FDRFQ7C2", {
    kind: "pdf-rects",
    pageIndex: 0,
    rects: [[100, 280, 340, 500]],
  });

  expect(
    proposed.get(0)?.map(({ annotation, rects }) => [annotation.key, rects]),
  ).toEqual([
    ["FDRFQ7C2", [[100, 280, 340, 500]]],
    ["PUPR5FG5", [RECT]],
  ]);
});

it("patches nothing on a page whose overlay holds no such mark", () => {
  const page = pageView();
  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(
    patchSelectedMark(page, pageAnnotations([figure()])[0]!, {
      handles: true,
      font: MONO,
    }),
  ).toBe(false);
});

function highlight(): AnnotationRecord {
  return record("PUPR5FG5", "highlight", {
    pageIndex: 0,
    rects: [RECT],
  });
}

function record(
  key: string,
  type: AnnotationRecord["type"],
  position: unknown,
): AnnotationRecord {
  return {
    ...annotation(key, type, position),
    color: FIXTURE_COLORS[key] ?? null,
    comment: type === "text" ? "Making figures is hard :(" : null,
  };
}

function pageAnnotations(records: readonly AnnotationRecord[]) {
  return groupAnnotationsByPage(records).get(0) ?? [];
}

function pageView(
  built: OverlayPageView["viewport"] = viewport(),
): OverlayPageView {
  return { div: document.createElement("div"), viewport: built };
}

function overlayIn(page: OverlayPageView): SVGElement {
  return page.div.querySelector<SVGElement>(
    `.${themeHook.pdfAnnotationOverlay}`,
  )!;
}

function markIn(page: OverlayPageView, key: string): SVGElement {
  return page.div.querySelector<SVGElement>(
    `[data-zotero-annotation-key="${key}"]`,
  )!;
}

function rectOf(page: OverlayPageView, key: string): (string | null)[] {
  const mark = markIn(page, key);
  return ["x", "y", "width", "height"].map((name) => mark.getAttribute(name));
}

function round(value: string | null): number {
  return Math.round(Number(value) * 1000) / 1000;
}

function attributesOf(
  page: OverlayPageView,
  key: string,
): Record<string, string> {
  return Object.fromEntries(
    [...markIn(page, key).attributes].map(({ name, value }) => [name, value]),
  );
}
