// @vitest-environment happy-dom

import type { TextField } from "#obsidian/annotation-repository/service.ts";
import { expect, it, vi } from "vitest";

import {
  editorApp,
  pressSubmit,
} from "@zotlit/obsidian-kit/__fixtures__/editor-app.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { textFieldWording } from "./card-controls.ts";
import type {
  EditorSheetProps,
  EditorSheetStatus,
  EditorSurface,
} from "./editor-sheet.ts";
import { renderEditorSheet } from "./editor-sheet.ts";

import { TEXT_FIELDS } from "#obsidian/annotation-repository/write.ts";

const AUTOMATIC: EditorSheetStatus = {
  hint: null,
  manual: false,
  readOnly: false,
  saveDisabled: false,
};

function sheet(
  props: Partial<Omit<EditorSheetProps, "app">> = {},
  status: EditorSheetStatus = AUTOMATIC,
) {
  const app = editorApp();
  const el = document.body.appendChild(document.createElement("div"));
  const built = renderEditorSheet(
    el,
    {
      app,
      surface: "popup",
      field: textFieldWording("comment"),
      value: "",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      ...props,
    },
    status,
  );
  return {
    app,
    el,
    sheet: built,
    [Symbol.dispose]() {
      built[Symbol.dispose]();
      el.remove();
    },
  };
}

it("submits on Mod+Enter through the scope it holds while focused, and lets it go", () => {
  const onSubmit = vi.fn();
  const mounted = sheet({ onSubmit });

  pressSubmit(mounted.app);
  expect(onSubmit).toHaveBeenCalledOnce();

  mounted[Symbol.dispose]();
  expect(mounted.app.scopes).toEqual([]);
});

function button(el: HTMLElement, label: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`No button reads ${label}`);
  return found;
}

it.each(TEXT_FIELDS)(
  "offers no button while the save is automatic and quiet, for the %s",
  (field: TextField) => {
    using mounted = sheet({ field: textFieldWording(field), onSave: vi.fn() });

    const shown = [...mounted.el.querySelectorAll("button")].filter(
      (b) => b.style.display !== "none",
    );
    expect(shown).toEqual([]);
  },
);

it("hands a commit click to the commit alone, under the label it is given", () => {
  const run = vi.fn();
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  using mounted = sheet({
    commit: { label: m.pdf_toolbar_highlight(), run },
    onSubmit,
    onCancel,
  });

  const commit = button(mounted.el, m.pdf_toolbar_highlight());
  commit.click();

  expect(commit.classList.contains("mod-cta")).toBe(true);
  expect(run).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});

it("names the Quoted Text in its placeholder, its accessible name and its Save button", () => {
  using mounted = sheet(
    { field: textFieldWording("text"), onSave: vi.fn() },
    { ...AUTOMATIC, manual: true },
  );
  const { contentDOM, dom } = mounted.sheet.editor.view;

  expect(
    contentDOM.ownerDocument.getElementById(
      contentDOM.getAttribute("aria-labelledby") ?? "",
    )?.textContent,
  ).toBe(m.annot_view_card_text_label());
  expect(contentDOM.hasAttribute("aria-label")).toBe(false);
  expect(dom.querySelector(".cm-placeholder")?.textContent).toBe(
    m.annot_view_card_text_placeholder(),
  );
  expect(button(mounted.el, m.annot_view_text_save())).toBeDefined();
});

it("steps back on Escape", () => {
  const onCancel = vi.fn();
  using mounted = sheet({ onCancel });

  mounted.sheet.editor.view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  expect(onCancel).toHaveBeenCalledOnce();
});

it("saves on leaving only while the save is automatic and the editor writes", () => {
  const onLeave = vi.fn();
  using mounted = sheet(
    { surface: "card", onLeave },
    {
      ...AUTOMATIC,
      manual: true,
    },
  );
  const leave = () =>
    mounted.sheet.editor.view.contentDOM.dispatchEvent(new FocusEvent("blur"));

  leave();
  mounted.sheet.update({ ...AUTOMATIC, readOnly: true, saveDisabled: true });
  leave();
  mounted.sheet.update(AUTOMATIC);
  leave();

  expect(onLeave).toHaveBeenCalledOnce();
});

it("opens the sheet on the comment already typed", () => {
  using mounted = sheet({ value: "kept across a redraw" });

  expect(mounted.sheet.text()).toBe("kept across a redraw");
});

it.each([
  ["popup", true],
  ["card", false],
] satisfies [EditorSurface, boolean][])(
  "promises the comment sheet's theme hook by its literal name on the %s",
  (surface, hooked) => {
    using mounted = sheet({ surface });

    expect(mounted.el.classList.contains("zt-pdf-comment-sheet")).toBe(hooked);
  },
);
