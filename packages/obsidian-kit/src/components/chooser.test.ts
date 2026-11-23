// @vitest-environment happy-dom
import type { App } from "obsidian";
import { render } from "preact";
import { act } from "preact/test-utils";
import { createElement as h } from "react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { chooserRowKey } from "./chooser-logic.ts";
import type { ChooserRow } from "./chooser-logic.ts";
import { Chooser } from "./chooser.tsx";

import { editorApp } from "#__fixtures__/editor-app.ts";
import { AppContext } from "#app-context.ts";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<typeof import("obsidian")>()),
  prepareFuzzySearch: (query: string) => (text: string) =>
    text.includes(query) ? { score: 0, matches: [] } : null,
}));

const ROWS: ChooserRow[] = [
  { value: "method", label: "method" },
  { value: "theory", label: "theory" },
  { value: "review", label: "review" },
];

let host: HTMLElement | null = null;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
});

function mount(
  app: App,
  {
    blocked,
    rows = ROWS,
    onValueChange = () => {},
  }: {
    blocked?: boolean;
    rows?: ChooserRow[];
    onValueChange?: (values: string[]) => void;
  } = {},
) {
  host = document.body.appendChild(document.createElement("div"));
  const list = h(Chooser.List<ChooserRow>, {
    groups: [{ items: rows }],
    label: "Tags",
    children: (row: ChooserRow) =>
      row.action
        ? h(Chooser.Action, { key: chooserRowKey(row), id: row.id }, row.label)
        : h(
            Chooser.Item,
            { key: chooserRowKey(row), value: row.value },
            row.label,
          ),
  });
  const ui: ReactNode = h(AppContext, {
    value: app,
    children: h(Chooser, {
      value: [],
      onValueChange,
      children: [
        h(Chooser.Trigger, { key: "trigger", blocked }, "Tags"),
        h(Chooser.Popup, {
          key: "popup",
          children: [
            h(Chooser.Input, {
              key: "input",
              placeholder: "Search",
              clearLabel: "Clear",
            }),
            list,
          ],
        }),
      ],
    }),
  });
  render(ui, host);
  const button = host.querySelector<HTMLButtonElement>("button")!;
  const popup = () => document.querySelector<HTMLElement>(".zt-chooser");
  const toggle = async (newState: "open" | "closed") => {
    if ((popup() !== null) === (newState === "open")) return;
    await act(() => {
      if (newState === "open") button.click();
      else
        document.body.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
    });
  };
  const field = () => popup()?.querySelector("input") ?? null;
  const options = () =>
    [...(popup()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].map(
      (option) => option.textContent,
    );
  const highlighted = () =>
    popup()?.querySelector<HTMLElement>("[data-highlighted]")?.textContent ??
    null;
  return { popup, button, toggle, field, options, highlighted };
}

it("keeps a blocked trigger in the tab order and opens nothing on its press", async () => {
  const { button, popup } = mount(editorApp(), { blocked: true });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.disabled).toBe(false);
  await act(() => button.click());
  expect(popup()).toBeNull();
});

it("opens its popup on the press of a trigger that is not blocked", async () => {
  const { button, popup } = mount(editorApp());
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  await act(() => button.click());
  expect(popup()).not.toBeNull();
});

it("names its list box with no tooltip over the rows", async () => {
  const { popup, toggle } = mount(editorApp());
  await toggle("open");
  const list = popup()!.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(list.hasAttribute("aria-label")).toBe(false);
  const name = list.getAttribute("aria-labelledby")!;
  expect(popup()!.ownerDocument.getElementById(name)?.textContent).toBe("Tags");
});

it("draws its rows only while the popup is open", async () => {
  const app = editorApp();
  const { toggle, field, options } = mount(app);
  expect(field()).toBeNull();
  expect(app.scopes).toHaveLength(0);
  await toggle("open");
  expect(options()).toEqual(["method", "theory", "review"]);
  expect(app.scopes).toHaveLength(2);
  await toggle("closed");
  expect(options()).toEqual([]);
  expect(app.scopes).toHaveLength(0);
});

it("opens again with an empty search, every row and no highlight", async () => {
  const app = editorApp();
  const { toggle, field, options, highlighted } = mount(app);
  await toggle("open");
  await act(() => {
    const input = field()!;
    input.value = "theory";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(options()).toEqual(["theory"]);
  expect(highlighted()).toBe("theory");
  await toggle("closed");

  await toggle("open");
  expect(field()!.value).toBe("");
  expect(field()!.getAttribute("aria-activedescendant")).toBeNull();
  expect(options()).toEqual(["method", "theory", "review"]);
  expect(highlighted()).toBeNull();
  expect(app.scopes).toHaveLength(2);
  await act(() => {
    pressKey(app.scopes.at(-1)!, "ArrowDown");
  });
  expect(highlighted()).toBe("method");
});

it("selects an item and runs an action through distinct options", async () => {
  const action = vi.fn();
  const onValueChange = vi.fn();
  const { popup, toggle } = mount(editorApp(), {
    rows: [
      { value: "action:clear", label: "Tagged item" },
      { value: "clear", label: "Other item" },
      { id: "clear", label: "Clear selection", action },
    ],
    onValueChange,
  });
  await toggle("open");
  const options = popup()!.querySelectorAll<HTMLElement>('[role="option"]');
  const item = options[0]!;
  const clear = options[2]!;

  await act(() => item.click());
  expect(onValueChange).toHaveBeenCalledWith(["action:clear"]);
  expect(action).not.toHaveBeenCalled();

  await act(() => clear.click());
  expect(action).toHaveBeenCalledOnce();
  expect(onValueChange).toHaveBeenCalledOnce();
  expect(item.id).toBeTruthy();
  expect(clear.id).toBeTruthy();
  expect(item.id).not.toBe(clear.id);
});

function pressKey(scope: unknown, key: string): unknown {
  const { handlers } = scope as {
    handlers: {
      modifiers: string[] | null;
      key: string | null;
      func: (event: KeyboardEvent) => unknown;
    }[];
  };
  return handlers
    .find((handler) => handler.key === key && !handler.modifiers?.length)
    ?.func(new KeyboardEvent("keydown", { key }));
}
