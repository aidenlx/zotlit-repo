import { describe, expect, it } from "vitest";

import * as m from "@zotlit/plugin-messages/messages.ts";

import type { WorkbenchPanels } from "./panel-layout.ts";
import { INITIAL_PANELS } from "./panel-layout.ts";
import { panelSizeMenus } from "./panel-menu.ts";

const BOTH: WorkbenchPanels = {
  ...INITIAL_PANELS,
  preview: { ...INITIAL_PANELS.preview, shown: true },
};

const at = (width: number) => ({
  size: { width, height: 800 },
  defaults: INITIAL_PANELS,
});

const read = (menus: ReturnType<typeof panelSizeMenus>) =>
  menus.map((menu) => [
    menu.label,
    menu.axis,
    menu.items.map((item) => (item.disabled ? `(${item.label})` : item.label)),
  ]);

describe("the panel size menus", () => {
  it("names each handle the view draws, with entries for its direction", () => {
    const widths = [
      m.workbench_panel_wider(),
      m.workbench_panel_narrower(),
      `(${m.workbench_panel_reset_width()})`,
    ];
    expect(read(panelSizeMenus(BOTH, at(1200)))).toEqual([
      [m.workbench_preview_resize(), "horizontal", widths],
    ]);
    expect(read(panelSizeMenus(BOTH, at(560)))).toEqual([
      [
        m.workbench_preview_resize(),
        "vertical",
        [
          m.workbench_panel_taller(),
          m.workbench_panel_shorter(),
          `(${m.workbench_panel_reset_height()})`,
        ],
      ],
    ]);
  });

  it("sizes the panel of the entry the reader picks", () => {
    const size = at(1600);
    const [preview] = panelSizeMenus(BOTH, size);
    const wider = preview!.items[0]!.apply(BOTH);
    expect(wider.preview.width).toBe(464);
    const [again] = panelSizeMenus(wider, size);
    expect(again!.items[2]!.disabled).toBe(false);
    expect(again!.items[2]!.apply(wider).preview.width).toBe(400);
  });
});
