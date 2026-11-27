import type { Extension } from "@codemirror/state";
import { Compartment } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { EditorView, ViewPlugin, tooltips } from "@codemirror/view";

import { PINNED_POPOVER_BODY } from "@zotlit/obsidian-kit/components/pinned-popover.tsx";

import { onEditorWindowMigrated } from "#core/editor/editor-migration.ts";

export const CODE_PANE_CLASS = "zt-template-workbench-code";

const popoutCopy = EditorView.domEventHandlers({
  copy(event, view) {
    const { main } = view.state.selection;
    if (event.clipboardData || view.root === document || main.empty)
      return false;
    void navigator.clipboard.writeText(view.state.sliceDoc(main.from, main.to));
    return true;
  },
});

export const hostedEditor: Extension = [
  EditorView.theme({
    ".cm-problem-button": { color: "var(--text-error)" },
    ".cm-lintRange-error": {
      backgroundImage: "none",
      textDecoration: "underline wavy var(--text-error)",
      textUnderlineOffset: "0.2em",
    },
    ".cm-diagnostic-error": { borderInlineStartColor: "var(--text-error)" },
    ".cm-tooltip-lint": {
      backgroundColor: "var(--background-primary)",
      color: "inherit",
    },
  }),
  popoutCopy,
  ViewPlugin.define(
    (view) => {
      const dispose = onEditorWindowMigrated(view, (win) =>
        follow(view, win.document),
      );
      return { destroy: dispose };
    },
    {
      eventHandlers: {
        focus(_event, view) {
          follow(view, view.dom.ownerDocument);
        },
      },
    },
  ),
];

function follow(view: EditorView, doc: Document) {
  if (view.root === doc) return;
  view.setRoot(doc);
  view.requestMeasure();
}

const tooltipPlacement = new Compartment();

export const popoverTooltips: Extension = ViewPlugin.fromClass(
  class {
    #parent: HTMLElement | null = null;
    #destroyed = false;
    readonly #released: () => void;
    readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;

      queueMicrotask(() => this.place());
      this.#released = onEditorWindowMigrated(view, () =>
        queueMicrotask(() => this.place()),
      );
    }
    update(update: ViewUpdate) {
      const { dom } = update.view;
      if (dom.isConnected && this.#parent?.ownerDocument !== dom.ownerDocument)
        queueMicrotask(() => this.place());
    }
    place() {
      const { dom } = this.view;
      if (this.#destroyed || !dom.isConnected) return;
      const parent =
        dom.closest<HTMLElement>(`.${PINNED_POPOVER_BODY}`) ??
        dom.ownerDocument.body;
      if (parent === this.#parent) return;
      this.#parent = parent;
      this.view.dispatch({
        effects: tooltipPlacement.reconfigure(tooltips({ parent })),
      });
    }
    destroy() {
      this.#destroyed = true;
      this.#released();
    }
  },
  { provide: () => tooltipPlacement.of([]) },
);

export const codePane: Extension = [
  hostedEditor,
  EditorView.editorAttributes.of({ class: CODE_PANE_CLASS }),
];
