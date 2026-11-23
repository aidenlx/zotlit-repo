// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { editorApp } from "@zotlit/obsidian-kit/__fixtures__/editor-app.ts";

import { freeTextLines } from "./free-text-layout.ts";
import type { PdfRect } from "./geometry-edit.ts";
import {
  createTextDraftArea,
  placeTextDraft,
  removeTextDraftArea,
} from "./text-draft.ts";

import { dispatchKey, viewport } from "#__fixtures__/pdf-annotation-editor.ts";

const MONO = {
  family: "monospace",
  measure: (text: string, fontSize: number) => (text.length * fontSize) / 2,
};

afterEach(() => {
  document.body.empty();
});

function draftPage() {
  const page = document.body.createDiv({ cls: "page" });
  const textLayer = page.createDiv({ cls: "textLayer" });
  textLayer.tabIndex = 0;
  const area = page.createEl("textarea");
  return { page, textLayer, area };
}

function placedDraft(box: PdfRect, view = viewport()) {
  const { area, page } = draftPage();
  placeTextDraft(
    area,
    { div: page, viewport: view },
    {
      font: MONO,
      draft: {
        kind: "text-draft",
        pageIndex: 0,
        fontSize: 10,
        color: "#ffd400",
        rotation: 0,
        box,
        text: "aa b",
        phase: "typing",
      },
    },
  );
  return (name: string) =>
    Number.parseFloat(area.style.getPropertyValue(`--zt-text-draft-${name}`));
}

it("wraps the draft at the same box width as the saved text", () => {
  const box: PdfRect = [100, 698, 119.5, 710];
  const css = placedDraft(box);
  const width = box[2] - box[0];
  const sizing = { fontSize: 10, measure: MONO.measure };
  expect({
    width: css("width"),
    lines: freeTextLines("aa b", css("width"), sizing),
  }).toEqual({
    width,
    lines: freeTextLines("aa b", width, sizing),
  });
});

it("leaves the focus where the finish moved it", () => {
  const { area } = draftPage();
  const elsewhere = document.body.createEl("input");
  elsewhere.focus();

  removeTextDraftArea(area);

  expect(area.isConnected).toBe(false);
  expect(document.activeElement).toBe(elsewhere);
});

it("moves the focus it held to the page's text layer, so the next key reaches the reader", () => {
  const { textLayer, area } = draftPage();
  area.focus();

  removeTextDraftArea(area);

  expect(area.isConnected).toBe(false);
  expect(document.activeElement).toBe(textLayer);
});

it("finishes on Escape through a Scope of its own while it holds focus, and gives the Scope back", () => {
  const app = editorApp();
  const finish = vi.fn();
  const area = document.body.appendChild(
    createTextDraftArea(document, { input: vi.fn(), finish }, app),
  );
  expect(app.scopes).toEqual([]);

  area.focus();
  expect(app.scopes).toHaveLength(1);
  const escape = dispatchKey(app.scopes[0]!, { key: "Escape" }, area);
  expect(escape.defaultPrevented).toBe(true);
  expect(finish).toHaveBeenCalledOnce();

  dispatchKey(app.scopes[0]!, { key: "Escape", isComposing: true }, area);
  expect(finish).toHaveBeenCalledOnce();

  area.blur();
  expect(app.scopes).toEqual([]);
});

it("gives the Scope back when the draft goes while it holds focus", () => {
  const app = editorApp();
  const page = document.body.createDiv({ cls: "page" });
  const area = page.appendChild(
    createTextDraftArea(document, { input: vi.fn(), finish: vi.fn() }, app),
  );
  area.focus();
  expect(app.scopes).toHaveLength(1);

  removeTextDraftArea(area);

  expect(app.scopes).toEqual([]);
});
