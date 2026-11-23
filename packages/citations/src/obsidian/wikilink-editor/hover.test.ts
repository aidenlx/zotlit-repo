// @vitest-environment happy-dom
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import type { EditorStateConfig, Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { lookupAnswer } from "@zotlit/zotero-reads/__fixtures__/citation-lookup.ts";

const { livePreview, tokenClassNodeProp } = vi.hoisted(() => ({
  livePreview: vi.fn(() => true),
  tokenClassNodeProp: {},
}));

vi.mock(
  "@zotlit/obsidian-kit/editor-decoration.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@zotlit/obsidian-kit/editor-decoration.ts")
    >()),
    livePreviewOf: livePreview,
  }),
);

vi.mock("@codemirror/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/language")>();
  const treeOf = (state: EditorState) => ({
    length: state.doc.length,
    iterate: ({ enter }: { enter: (node: object) => void }) => {
      const text = state.doc.toString();
      const nodes = [];
      for (let at = text.indexOf("[["); at !== -1;) {
        const closing = text.indexOf("]]", at);
        if (closing === -1) break;
        nodes.push(
          { from: at, to: at + 2, classes: ["formatting-link-start"] },
          { from: at + 2, to: closing, classes: ["hmd-internal-link"] },
          {
            from: closing,
            to: closing + 2,
            classes: ["formatting-link-end"],
          },
        );
        at = text.indexOf("[[", closing);
      }
      for (const node of nodes) {
        enter({
          ...node,
          type: {
            prop: (property: unknown) =>
              property === tokenClassNodeProp
                ? node.classes.join(" ")
                : undefined,
          },
        });
      }
    },
  });
  const trees = new WeakMap<Text, ReturnType<typeof treeOf>>();
  return {
    ...actual,
    tokenClassNodeProp,
    syntaxTree: (state: EditorState) => {
      const prior = trees.get(state.doc);
      if (prior) return prior;
      const tree = treeOf(state);
      trees.set(state.doc, tree);
      return tree;
    },
  };
});

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  const { StateField } = await import("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define({
      create: () => ({
        file: { path: "note.md" },
        app: { workspace: { trigger: () => undefined } },
      }),
      update: (value: unknown) => value,
    }),
  };
});

import type { DocumentCitations } from "#obsidian/citation-text/present.ts";
import type { CitationHoverRequest } from "#obsidian/citekey-navigation/index.ts";
import type { HoverPreferences } from "#obsidian/citekey-navigation/index.ts";
import { Keymap, editorInfoField } from "obsidian";

import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { heldCitekeyOf } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import {
  wikilinkDecorationsChanged,
  wikilinkEditorExtension,
} from "./extension.ts";

import { lookupObservation } from "#__fixtures__/citation-index/citation-lookup.ts";
import { occurrences, rendered } from "#__fixtures__/citation-text.ts";
import { defaults } from "#__fixtures__/settings.ts";
import { citationKey } from "#obsidian/citation-text/present.ts";
import { hoverPreferences } from "#obsidian/citekey-navigation/index.ts";

const LITERATURE_NOTE = {
  path: "literatures/example.md",
  indexedKey: "1/EXAMPLE",
  citationKey: "example",
};

const OTHER_NOTE = {
  path: "literatures/other.md",
  indexedKey: "1/OTHER",
  citationKey: "other",
};

function heldText(
  source: string,
  works: string[],
  { text, start = 0 }: { text: string; start?: number },
) {
  return [
    citationKey({ source, works }),
    occurrences(rendered(text), start),
  ] as const;
}

function harness(
  doc: string,
  overrides: Partial<Settings> = {},
  editor: Pick<EditorStateConfig, "extensions" | "selection"> = {},
) {
  const requests: CitationHoverRequest[] = [];
  const native: MouseEvent[] = [];
  const opened: [citekey: string, pane: unknown][] = [];
  let settings: Readonly<Settings> = { ...defaults, ...overrides };
  let hover: HoverPreferences = hoverPreferences(settings);
  const hold = (value: DocumentCitations): Held<DocumentCitations> => ({
    value,
    status: "fresh",
    settled: Promise.resolve(value),
  });
  let held = hold(citations());

  function citations(start = 0): DocumentCitations {
    return {
      entrySerials: false,
      formatted: new Map([
        heldText("[@example, {p. 7}]", [LITERATURE_NOTE.indexedKey], {
          text: "(Example 2020, p. 7)",
          start,
        }),
        heldText(
          "[@example, {p. 7}; @other]",
          [LITERATURE_NOTE.indexedKey, OTHER_NOTE.indexedKey],
          { text: "(Example 2020, p. 7; Other 2021)", start },
        ),
      ]),
      summaries: new Map(),
      lookup: lookupAnswer(
        {},
        Object.fromEntries(
          [LITERATURE_NOTE, OTHER_NOTE].map((note) => [
            note.indexedKey,
            note.citationKey,
          ]),
        ),
      ),
      literalWorks: new Map(),
    };
  }

  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: editor.selection,
      extensions: [
        editorInfoField,
        editor.extensions ?? [],
        wikilinkEditorExtension({
          literatureNote: (linkpath, _sourcePath, lookup) => {
            const note =
              linkpath === "literatures/example"
                ? LITERATURE_NOTE
                : linkpath === "literatures/other"
                  ? OTHER_NOTE
                  : null;
            return note
              ? {
                  ...note,
                  citationKey: heldCitekeyOf(lookup, note.indexedKey) ?? null,
                }
              : null;
          },
          observeLookup: (changed) =>
            lookupObservation(
              async ({ indexedKeys = [] }) =>
                lookupAnswer(
                  {},
                  Object.fromEntries(
                    indexedKeys.map((key) => [
                      key,
                      [LITERATURE_NOTE, OTHER_NOTE].find(
                        (note) => note.indexedKey === key,
                      )?.citationKey ?? null,
                    ]),
                  ),
                ),
              changed,
              () => undefined,
            ),
          enabled: () => true,
          citationText: () => held,
          open: (citekey, pane) => opened.push([citekey, pane]),
          showPopover: (request) => requests.push(request),
          hoverPreferences: () => hover,
          popoverHover: () => hover.action === "popover",
          clickIntercepted: () => !settings["citation.open-as-links"],
        }),
      ],
    }),
  });
  view.dom.addEventListener("mouseover", (event) => native.push(event));
  view.dom.addEventListener("click", (event) => native.push(event));

  vi.spyOn(view, "posAtCoords").mockReturnValue(2);

  return {
    view,
    requests,
    native,
    opened,
    selection: () => view.state.selection.main,
    citation: () => view.dom.querySelector<HTMLElement>(".zt-citation"),
    hover: () => {
      view.dom
        .querySelector(".zt-citation")
        ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    },
    click: (init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      view.dom.querySelector(".zt-citation")?.dispatchEvent(event);
      return event;
    },
    setSettings: (next: Partial<Settings>) => {
      settings = { ...defaults, ...next };
      hover = hoverPreferences(settings);
      view.dispatch({ effects: wikilinkDecorationsChanged.of(undefined) });
    },
    redraw: () => {
      held = hold(citations(7));
      view.dispatch({ changes: { from: 0, insert: "Before " } });
    },
    [Symbol.dispose]: () => view.destroy(),
  };
}

describe("wikilinkEditorExtension reveal in a freshly opened note", () => {
  const link = "[[literatures/example#cite:locator=7]]";

  it("keeps the first Citation formatted until a transaction sets the selection", () => {
    using editor = harness(link, {}, { selection: { anchor: 0 } });
    const { view } = editor;
    view.focus();
    expect(view.hasFocus).toBe(true);
    expect(editor.selection().anchor).toBe(0);
    view.dispatch({});

    expect.soft(view.contentDOM.textContent).toContain("(Example 2020, p. 7)");
    expect.soft(view.contentDOM.textContent).not.toContain(link);

    view.dispatch({ selection: { anchor: 0 } });

    expect(view.contentDOM.textContent).toBe(link);
  });

  it("keeps the first Citation formatted after a set edit and reveals it after typing", () => {
    const doc = `${link} after`;
    using editor = harness(doc, {}, { selection: { anchor: 0 } });
    const { view } = editor;
    view.focus();
    expect(view.hasFocus).toBe(true);

    view.dispatch({
      changes: { from: doc.length, insert: "!" },
      userEvent: "set",
    });

    expect.soft(view.contentDOM.textContent).toContain("(Example 2020, p. 7)");
    expect.soft(view.contentDOM.textContent).not.toContain(link);
    expect(view.contentDOM.textContent).toContain(" after!");

    view.dispatch({
      changes: { from: view.state.doc.length, insert: "?" },
      userEvent: "input.type",
    });

    expect(view.contentDOM.textContent).toBe(`${doc}!?`);
  });

  it("shows source when the editor starts with the caret inside the Citation", () => {
    using editor = harness(link, {}, { selection: { anchor: 2 } });
    const { view } = editor;
    view.focus();
    expect(view.hasFocus).toBe(true);
    view.dispatch({});

    expect(view.contentDOM.textContent).toBe(link);
  });
});

describe("wikilinkEditorExtension search reveal", () => {
  it("reveals source while search highlights an unfocused Citation and restores its display when cleared", () => {
    const link = "[[literatures/example#cite:locator=7]]";
    const doc = `${link} after`;
    const match = Decoration.set(
      Decoration.mark({ class: "obsidian-search-match-highlight" }).range(
        2,
        13,
      ),
    );
    const setHighlights = StateEffect.define<DecorationSet>();
    const highlights = StateField.define({
      create: () => match,
      update: (value, transaction) => {
        for (const effect of transaction.effects) {
          if (effect.is(setHighlights)) return effect.value;
        }
        return value;
      },
      provide: (field) => EditorView.decorations.from(field),
    });
    using editor = harness(
      doc,
      {},
      {
        extensions: highlights,
        selection: { anchor: doc.length },
      },
    );
    const { view } = editor;
    const text = () => view.contentDOM.textContent;

    expect(view.hasFocus).toBe(false);
    expect(text()).toBe(doc);

    view.dispatch({ effects: setHighlights.of(Decoration.none) });
    expect(text()).toContain("(Example 2020, p. 7)");

    view.dispatch({ effects: setHighlights.of(match) });
    expect(text()).toBe(doc);

    const flash = Decoration.set(
      Decoration.mark({ class: "is-flashing" }).range(2, 13),
    );
    view.dispatch({ effects: setHighlights.of(flash) });
    expect(text()).toContain("(Example 2020, p. 7)");
  });
});

describe("wikilinkEditorExtension hover under the Citation Popover", () => {
  it("shows the popover of the work the Citation names", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.requests[0]).toMatchObject({
      targetEl: editor.citation(),
      sourcePath: "note.md",
      works: [{ citekey: "example", indexedKey: LITERATURE_NOTE.indexedKey }],
    });
  });

  it("stacks every work a Citation Run names, in citation order", () => {
    using editor = harness(
      "[[literatures/example#cite:locator=7]]; [[literatures/other]]",
    );

    editor.hover();

    expect(editor.requests[0]?.works).toEqual([
      { citekey: "example", indexedKey: LITERATURE_NOTE.indexedKey },
      { citekey: "other", indexedKey: OTHER_NOTE.indexedKey },
    ]);
  });

  it("keeps Obsidian's own hover out of a Citation the popover answers", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.native).toEqual([]);
  });

  it("keeps and hovers a Citation after its occurrence moves", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");
    const drawn = editor.citation();

    editor.redraw();
    expect(editor.citation()).toBe(drawn);
    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.requests[0]?.shown?.at).toEqual({
      kind: "offset",
      start: 7,
    });
  });

  it("holds the hover back until Mod is held where Live Preview asks for it", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-require-mod-live-preview": true,
    });

    editor.hover();
    expect(editor.requests).toEqual([]);

    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    editor.hover();
    expect(editor.requests).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("keeps Obsidian's own hover out while Require Mod holds the popover back", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-require-mod-live-preview": true,
    });
    expect(editor.citation()).not.toBeNull();

    editor.hover();

    expect(editor.requests).toEqual([]);
    expect(editor.native).toEqual([]);
  });
});

describe("wikilinkEditorExtension hover under the other Hover Actions", () => {
  it("leaves the hover to Obsidian under Page preview and Off", () => {
    for (const action of ["page-preview", "off"] as const) {
      using editor = harness("[[literatures/example#cite:locator=7]]", {
        "citation.hover-action": action,
      });

      editor.hover();

      expect(editor.requests).toEqual([]);
      expect(editor.native).toHaveLength(1);
    }
  });

  it("takes its listener off as soon as hover stops being the popover's", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.setSettings({ "citation.hover-action": "off" });
    editor.hover();

    expect(editor.requests).toEqual([]);
    expect(editor.native).toHaveLength(1);
  });

  it("answers a Citation again once the popover is the Hover Action", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-action": "off",
    });

    editor.setSettings({ "citation.hover-action": "popover" });
    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.native).toEqual([]);
  });
});

describe("wikilinkEditorExtension click while Citations stay closed as links", () => {
  it("places the caret where a plain click landed, and stops there", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");
    expect(editor.citation()?.dataset.ztClick).toBe("edit");

    const event = editor.click();

    expect(editor.selection()).toMatchObject({ anchor: 2, head: 2 });
    expect(editor.requests).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.native).toEqual([]);
  });

  it("answers the click while the Hover Action is off", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-action": "off",
    });

    editor.hover();
    expect(editor.requests).toEqual([]);

    const event = editor.click();
    expect(event.defaultPrevented).toBe(true);
    expect(editor.selection()).toMatchObject({ anchor: 2 });
  });

  it("answers the click while Require Mod holds the hover back", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-require-mod-live-preview": true,
    });

    const event = editor.click();

    expect(event.defaultPrevented).toBe(true);
    expect(editor.selection()).toMatchObject({ anchor: 2 });
  });

  it("leaves a Mod-click to Obsidian, which opens the note the link names", () => {
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    using editor = harness("[[literatures/example#cite:locator=7]]");

    const event = editor.click({ ctrlKey: true });

    expect(editor.requests).toEqual([]);
    expect(editor.opened).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.selection()).toMatchObject({ anchor: 0 });
    expect(editor.native).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("leaves a click of another button to Obsidian", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.click({ button: 1 });

    expect(editor.requests).toEqual([]);
    expect(editor.selection()).toMatchObject({ anchor: 0 });
    expect(editor.native).toHaveLength(1);
  });
});

describe("wikilinkEditorExtension click while Citations open as links", () => {
  it("leaves every click to Obsidian", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.open-as-links": true,
    });
    expect(editor.citation()?.dataset.ztClick).toBe("open");

    const event = editor.click();

    expect(editor.requests).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.selection()).toMatchObject({ anchor: 0 });
    expect(editor.native).toHaveLength(1);
  });

  it("takes its listener off as soon as Citations open as links", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.setSettings({ "citation.open-as-links": true });
    editor.click();

    expect(editor.citation()?.dataset.ztClick).toBe("open");
    expect(editor.selection()).toMatchObject({ anchor: 0 });
    expect(editor.native).toHaveLength(1);
  });

  it("answers a Citation's click again once they stay closed as links", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.open-as-links": true,
    });

    editor.setSettings({ "citation.open-as-links": false });
    expect(editor.citation()?.dataset.ztClick).toBe("edit");
    editor.click();

    expect(editor.selection()).toMatchObject({ anchor: 2 });
    expect(editor.native).toEqual([]);
  });
});
