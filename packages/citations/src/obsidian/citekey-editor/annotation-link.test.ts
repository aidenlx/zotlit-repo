// @vitest-environment happy-dom
import { EditorState, Prec } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

const { tokenClassNodeProp, editorMode } = vi.hoisted(() => ({
  tokenClassNodeProp: {},
  editorMode: { livePreview: false },
}));

vi.mock("@codemirror/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/language")>();
  return {
    ...actual,
    tokenClassNodeProp,
    syntaxTree: (state: EditorState) => ({
      length: state.doc.length,
      iterate: ({
        from,
        to,
        enter,
      }: {
        from: number;
        to: number;
        enter: (node: object) => void;
      }) => {
        for (const node of hypermdTokens(state.doc.toString())) {
          if (node.to < from || node.from > to) continue;
          enter({
            ...node,
            type: {
              prop: (property: unknown) =>
                property === tokenClassNodeProp ? node.classes : undefined,
            },
          });
        }
      },
    }),
  };
});

const BRACKET = "formatting formatting-link link";
const PAREN = "formatting formatting-link-string string url";

function hypermdTokens(
  text: string,
): { from: number; to: number; classes: string }[] {
  const nodes: { from: number; to: number; classes: string }[] = [];
  let at = 0;
  const push = (to: number, classes: string): void => {
    const last = nodes.at(-1);
    if (to <= at) return;
    if (last?.to === at && last.classes === classes) last.to = to;
    else nodes.push({ from: at, to, classes });
    at = to;
  };
  while (at < text.length) {
    if (text[at] === "`") {
      const close = text.indexOf("`", at + 1);
      push(close === -1 ? text.length : close + 1, "inline-code");
      continue;
    }
    if (text[at] !== "[") {
      at++;
      continue;
    }
    let depth = 0;
    let close = -1;
    for (let index = at + 1; index < text.length && close === -1; index++) {
      if (text[index] === "[") depth++;
      else if (text[index] === "]" && depth-- === 0) close = index;
    }
    if (close === -1) {
      at++;
      continue;
    }
    push(at + 1, BRACKET);
    push(close, "link");
    push(close + 1, BRACKET);
    const end = text.indexOf(")", at);
    if (text[at] !== "(" || end === -1) continue;
    push(at + 1, PAREN);
    push(end, "string url");
    push(end + 1, PAREN);
  }
  return nodes;
}

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  const { StateField } = await import("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define({
      create: () => ({ file: { path: "note.md" } }),
      update: (value) => value,
    }),
    editorLivePreviewField: StateField.define({
      create: () => editorMode.livePreview,
      update: (value) => value,
    }),
  };
});

import type { AnnotationHoverRequest } from "#obsidian/annotation-popover/service.ts";
import type { DocumentCitations } from "#obsidian/citation-text/present.ts";
import { editorInfoField, editorLivePreviewField } from "obsidian";

import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import { lookupAnswer } from "@zotlit/zotero-reads/__fixtures__/citation-lookup.ts";

import type { AnnotationLinkHoverHandlers } from "./annotation-link.ts";
import {
  annotationLinkAtPos,
  annotationLinkHoverExtension,
} from "./annotation-link.ts";

import { presented } from "#__fixtures__/citation-text.ts";

function linkHandlers(
  shown: AnnotationHoverRequest[],
  overrides: Partial<AnnotationLinkHoverHandlers> = {},
): AnnotationLinkHoverHandlers {
  return {
    showAnnotation: (request) => shown.push(request),
    showCitations: () => false,
    citationText: () => {
      throw new Error("No citation text is read while citations are off");
    },
    openItem: () => {
      throw new Error("Nothing opens a Literature Note here");
    },
    ...overrides,
  };
}

const LINK =
  "[p. 2](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2)";

const LINE = EditorState.create({ doc: `See ${LINK} here.` });

describe("annotationLinkAtPos", () => {
  it("answers with the annotation a position in the link text names", () => {
    expect(annotationLinkAtPos(LINE, 6)).toEqual({
      attachmentKey: "RGRPDF24",
      annotationKey: "FDRFQ7C2",
      pageLabel: "2",
      groupID: null,
    });
  });

  it("answers inside the URL too, which Source mode shows", () => {
    expect(annotationLinkAtPos(LINE, 40)?.annotationKey).toBe("FDRFQ7C2");
  });

  it("answers nothing beside the link", () => {
    expect(annotationLinkAtPos(LINE, 1)).toBeNull();
    expect(annotationLinkAtPos(LINE, 4 + LINK.length + 2)).toBeNull();
  });

  it("reads a group Library's link with its group", () => {
    const state = EditorState.create({
      doc: "[quote](zotero://open/groups/42/items/RGRPDF24?annotation=FDRFQ7C2)",
    });
    expect(annotationLinkAtPos(state, 2)).toEqual({
      attachmentKey: "RGRPDF24",
      annotationKey: "FDRFQ7C2",
      pageLabel: null,
      groupID: 42,
    });
  });

  it("reads link text that carries brackets of its own", () => {
    const state = EditorState.create({
      doc: "[[p. 2] quote](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
    });
    expect(annotationLinkAtPos(state, 3)?.annotationKey).toBe("FDRFQ7C2");
  });

  it("picks the link the position sits in, of two on one line", () => {
    const state = EditorState.create({
      doc:
        "[a](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5) and " +
        "[b](zotero://open/library/items/RGRPDF24?annotation=Q8ZR4TDH)",
    });
    expect(annotationLinkAtPos(state, 1)?.annotationKey).toBe("PUPR5FG5");
    expect(annotationLinkAtPos(state, 70)?.annotationKey).toBe("Q8ZR4TDH");
  });

  it("answers nothing for a Zotero link that names no annotation", () => {
    for (const doc of [
      "[item](zotero://open/library/items/RGRPDF24)",
      "[item](zotero://select/library/items/RGRPDF24)",
      "[web](https://example.org/?annotation=FDRFQ7C2)",
    ]) {
      expect(annotationLinkAtPos(EditorState.create({ doc }), 2)).toBeNull();
    }
  });

  it("answers the link that begins where the one before it ends", () => {
    const first =
      "[a](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5)";
    const state = EditorState.create({
      doc: `${first}[b](zotero://open/library/items/RGRPDF24?annotation=Q8ZR4TDH)`,
    });
    expect(annotationLinkAtPos(state, first.length - 1)?.annotationKey).toBe(
      "PUPR5FG5",
    );
    expect(annotationLinkAtPos(state, first.length)?.annotationKey).toBe(
      "Q8ZR4TDH",
    );
  });

  it("reads a link with empty text, whose brackets parse as one node", () => {
    const state = EditorState.create({
      doc: "[](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
    });
    expect(annotationLinkAtPos(state, 10)?.annotationKey).toBe("FDRFQ7C2");
  });

  it("answers nothing for what Obsidian does not parse as a link", () => {
    for (const doc of [
      `\`${LINK}\``,
      "p. 2](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
      "[p. 2] (zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
    ]) {
      expect(annotationLinkAtPos(EditorState.create({ doc }), 3)).toBeNull();
    }
  });
});

describe("annotationLinkHoverExtension", () => {
  it("shows the annotation without a citation hover setting", () => {
    const shown: AnnotationHoverRequest[] = [];
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: `See ${LINK} here.`,
        extensions: [
          editorInfoField,
          EditorView.decorations.of(
            Decoration.set([Decoration.mark({ class: "cm-link" }).range(5, 9)]),
          ),
          annotationLinkHoverExtension(linkHandlers(shown)),
        ],
      }),
    });
    using _ = { [Symbol.dispose]: () => view.destroy() };
    view.dom.classList.add("is-live-preview");
    const linkText = view.dom.querySelector<HTMLElement>(".cm-link")!;

    linkText.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: linkText.firstChild,
      }),
    );
    expect(shown).toEqual([]);

    linkText.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(shown).toHaveLength(1);
  });

  it("anchors on the whole link while the pointer crosses from its text to its URL", () => {
    const shown: AnnotationHoverRequest[] = [];
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: `See ${LINK} here.`,
        extensions: [
          editorInfoField,
          annotationLinkHoverExtension(linkHandlers(shown)),
          Prec.lowest(
            EditorView.decorations.of(
              Decoration.set([
                Decoration.mark({ class: "cm-link" }).range(5, 9),
                Decoration.mark({ class: "cm-url" }).range(11, 75),
              ]),
            ),
          ),
        ],
      }),
    });
    using _ = { [Symbol.dispose]: () => view.destroy() };
    const linkText = view.dom.querySelector<HTMLElement>(".cm-link")!;
    const url = view.dom.querySelector<HTMLElement>(".cm-url")!;

    linkText.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    url.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: linkText }),
    );

    expect(shown).toHaveLength(1);
    const anchor = shown[0]!.targetEl;
    expect(anchor.contains(linkText) && anchor.contains(url)).toBe(true);
    expect(anchor.textContent).toBe(LINK);
  });

  it("shows the second of two touching links when its text is hovered", () => {
    const shown: AnnotationHoverRequest[] = [];
    const first =
      "[a](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5)";
    const second =
      "[b](zotero://open/library/items/RGRPDF24?annotation=Q8ZR4TDH)";
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: first + second,
        extensions: [
          editorInfoField,
          annotationLinkHoverExtension(linkHandlers(shown)),
          Prec.lowest(
            EditorView.decorations.of(
              Decoration.set([
                Decoration.mark({ class: "cm-link" }).range(1, 2),
                Decoration.mark({ class: "cm-link" }).range(
                  first.length + 1,
                  first.length + 2,
                ),
              ]),
            ),
          ),
        ],
      }),
    });
    using _ = { [Symbol.dispose]: () => view.destroy() };
    const secondText = view.dom.querySelectorAll<HTMLElement>(".cm-link")[1]!;

    secondText.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(shown.map(({ link }) => link.annotationKey)).toEqual(["Q8ZR4TDH"]);
    expect(shown[0]!.targetEl.textContent).toBe(second);
  });
});

const CITATION_URL =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2";
const CITATION = `[](${CITATION_URL})`;
const CITATION_START = 4;

function citationsOf(
  formatted: Record<string, number[]> = { [CITATION]: [CITATION_START] },
): Held<DocumentCitations> {
  const value: DocumentCitations = {
    lookup: lookupAnswer({}, { ABCD2345: "doe2024" }),
    formatted: new Map(
      Object.entries(formatted).map(([source, starts]) => [
        source,
        starts.map((start) => ({
          ...presented("(Doe 2024, 2)"),
          text: {
            ...presented("(Doe 2024, 2)").text,
            citations: [{ id: "ABCD2345", mode: "normal" as const }],
          },
          start,
        })),
      ]),
    ),
    entrySerials: false,
    summaries: new Map(),
    literalWorks: new Map(),
  };
  return { value, status: "fresh", settled: Promise.resolve(value) };
}

function livePreviewEditor(
  doc: string,
  handlers: AnnotationLinkHoverHandlers,
  { livePreview = true }: { livePreview?: boolean } = {},
): EditorView {
  editorMode.livePreview = livePreview;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        editorInfoField,
        editorLivePreviewField,
        annotationLinkHoverExtension(handlers),
      ],
    }),
  });
  if (livePreview) view.dom.classList.add("is-live-preview");
  return view;
}

function shownAs(view: EditorView, text: string): HTMLElement | undefined {
  return [...view.contentDOM.querySelectorAll<HTMLElement>("span")].find(
    (element) => element.textContent === text,
  );
}

describe("Annotation Citations in Live Preview", () => {
  it("shows the formatted citation in place of the link", () => {
    const shown: AnnotationHoverRequest[] = [];
    const view = livePreviewEditor(
      `See ${CITATION} here.`,
      linkHandlers(shown, {
        showCitations: () => true,
        citationText: () => citationsOf(),
      }),
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    expect(view.contentDOM.textContent).toBe("See (Doe 2024, 2) here.");
  });

  it("keeps the link while the setting is off", () => {
    const view = livePreviewEditor(`See ${CITATION} here.`, linkHandlers([]));
    using _ = { [Symbol.dispose]: () => view.destroy() };

    expect(view.contentDOM.textContent).toBe(`See ${CITATION} here.`);
  });

  it("keeps the link in Source mode", () => {
    const view = livePreviewEditor(
      `See ${CITATION} here.`,
      linkHandlers([], {
        showCitations: () => true,
        citationText: () => citationsOf(),
      }),
      { livePreview: false },
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    expect(view.contentDOM.textContent).toBe(`See ${CITATION} here.`);
  });

  it("keeps a link with text, and one the citations leave out, as links", () => {
    const labelled = `[p. 2](${CITATION_URL})`;
    const view = livePreviewEditor(
      `See ${labelled} and ${CITATION} here.`,
      linkHandlers([], {
        showCitations: () => true,
        citationText: () => citationsOf({ [labelled]: [4] }),
      }),
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    expect(view.contentDOM.textContent).toBe(
      `See ${labelled} and ${CITATION} here.`,
    );
  });

  it("hovers the link the citation stands for, and opens the Item's note", () => {
    const shown: AnnotationHoverRequest[] = [];
    const opened: unknown[] = [];
    const view = livePreviewEditor(
      `See ${CITATION} here.`,
      linkHandlers(shown, {
        showCitations: () => true,
        citationText: () => citationsOf(),
        openItem: (indexedKey, pane) => opened.push([indexedKey, pane]),
      }),
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    shownAs(view, "(Doe 2024, 2)")!.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );

    expect(shown).toHaveLength(1);
    expect(shown[0]!.link.annotationKey).toBe("FDRFQ7C2");
    shown[0]!.open("ABCD2345", "tab");
    expect(opened).toEqual([["ABCD2345", "tab"]]);
  });

  it("follows the link on a click, as the link itself does", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    using _restore = { [Symbol.dispose]: () => open.mockRestore() };
    const view = livePreviewEditor(
      `See ${CITATION} here.`,
      linkHandlers([], {
        showCitations: () => true,
        citationText: () => citationsOf(),
      }),
    );
    using _ = { [Symbol.dispose]: () => view.destroy() };

    shownAs(view, "(Doe 2024, 2)")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    expect(open).toHaveBeenCalledWith(CITATION_URL, undefined);
  });
});
