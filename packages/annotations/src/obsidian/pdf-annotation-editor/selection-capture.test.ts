// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import type { OverlayPageView } from "./render.ts";
import type { ClientBox } from "./selection-capture.ts";
import { selectionPagesOf } from "./selection-capture.ts";

const SCALE = 1.5;
const PAGE_HEIGHT = 792;
const PAGE_WIDTH = 612;
const UNROTATED = [SCALE, 0, 0, -SCALE, 0, PAGE_HEIGHT * SCALE];

const ROTATED_90 = [0, SCALE, SCALE, 0, 0, 0];

const BORDER = 6;

function readerPage(
  spans: readonly string[],
  {
    left = 20,
    top = 0,
    width = PAGE_WIDTH * SCALE,
    height = PAGE_HEIGHT * SCALE,
  } = {},
) {
  const div = document.body.createDiv({ cls: "page" });
  div.createDiv({ cls: "canvasWrapper" });
  const layer = div.createDiv({ cls: "textLayer" });
  for (const text of spans) layer.createSpan({ text });
  layer.createDiv({ cls: "endOfContent" });
  div.getBoundingClientRect = () =>
    ({
      left: left - BORDER,
      top: top - BORDER,
      right: left + width + BORDER,
      bottom: top + height + BORDER,
      width: width + 2 * BORDER,
      height: height + 2 * BORDER,
    }) as DOMRect;
  Object.defineProperties(div, {
    clientLeft: { value: BORDER },
    clientTop: { value: BORDER },
  });
  const box: ClientBox = {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
  return { div, layer, box };
}

const textOf = (layer: Element, index: number) =>
  layer.children[index]!.firstChild!;

function layOut(text: ClientBox, page: ClientBox) {
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (
    this: Range,
  ) {
    const onText = this.startContainer.nodeType === Node.TEXT_NODE;
    return [onText ? text : page] as never;
  });
}

function clientBoxOf(
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  box: ClientBox,
): ClientBox {
  return {
    left: box.left + x1 * SCALE,
    top: box.top + (PAGE_HEIGHT - y2) * SCALE,
    right: box.left + x2 * SCALE,
    bottom: box.top + (PAGE_HEIGHT - y1) * SCALE,
  };
}

function rounded(rects: readonly (readonly number[])[]): number[][] {
  return rects.map((rect) =>
    rect.map((value) => Math.round(value * 1e3) / 1e3),
  );
}

const view = (div: HTMLElement, transform = UNROTATED) =>
  stubService<OverlayPageView>("OverlayPageView", {
    div,
    viewport: stubService<OverlayPageView["viewport"]>("PDFPageViewport", {
      transform,
    }),
  });

afterEach(() => {
  vi.restoreAllMocks();
  document.body.empty();
});

it("reads where the selection starts and ends in the text layer's text", () => {
  const { div, layer } = readerPage(["Scientific ", "visualization", "."]);
  const range = document.createRange();
  range.setStart(textOf(layer, 0), 4);
  range.setEnd(textOf(layer, 1), 6);

  const [page] = selectionPagesOf(range, [{ pageIndex: 0, view: view(div) }]);

  expect(page).toMatchObject({
    pageIndex: 0,
    layerText: "Scientific visualization.",
    start: 4,
    end: 17,
  });
  expect(page!.layerText.slice(page!.start!, page!.end!)).toBe("ntific visual");
});

it("leaves an end open where the selection runs on past the page", () => {
  const first = readerPage(["A quote that runs"]);
  const second = readerPage(["on the next page."], { top: 2000 });
  const range = document.createRange();
  range.setStart(textOf(first.layer, 0), 2);
  range.setEnd(textOf(second.layer, 0), 11);

  const pages = selectionPagesOf(range, [
    { pageIndex: 1, view: view(second.div) },
    { pageIndex: 0, view: view(first.div) },
  ]);

  expect(
    pages.map(({ pageIndex, start, end }) => [pageIndex, start, end]),
  ).toEqual([
    [1, null, 11],
    [0, 2, null],
  ]);
});

it("takes boxes from the selected text alone, never from the page's elements", () => {
  const first = readerPage(["end of one"]);
  const second = readerPage(["start of two"], { top: 2000 });
  const text = clientBoxOf([58, 600, 211, 610], first.box);
  layOut(text, first.box);
  const range = document.createRange();
  range.setStart(textOf(first.layer, 0), 4);
  range.setEnd(textOf(second.layer, 0), 5);

  const [page] = selectionPagesOf(range, [
    { pageIndex: 0, view: view(first.div) },
  ]);

  expect(page!.clientRects).toEqual([text]);
  expect(rounded(page!.rects)).toEqual([[58, 600, 211, 610]]);
});

it("reads the boxes against the page inside its border", () => {
  const { div, layer, box } = readerPage(["Scientific visualization"]);
  const stored = [58.054, 601.98, 211.489, 610.112] as const;
  layOut(clientBoxOf(stored, box), box);
  const range = document.createRange();
  range.selectNodeContents(textOf(layer, 0));

  const [page] = selectionPagesOf(range, [{ pageIndex: 0, view: view(div) }]);

  expect(page!.box).toMatchObject(box);
  expect(rounded(page!.rects)).toEqual(rounded([stored]));
});

it("clips a box that overhangs the page to the page box", () => {
  const { div, layer, box } = readerPage(["overhang"]);
  layOut(
    {
      left: box.left - 500,
      top: box.top - 500,
      right: box.left + 100 * SCALE,
      bottom: box.top + 100 * SCALE,
    },
    box,
  );
  const range = document.createRange();
  range.selectNodeContents(textOf(layer, 0));

  const [page] = selectionPagesOf(range, [{ pageIndex: 0, view: view(div) }]);

  expect(rounded(page!.rects)).toEqual([
    [0, PAGE_HEIGHT - 100, 100, PAGE_HEIGHT],
  ]);
});

it("reads a rotated page through the same inverse", () => {
  const { div, layer, box } = readerPage(["turned"], {
    left: 0,
    width: PAGE_HEIGHT * SCALE,
    height: PAGE_WIDTH * SCALE,
  });
  layOut(
    {
      left: 20 * SCALE,
      top: 10 * SCALE,
      right: 40 * SCALE,
      bottom: 30 * SCALE,
    },
    box,
  );
  const range = document.createRange();
  range.selectNodeContents(textOf(layer, 0));

  const [page] = selectionPagesOf(range, [
    { pageIndex: 0, view: view(div, ROTATED_90) },
  ]);

  expect(rounded(page!.rects)).toEqual([[10, 20, 30, 40]]);
});

it("leaves out a page the range never reaches", () => {
  const inside = readerPage(["quoted"]);
  const outside = readerPage(["untouched"], { top: 2000 });
  const range = document.createRange();
  range.selectNodeContents(inside.layer);

  const pages = selectionPagesOf(range, [
    { pageIndex: 0, view: view(inside.div) },
    { pageIndex: 1, view: view(outside.div) },
  ]);

  expect(pages.map(({ pageIndex }) => pageIndex)).toEqual([0]);
});

it("leaves out a page with no text layer", () => {
  const bare = document.body.createDiv({ cls: "page", text: "no layer" });
  const range = document.createRange();
  range.selectNodeContents(bare);

  expect(selectionPagesOf(range, [{ pageIndex: 0, view: view(bare) }])).toEqual(
    [],
  );
});
