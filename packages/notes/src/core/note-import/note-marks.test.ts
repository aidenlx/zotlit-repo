// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

import {
  parseAnnotation,
  parseCitation,
  parseNoteSchema,
} from "./note-marks.ts";

function mark(tag: string, attr: string, payload: unknown): Element {
  const el = document.createElement(tag);
  el.setAttribute(attr, encodeURIComponent(JSON.stringify(payload)));
  return el;
}

function load(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const packageRoot = getPackageRoot(import.meta.filename);

const LOCAL_USER = "http://zotero.org/users/local/XmplLib8/items";

describe("parseCitation", () => {
  it("reads the data-citation payload off the element", () => {
    const el = mark("span", "data-citation", {
      citationItems: [{ uris: [`${LOCAL_USER}/XMPLITM3`], locator: "62" }],
      properties: {},
    });
    expect(parseCitation(el)?.citationItems[0]?.ref?.key).toBe("XMPLITM3");
  });

  it("returns null when the element has no data-citation", () => {
    expect(parseCitation(document.createElement("span"))).toBeNull();
  });
});

describe("parseAnnotation", () => {
  it("reads the data-annotation payload off the element", () => {
    const el = mark("span", "data-annotation", {
      attachmentURI: `${LOCAL_USER}/XMPLATC4`,
      annotationKey: "XMPLANN6",
      color: "#e56eee",
    });
    const info = parseAnnotation(el);
    expect(info?.annotationKey).toBe("XMPLANN6");
    expect(info?.attachment?.key).toBe("XMPLATC4");
    expect(info?.imageAttachmentKey).toBeUndefined();
  });

  it("captures the embedded-image key on an image excerpt", () => {
    const img = mark("img", "data-annotation", {
      attachmentURI: `${LOCAL_USER}/XMPLATC4`,
      annotationKey: "XMPLANN7",
    });
    img.setAttribute("data-attachment-key", "XMPLATC3");
    expect(parseAnnotation(img)?.imageAttachmentKey).toBe("XMPLATC3");
  });

  it("returns null when the element has no data-annotation", () => {
    expect(parseAnnotation(document.createElement("span"))).toBeNull();
  });
});

describe("parseNoteSchema", () => {
  it("finds the schema container through the zotero-note znv1 wrapper", () => {
    const root = load(
      '<div class="zotero-note znv1"><div data-schema-version="9"><p>x</p></div></div>',
    );
    const schema = parseNoteSchema(root);
    expect(schema.supported).toBe(true);
    expect(schema).toMatchObject({ version: 9 });
    if (!schema.supported) throw new Error("schema is unsupported");
    expect(schema.container.innerHTML).toBe("<p>x</p>");
  });

  it("accepts the unwrapped container returned by the API", () => {
    const root = load('<div data-schema-version="10"><p>x</p></div>');
    expect(parseNoteSchema(root)).toMatchObject({
      supported: true,
      version: 10,
    });
  });

  it("rejects a pre-v6 note but reports its version", () => {
    const root = load('<div data-schema-version="5"><p>x</p></div>');
    expect(parseNoteSchema(root)).toEqual({ supported: false, version: 5 });
  });

  it("reports a missing schema marker", () => {
    expect(parseNoteSchema(load("<p>plain note</p>"))).toEqual({
      supported: false,
      version: null,
      fallbackReason: "missing-schema-marker",
    });
  });

  it.each([
    ["6invalid", 6],
    ["6e0", 6],
    ["06", 6],
  ])("reads marker %s as version %i, as Zotero does", (marker, version) => {
    expect(
      parseNoteSchema(
        load(`<div data-schema-version="${marker}"><p>x</p></div>`),
      ),
    ).toMatchObject({
      supported: true,
      version,
    });
  });

  it("reports a marker with no leading integer as malformed", () => {
    expect(
      parseNoteSchema(load('<div data-schema-version="v6"><p>x</p></div>')),
    ).toEqual({
      supported: false,
      version: null,
      fallbackReason: "malformed-schema-marker",
    });
  });
});

describe("zt-excerpt-note.html fixture", () => {
  const html = readFileSync(
    join(
      packageRoot,
      "src/__fixtures__/note-import/turndown/zt-excerpt-note.html",
    ),
    "utf8",
  );

  it("gates the real schema-version=10 note as supported", () => {
    expect(parseNoteSchema(load(html))).toMatchObject({
      supported: true,
      version: 10,
    });
  });

  it("parses every annotation mark (highlight, underline, image) to its keys", () => {
    const annots = [...load(html).querySelectorAll("[data-annotation]")].map(
      parseAnnotation,
    );
    expect(annots.map((a) => a?.annotationKey)).toEqual([
      "XMPLANN9",
      "XMPLANNC",
      "XMPLANNA",
      "XMPLANN7",
      "XMPLANN5",
      "XMPLANND",
      "XMPLANNB",
    ]);
    expect(annots.every((a) => a?.attachment?.key === "XMPLATC4")).toBe(true);
    expect(annots.every((a) => a?.citationItem?.ref?.key === "XMPLITM3")).toBe(
      true,
    );
    expect(annots.map((a) => a?.imageAttachmentKey)).toEqual([
      undefined,
      undefined,
      undefined,
      "XMPLATC2",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("parses every citation span to its cited item key + locator", () => {
    const cites = [...load(html).querySelectorAll("span.citation")].map(
      parseCitation,
    );
    expect(cites.length).toBeGreaterThan(0);
    expect(
      cites.every(
        (c) =>
          c?.citationItems[0]?.ref?.key === "XMPLITM3" &&
          c?.citationItems[0]?.locator === "62",
      ),
    ).toBe(true);
  });
});
