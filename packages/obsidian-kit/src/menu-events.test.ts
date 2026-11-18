import { describe, expect, it, vi } from "vitest";

import { menuEvent, menuSections, raiseMenu } from "./menu-events.ts";

import { Menu } from "#__mocks__/obsidian.ts";

declare module "./menu-events.ts" {
  interface ZotLitMenuEvents {
    "zotlit:test-works-menu": { works: readonly string[] };
    "zotlit:test-card-menu": { annotations: readonly string[] };
  }
}

const worksMenu = menuEvent("zotlit:test-works-menu", ["open", ""]);
const cardMenu = menuEvent("zotlit:test-card-menu", [
  "action",
  "clipboard",
  "insert",
  "view",
  "",
  "danger",
]);

describe("raiseMenu", () => {
  it("registers the menu's sections before its listeners run", () => {
    const menu = new Menu();
    const sectionsSeen: string[][] = [];
    const trigger = vi.fn(() => sectionsSeen.push([...menu.sections]));

    raiseMenu(menu as never, {
      workspace: { trigger },
      event: worksMenu,
      info: { works: [] },
    });

    expect(sectionsSeen).toStrictEqual([["open", ""]]);
    expect(trigger).toHaveBeenCalledExactlyOnceWith(
      "zotlit:test-works-menu",
      menu,
      { works: [] },
    );
  });
});

describe("menuSections", () => {
  it("names every section of the menu but the unnamed one", () => {
    expect(menuSections(cardMenu)).toStrictEqual({
      action: "action",
      clipboard: "clipboard",
      insert: "insert",
      view: "view",
      danger: "danger",
    });
  });
});
