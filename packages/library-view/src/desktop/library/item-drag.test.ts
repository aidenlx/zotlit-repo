// @vitest-environment happy-dom
import type { App } from "obsidian";
import type { DragEvent as ReactDragEvent } from "react";
import { expect, it, vi } from "vitest";

import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { createItemDrag, ITEM_DRAG_TYPE, refuseItemDrop } from "./item-drag.ts";

function transfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  };
}

function setup() {
  const events = new MemoryWorkspace();
  const workspace = stubService<App["workspace"]>("Workspace", {
    on: events.on.bind(events) as App["workspace"]["on"],
    offref: events.offref.bind(events),
  });
  const insertCitation = vi.fn(() => undefined);
  const drag = createItemDrag({
    app: stubService<App>("App", { workspace }),
    actions: { insertCitation },
  });
  const row = document.createElement("div");
  document.body.append(row);
  const start = (key: string) => {
    const dataTransfer = transfer();
    drag(key, {
      dataTransfer,
      currentTarget: row,
    } as unknown as ReactDragEvent<HTMLElement>);
    return dataTransfer;
  };
  const drop = (dataTransfer: ReturnType<typeof transfer>) => {
    const editor = { cm: { posAtCoords: () => 42 } };
    const info = { file: { path: "Reading.md" } };
    const event = {
      dataTransfer,
      clientX: 1,
      clientY: 2,
      preventDefault: vi.fn(),
    };
    events.trigger("editor-drop", event, editor, info);
    return { event, editor, info };
  };
  return { start, drop, insertCitation, row };
}

it("inserts the citation of the dragged Item where it lands in the note", () => {
  const { start, drop, insertCitation } = setup();
  const data = start("ABCD2345g4815");
  expect(data.getData("text/plain")).toBe(
    "zotero://select/groups/4815/items/ABCD2345",
  );
  const { event, editor, info } = drop(data);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(insertCitation).toHaveBeenCalledExactlyOnceWith("ABCD2345g4815", {
    editor,
    info,
    at: 42,
  });
});

it("leaves a drop of another drag to the editor", () => {
  const { start, drop, insertCitation } = setup();
  start("ABCD2345");
  const other = transfer();
  other.setData(ITEM_DRAG_TYPE, "another drag");
  const { event } = drop(other);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(insertCitation).not.toHaveBeenCalled();
});

it("inserts nothing once the drag ended without a drop", () => {
  const { start, drop, insertCitation, row } = setup();
  const data = start("ABCD2345");
  row.win.dispatchEvent(new Event("dragend"));
  drop(data);
  expect(insertCitation).not.toHaveBeenCalled();
});

it("refuses an Item dropped on the view, and lets any other drag through", () => {
  const item = transfer();
  item.setData(ITEM_DRAG_TYPE, "a drag");
  const over = { dataTransfer: item, preventDefault: vi.fn() };
  refuseItemDrop(over as unknown as globalThis.DragEvent);
  expect(item.dropEffect).toBe("none");

  const file = transfer();
  file.dropEffect = "copy";
  file.setData("Files", "");
  refuseItemDrop({
    dataTransfer: file,
    preventDefault: vi.fn(),
  } as unknown as globalThis.DragEvent);
  expect(file.dropEffect).toBe("copy");
});
