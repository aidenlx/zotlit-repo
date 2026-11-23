// @vitest-environment happy-dom

import type { CardSelection } from "#core/annot-view/card-selection.ts";
import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { editorApp } from "@zotlit/obsidian-kit/__fixtures__/editor-app.ts";
import { AppContext } from "@zotlit/obsidian-kit/app-context.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { AnnotActionsContext, NOOP_ACTIONS } from "./actions.tsx";
import type { AnnotActions } from "./actions.tsx";
import { AnnotView } from "./AnnotView.tsx";

import { makeAnnotHost } from "#__fixtures__/annot-view/host.ts";
import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";
import {
  cardPlace,
  NO_SELECTION,
  nextCardSelection,
  sameKeys,
} from "#core/annot-view/card-selection.ts";
import {
  AnnotStoreProvider,
  visibleOrder,
} from "#obsidian/annot-view/store.ts";

const KEYS = ["AAAA1111", "BBBB2222", "CCCC3333"];

function highlight(key: string, text: string): AnnotationRecord {
  return {
    key,
    parentKey: "PDF00001",
    type: "highlight",
    color: "#ffd400",
    comment: null,
    text,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
  };
}

const TEXTS = ["alpha", "beta shared", "gamma shared"];

let root: Root | undefined;

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await act(() => root?.unmount());
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  root = undefined;
  document.body.replaceChildren();
});

async function mountList({
  app = stubService<App>("App", {}),
  actions = {},
}: { app?: App; actions?: Partial<AnnotActions> } = {}) {
  const hostModel = makeAnnotHost(layerUnreadViewServices);
  cleanup.use(hostModel);
  const store = hostModel.openCards();
  store.setState({
    attachments: [
      { itemID: 1, indexedKey: "PDF00001", path: null, annotCount: 3 },
    ],
    selectedAttachmentKey: "PDF00001",
    annotations: KEYS.map((key, index) => highlight(key, TEXTS[index]!)),
  });
  store.subscribe(
    (s) => visibleOrder(s),
    () =>
      store.setState((s) => ({
        cardSelection: nextCardSelection(s.cardSelection, visibleOrder(s), {
          kind: "prune",
        }),
      })),
    { equalityFn: sameKeys },
  );
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() =>
    root?.render(
      createElement(
        AppContext,
        { value: app },
        createElement(
          AnnotActionsContext,
          { value: { ...NOOP_ACTIONS, ...actions } },
          createElement(
            AnnotStoreProvider,
            { value: store },
            createElement(AnnotView),
          ),
        ),
      ),
    ),
  );
  const select = (selection: CardSelection) =>
    act(() => store.setState({ cardSelection: selection }));
  return { host, select, store };
}

function cardGrid(host: HTMLElement): HTMLElement {
  const grid = host.querySelector<HTMLElement>(
    '.annots-container > [role="grid"]',
  );
  if (!grid) throw new Error("no card grid");
  return grid;
}

function rows(host: HTMLElement) {
  return [...cardGrid(host).querySelectorAll<HTMLElement>('[role="row"]')].map(
    (row) => ({
      key: row.getAttribute("data-zotero-annotation-key"),
      selected: row.getAttribute("aria-selected"),
      tabbable: row.tabIndex === 0,
    }),
  );
}

function tabOrder(host: HTMLElement): string[] {
  return [...cardGrid(host).querySelectorAll<HTMLElement>("*")]
    .filter((el) => el.tabIndex >= 0 && !el.hasAttribute("disabled"))
    .map((el) => {
      const row = el.closest('[role="row"]');
      const key = row?.getAttribute("data-zotero-annotation-key") ?? "?";
      return el === row ? `row ${key}` : `control in ${key}`;
    });
}

function onlyRow(host: HTMLElement, key: string): string[] {
  const row = cardGrid(host).querySelector<HTMLElement>(
    `[data-zotero-annotation-key="${key}"]`,
  );
  const controls = [...(row?.querySelectorAll<HTMLElement>("*") ?? [])].filter(
    (el) => el.tabIndex >= 0 || el.hasAttribute("data-zt-held-tabindex"),
  );
  expect(controls.length).toBeGreaterThan(0);
  return [`row ${key}`, ...controls.map(() => `control in ${key}`)];
}

describe("the card list", () => {
  it("is one multi-select grid whose rows are the cards, in list order", async () => {
    const { host } = await mountList();
    const grid = cardGrid(host);
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");
    const label = document.getElementById(
      grid.getAttribute("aria-labelledby") ?? "",
    );
    expect(label?.textContent).toBe(m.annot_view_name());
    expect(grid.hasAttribute("aria-label")).toBe(false);
    const cards = [...grid.querySelectorAll(".zt-annot-card")];
    expect(cards.map((card) => card.getAttribute("role"))).toEqual(
      KEYS.map(() => "row"),
    );
    expect(cards.map((card) => card.parentElement)).toEqual(
      KEYS.map(() => grid),
    );
    expect(
      cards.map((card) =>
        [...card.children].map((child) => child.getAttribute("role")),
      ),
    ).toEqual(KEYS.map(() => ["gridcell"]));
    expect(rows(host).map(({ key }) => key)).toEqual(KEYS);
  });

  it("offers the first row as its one tab stop while nothing is selected", async () => {
    const { host } = await mountList();
    expect(rows(host)).toEqual([
      { key: "AAAA1111", selected: "false", tabbable: true },
      { key: "BBBB2222", selected: "false", tabbable: false },
      { key: "CCCC3333", selected: "false", tabbable: false },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "AAAA1111"));
  });

  it("follows the Card Selection with aria-selected and moves the tab stop to its anchor", async () => {
    const { host, select } = await mountList();

    await select({
      selected: ["BBBB2222"],
      anchor: cardPlace("BBBB2222", null),
      focus: cardPlace("BBBB2222", null),
    });
    expect(rows(host)).toEqual([
      { key: "AAAA1111", selected: "false", tabbable: false },
      { key: "BBBB2222", selected: "true", tabbable: true },
      { key: "CCCC3333", selected: "false", tabbable: false },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "BBBB2222"));

    await select({
      selected: ["AAAA1111", "CCCC3333"],
      anchor: cardPlace("CCCC3333", null),
      focus: cardPlace("CCCC3333", null),
    });
    expect(rows(host)).toEqual([
      { key: "AAAA1111", selected: "true", tabbable: false },
      { key: "BBBB2222", selected: "false", tabbable: false },
      { key: "CCCC3333", selected: "true", tabbable: true },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "CCCC3333"));

    await select(NO_SELECTION);
    expect(rows(host)).toEqual([
      { key: "AAAA1111", selected: "false", tabbable: true },
      { key: "BBBB2222", selected: "false", tabbable: false },
      { key: "CCCC3333", selected: "false", tabbable: false },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "AAAA1111"));
  });

  it("keeps a control drawn later on another row out of the Tab order", async () => {
    const { host, store } = await mountList();
    await act(() =>
      store.setState((s) => ({
        annotations: s.annotations!.map((annot) => ({
          ...annot,
          tags: ["later"],
        })),
      })),
    );
    expect(tabOrder(host)).toEqual(onlyRow(host, "AAAA1111"));
  });

  it("keeps one tab stop among the rows a filter leaves", async () => {
    const { host, select, store } = await mountList();

    await select({
      selected: ["AAAA1111", "CCCC3333"],
      anchor: cardPlace("AAAA1111", null),
      focus: cardPlace("AAAA1111", null),
    });
    await act(() => store.setState({ filterQuery: "shared" }));
    expect(store.getState().cardSelection).toEqual({
      selected: ["CCCC3333"],
      anchor: cardPlace("AAAA1111", null),
      focus: cardPlace("AAAA1111", null),
    });
    expect(rows(host)).toEqual([
      { key: "BBBB2222", selected: "false", tabbable: false },
      { key: "CCCC3333", selected: "true", tabbable: true },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "CCCC3333"));

    await act(() => store.setState({ filterQuery: "" }));
    await select({
      selected: ["AAAA1111"],
      anchor: cardPlace("AAAA1111", null),
      focus: cardPlace("AAAA1111", null),
    });
    await act(() => store.setState({ filterQuery: "shared" }));
    expect(store.getState().cardSelection.selected).toEqual([]);
    expect(rows(host)).toEqual([
      { key: "BBBB2222", selected: "false", tabbable: true },
      { key: "CCCC3333", selected: "false", tabbable: false },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "BBBB2222"));
  });

  it("selects a tag named zt:clear-tags while the Clear action is available", async () => {
    const tagName = "zt:clear-tags";
    const { host, store } = await mountList({ app: editorApp() });
    await act(() =>
      store.setState({
        annotations: [
          { ...highlight("AAAA1111", "Methods"), tags: ["method"] },
          { ...highlight("BBBB2222", "Notes"), tags: [tagName] },
        ],
        selectedTags: ["method"],
      }),
    );

    const triggerLabel = m.annot_view_filter_tag_trigger_active({
      tags: "method",
    });
    const trigger = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${triggerLabel}"]`,
    );
    expect(trigger).not.toBeNull();
    await act(() => trigger!.click());

    const tag = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.textContent === tagName);
    expect(tag).toBeDefined();
    await act(() => tag!.click());
    expect(store.getState().selectedTags).toEqual(["method", tagName]);
  });
});

async function press(
  el: Element,
  { release = el }: { release?: Element } = {},
) {
  await act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    release.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("an open text field in the view", () => {
  it("closes from a click in the view away from it, and keeps its own clicks and drags", async () => {
    const onCloseEditors = vi.fn();
    const { host, store } = await mountList({
      app: editorApp(),
      actions: { onCloseEditors },
    });
    await act(() =>
      store.setState({
        cardSelection: { selected: [KEYS[0]!], anchor: null, focus: null },
        editing: { annotationKey: KEYS[0]!, field: "comment" },
      }),
    );
    const content = host.querySelector(".cm-content")!;
    const [first, second] = cardGrid(host).querySelectorAll('[role="row"]');

    await press(content);
    await press(content, { release: first! });
    await press(cardGrid(host));
    expect(onCloseEditors).not.toHaveBeenCalled();

    await press(second!.querySelector("blockquote")!);
    expect(onCloseEditors).toHaveBeenCalledOnce();
  });
});
