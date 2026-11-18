// @vitest-environment happy-dom
// The colour menu builds its titles with `createFragment`, which needs a DOM.
import { Menu } from "@mock/obsidian.ts";
import { describe, expect, it } from "vitest";

import { buildColorMenu } from "./color-menu.ts";

describe("the colour menu", () => {
  function build(...colors: (string | null)[]) {
    const menu = new Menu();
    buildColorMenu(menu as never, { colors, onSelect: () => {} });
    return { menu };
  }

  it("checks the swatch the Annotation carries, whatever case it was stored in", () => {
    const { menu } = build("#FFD400");

    expect(menu.items.filter((item) => item.checked)).toHaveLength(1);
    expect(menu.items[0]!.checked).toBe(true);
  });

  it("checks the swatch every Annotation of a group carries", () => {
    const { menu } = build("#ffd400", "#FFD400");

    expect(menu.items.filter((item) => item.checked)).toHaveLength(1);
    expect(menu.items[0]!.checked).toBe(true);
  });

  it("checks no swatch for a group of mixed colours", () => {
    const { menu } = build("#ffd400", "#ff6666");

    expect(menu.items.filter((item) => item.checked)).toHaveLength(0);
  });
});
