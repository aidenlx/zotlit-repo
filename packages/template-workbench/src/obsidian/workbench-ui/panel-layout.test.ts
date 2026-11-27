import { describe, expect, it } from "vitest";

import type { PanelMove, PanelStep, WorkbenchPanels } from "./panel-layout.ts";
import {
  canResizePanel,
  columnLimit,
  drawnMax,
  FIELDS_WIDTH,
  hideFields,
  INITIAL_PANELS,
  PANEL_HANDLES,
  pinFields,
  setPanelWidth,
  panelHandles,
  placePanels,
  previewBelowHeight,
  resizePanel,
} from "./panel-layout.ts";
import { panelSizeMenus } from "./panel-menu.ts";

const shown = (preview: boolean): WorkbenchPanels => ({
  ...INITIAL_PANELS,
  preview: { ...INITIAL_PANELS.preview, shown: preview },
});

const at = (width: number) => ({ width, height: 800 });

describe("panel placement", () => {
  it.each([320, 560, 760, 960, 1200])(
    "opens the unpinned Fields Panel as a popover over a %i px view only while it stands open",
    (width) => {
      const preview = width >= 896 ? "side" : "below";
      expect(placePanels(shown(true), at(width), true).fields).toBe("popover");
      expect(placePanels(shown(true), at(width), true).preview).toBe(preview);
      expect(placePanels(shown(true), at(width), false).fields).toBe("closed");
      expect(placePanels(shown(false), at(width), true)).toMatchObject({
        preview: "hidden",
        fields: "popover",
      });
    },
  );

  it("puts the Preview at the side from a 56rem (896 px) view", () => {
    expect(placePanels(shown(true), at(896), false).preview).toBe("side");
    expect(placePanels(shown(true), at(895), false).preview).toBe("below");
    const narrow: WorkbenchPanels = {
      ...shown(true),
      preview: { ...INITIAL_PANELS.preview, shown: true, width: 240 },
    };
    expect(placePanels(narrow, at(895), false).preview).toBe("below");
  });

  it("draws a wide saved Preview as wide as the editor's 360 px allows", () => {
    const wide: WorkbenchPanels = {
      ...shown(true),
      preview: { ...INITIAL_PANELS.preview, shown: true, width: 1400 },
    };
    expect(placePanels(wide, at(896), false).preview).toBe("side");
    expect(columnLimit(wide, "preview", at(896))).toBe(536);
  });

  it("places the Preview as a column where the host has not measured the view yet", () => {
    expect(placePanels(shown(true), null, false)).toEqual({
      preview: "side",
      fields: "closed",
      canPin: true,
    });
  });
});

const pinned = (
  preview: boolean,
  {
    hidden = false,
    width = FIELDS_WIDTH.initial,
  }: { hidden?: boolean; width?: number } = {},
): WorkbenchPanels => ({
  ...shown(preview),
  fields: { pinned: true, hidden, width },
});

describe("the pinned Fields Panel", () => {
  it.each([
    { width: 320, preview: false, canPin: false },
    { width: 320, preview: true, canPin: false },
    { width: 560, preview: false, canPin: false },
    { width: 560, preview: true, canPin: false },
    { width: 760, preview: false, canPin: true },
    { width: 760, preview: true, canPin: true },
    { width: 960, preview: false, canPin: true },
    { width: 960, preview: true, canPin: false },
    { width: 1200, preview: false, canPin: true },
    { width: 1200, preview: true, canPin: true },
  ])(
    "at $width px with the Preview shown: $preview, docks when $canPin",
    ({ width, preview, canPin }) => {
      for (const saved of [240, 320, 480]) {
        const panels = pinned(preview, { width: saved });
        expect(placePanels(panels, at(width), false)).toMatchObject({
          fields: canPin ? "docked" : "closed",
          canPin,
        });
        expect(placePanels(panels, at(width), true).fields).toBe(
          canPin ? "docked" : "popover",
        );
        const hidden = pinned(preview, { hidden: true, width: saved });
        expect(placePanels(hidden, at(width), false)).toMatchObject({
          fields: "closed",
          canPin,
        });
        expect(placePanels(hidden, at(width), true).fields).toBe("popover");
        expect(placePanels(shown(preview), at(width), false)).toMatchObject({
          fields: "closed",
          canPin,
        });
      }
    },
  );

  it("needs 600 px of room to dock", () => {
    expect(placePanels(pinned(false), at(600), false).fields).toBe("docked");
    expect(placePanels(pinned(false), at(599), false).fields).toBe("closed");
    expect(
      placePanels(pinned(false), { ...at(612), handle: 12 }, false).fields,
    ).toBe("docked");
    expect(
      placePanels(pinned(false), { ...at(611), handle: 12 }, false).fields,
    ).toBe("closed");
  });

  it("docks where the host has not measured the view yet", () => {
    expect(placePanels(pinned(true), null, false)).toEqual({
      preview: "side",
      fields: "docked",
      canPin: true,
    });
  });

  it("draws its saved width within 240 to 480 px, and as wide as the editor's 360 px allows", () => {
    expect(columnLimit(pinned(false), "fields", at(1200))).toBe(480);
    expect(columnLimit(pinned(false), "fields", at(760))).toBe(400);
    expect(columnLimit(pinned(true), "fields", at(1200))).toBe(440);
    expect(columnLimit(pinned(false), "fields", null)).toBe(480);
  });

  it("keeps its place as the Preview column grows", () => {
    expect(columnLimit(pinned(true), "preview", at(1200))).toBe(520);
    const grow = resizePanel("preview", "grow", {
      size: at(1200),
      defaults: INITIAL_PANELS,
    });
    let panels = pinned(true);
    for (let press = 0; press < 10; press++) panels = grow(panels);
    expect(panels.preview.width).toBe(520);
    expect(placePanels(panels, at(1200), false).fields).toBe("docked");
  });

  it("is sized with its own edge, within 240 to 480 px", () => {
    const bounds = { size: at(1600), defaults: INITIAL_PANELS };
    expect(panelHandles(pinned(true), at(1600))).toEqual(["fields", "preview"]);
    expect(panelHandles(pinned(true, { hidden: true }), at(1600))).toEqual([
      "preview",
    ]);
    expect(panelHandles(pinned(true), at(960))).toEqual(["preview"]);
    const grow = resizePanel("fields", "grow", bounds);
    let panels = pinned(true);
    for (let press = 0; press < 5; press++) panels = grow(panels);
    expect(panels.fields.width).toBe(480);
    expect(canResizePanel("fields", "grow", bounds)(panels)).toBe(false);
    expect(resizePanel("fields", "reset", bounds)(panels).fields.width).toBe(
      320,
    );
    expect(setPanelWidth("fields", 100)(panels).fields.width).toBe(240);
    expect(setPanelWidth("fields", 900)(panels).fields.width).toBe(480);
  });

  it("pins visible, hides and shows without unpinning, and unpins", () => {
    const hidden = hideFields(true)(pinFields(true)(INITIAL_PANELS));
    expect(hidden.fields).toEqual({ pinned: true, hidden: true, width: 320 });
    expect(hideFields(false)(hidden).fields.pinned).toBe(true);
    expect(pinFields(true)(hidden).fields.hidden).toBe(false);
    expect(pinFields(false)(hidden).fields).toEqual({
      pinned: false,
      hidden: false,
      width: 320,
    });
  });
});

describe("Preview height under the editor", () => {
  it("takes its saved share of the view height", () => {
    expect(previewBelowHeight(40, 800)).toBe(320);
    expect(previewBelowHeight(25, 800)).toBe(200);
  });

  it("gives up height first, so the editor keeps its toolbar, tabs, task and five source lines", () => {
    expect(previewBelowHeight(80, 585)).toBe(265);
    expect(previewBelowHeight(40, 700)).toBe(280);
  });

  it("has no height in a view shorter than the editor's floor", () => {
    expect(previewBelowHeight(40, 300)).toBe(0);
  });
});

describe("sizing a panel without its handle", () => {
  const preview = shown(true);
  const bounds = (width: number) => ({
    size: at(width),
    defaults: INITIAL_PANELS,
  });

  it("offers the handles the view draws", () => {
    expect(panelHandles(preview, at(1200))).toEqual(["preview"]);
    expect(panelHandles(preview, at(560))).toEqual(["split"]);
    expect(panelHandles(shown(false), at(1200))).toEqual([]);
  });

  it("narrows the Preview column a large step at a time", () => {
    expect(
      resizePanel("preview", "shrink", bounds(1600))(preview).preview.width,
    ).toBe(336);
  });

  it("widens the Preview column until the editor keeps only its 360 px", () => {
    const grow = resizePanel("preview", "grow", bounds(1600));
    let panels = preview;
    for (let press = 0; press < 20; press++) panels = grow(panels);
    expect(panels.preview.width).toBe(1240);
    expect(canResizePanel("preview", "grow", bounds(1600))(panels)).toBe(false);
    expect(placePanels(panels, at(1600), false).preview).toBe("side");
    expect(columnLimit(preview, "preview", at(1200))).toBe(840);
  });

  it("draws the Preview at its saved width in a view not measured yet", () => {
    const wide: WorkbenchPanels = {
      ...preview,
      preview: { ...preview.preview, width: 1100 },
    };
    expect(columnLimit(wide, "preview", null)).toBe(1100);
  });

  it("makes the Preview under the editor taller and shorter by a tenth of the view", () => {
    expect(
      resizePanel("split", "grow", bounds(560))(preview).preview.height,
    ).toBe(50);
    expect(
      resizePanel("split", "shrink", bounds(560))(preview).preview.height,
    ).toBe(30);
    const tallest: WorkbenchPanels = {
      ...preview,
      preview: { ...preview.preview, height: 80 },
    };
    expect(canResizePanel("split", "grow", bounds(560))(tallest)).toBe(false);
  });

  it("offers a taller or shorter Preview only where the drawn height changes", () => {
    const short = {
      size: { width: 560, height: 578 },
      defaults: INITIAL_PANELS,
    };
    const taller = resizePanel("split", "grow", short)(preview);
    expect(previewBelowHeight(taller.preview.height, 578)).toBe(258);
    expect(canResizePanel("split", "grow", short)(taller)).toBe(false);
    const tallest: WorkbenchPanels = {
      ...preview,
      preview: { ...preview.preview, height: 80 },
    };
    expect(canResizePanel("split", "grow", short)(tallest)).toBe(false);
    const shorter = resizePanel("split", "shrink", short)(tallest);
    expect(shorter.preview.height).toBe(35);
    expect(previewBelowHeight(shorter.preview.height, 578)).toBeLessThan(258);
  });

  it("resets a panel to its default size", () => {
    const sized: WorkbenchPanels = {
      ...preview,
      preview: { ...preview.preview, width: 960, height: 70 },
    };
    expect(
      resizePanel("preview", "reset", bounds(1600))(sized).preview,
    ).toEqual({
      ...sized.preview,
      width: 400,
    });
    expect(resizePanel("split", "reset", bounds(560))(sized).preview).toEqual({
      ...sized.preview,
      height: 40,
    });
    expect(canResizePanel("preview", "reset", bounds(1200))(preview)).toBe(
      false,
    );
    expect(canResizePanel("split", "reset", bounds(560))(sized)).toBe(true);
  });
});

describe.each([
  {
    handle: "fields",
    panels: pinned(false),
    size: at(1200),
    axis: "horizontal",
    drawn: 320,
    key: 336,
    wide: 384,
    menu: 384,
    min: 240,
    max: 480,
    drawnLargest: 480,
    read: (panels: WorkbenchPanels) => panels.fields.width,
  },
  {
    handle: "preview",
    panels: shown(true),
    size: at(1600),
    axis: "horizontal",
    drawn: 400,
    key: 416,
    wide: 464,
    menu: 464,
    min: 240,
    max: 1240,
    drawnLargest: 1240,
    read: (panels: WorkbenchPanels) => panels.preview.width,
  },
  {
    handle: "split",
    panels: shown(true),
    size: at(560),
    axis: "vertical",
    drawn: 40,
    key: 45,
    wide: 45,
    menu: 50,
    min: 20,
    max: 80,
    drawnLargest: 60,
    read: (panels: WorkbenchPanels) => panels.preview.height,
  },
] as const)(
  "the $handle handle",
  ({
    handle,
    panels,
    size,
    axis,
    drawn,
    key,
    wide,
    menu,
    min,
    max,
    drawnLargest,
    read,
  }) => {
    const sizing = PANEL_HANDLES[handle];
    const bounds = { size, defaults: INITIAL_PANELS };
    const moved = (move: PanelMove, step?: PanelStep) =>
      read(
        resizePanel(handle, move, step ? { ...bounds, step } : bounds)(panels),
      );

    it("is drawn in the view and offers its menu, whose entries take the same path", () => {
      expect(panelHandles(panels, size)).toContain(handle);
      expect(sizing.drawn(panels, size)).toBe(drawn);
      const sizeMenu = panelSizeMenus(panels, bounds).find(
        (each) => each.handle === handle,
      );
      expect(sizeMenu?.axis).toBe(axis);
      const [grow, shrink, reset] = sizeMenu!.items;
      expect([grow!.disabled, shrink!.disabled, reset!.disabled]).toEqual([
        false,
        false,
        true,
      ]);
      expect(read(grow!.apply(panels))).toBe(menu);
      expect(read(shrink!.apply(panels))).toBe(drawn - (menu - drawn));
    });

    it("grows and shrinks by a key, a Shift+key and a menu step", () => {
      expect(moved("grow", "key")).toBe(key);
      expect(moved("grow", "wide")).toBe(wide);
      expect(moved("grow")).toBe(menu);
      expect(moved("shrink", "key")).toBe(drawn - (key - drawn));
      expect(moved("shrink", "wide")).toBe(drawn - (wide - drawn));
      expect(moved("shrink")).toBe(drawn - (menu - drawn));
    });

    it("goes to its least and largest size, and grows no further", () => {
      expect(moved("min")).toBe(min);
      expect(moved("max")).toBe(max);
      const largest = resizePanel(handle, "max", bounds)(panels);
      expect(sizing.drawn(largest, size)).toBe(drawnLargest);
      expect(drawnMax(handle, panels, size)).toBe(drawnLargest);
      expect(canResizePanel(handle, "grow", bounds)(largest)).toBe(false);
      expect(
        sizing.drawn(
          resizePanel(handle, "grow", { ...bounds, step: "key" })(largest),
          size,
        ),
      ).toBe(drawnLargest);
      const least = resizePanel(handle, "min", bounds)(panels);
      expect(canResizePanel(handle, "shrink", bounds)(least)).toBe(false);
    });

    it("resets to the default size, which a default panel cannot", () => {
      const sized = resizePanel(handle, "max", bounds)(panels);
      expect(canResizePanel(handle, "reset", bounds)(sized)).toBe(true);
      expect(read(resizePanel(handle, "reset", bounds)(sized))).toBe(
        read(panels),
      );
      expect(canResizePanel(handle, "reset", bounds)(panels)).toBe(false);
    });
  },
);

describe("panel placement with handles", () => {
  it("holds the Preview column to the width that leaves the editor 360 px past its handle", () => {
    expect(
      columnLimit(shown(true), "preview", {
        width: 1072,
        height: 800,
        handle: 12,
      }),
    ).toBe(700);
  });
});
