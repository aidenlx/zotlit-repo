// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { Menu } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";

import { showWorkbenchMenu } from "./menu.ts";

describe("Workbench menu", () => {
  it("opens an Obsidian menu at its control and executes the selected action", () => {
    const anchor = document.createElement("button");
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 30, 100, 25),
    );
    const onSelect = vi.fn();
    showWorkbenchMenu({
      anchor,
      items: [{ label: "Remove", icon: "trash-2", onSelect }],
    });
    const menu = Menu.instances.at(-1)!;
    expect(menu.position).toEqual({
      x: 20,
      y: 55,
      width: 100,
      overlap: true,
      left: false,
    });
    expect(menu.items[0]!.title).toBe("Remove");
    expect(menu.items[0]!.icon).toBe("trash-2");
    menu.items[0]!.click();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("opens a right-click's menu at the pointer, not under the row", () => {
    const anchor = document.createElement("button");
    const pointerEvent = new MouseEvent("contextmenu", {
      clientX: 12,
      clientY: 34,
    });
    showWorkbenchMenu({
      anchor,
      pointerEvent,
      items: [{ label: "Move up", onSelect: () => {} }],
    });
    const menu = Menu.instances.at(-1)!;
    expect(menu.mouseEvent).toBe(pointerEvent);
    expect(menu.position).toBeNull();
    expect(menu.parentEl).toBeNull();
  });
});
