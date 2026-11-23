import "#__fixtures__/dom-parser.ts";
import { describe, expect, it } from "vitest";

import { isStandaloneCslStyle, styleFileOf } from "./csl-style.ts";

describe("styleFileOf", () => {
  it.each([
    {
      name: "a double-quoted href with an apostrophe",
      href: `"https://example.org/styles/author's-style"`,
      parentId: "https://example.org/styles/author's-style",
    },
    {
      name: "a single-quoted href with a double quote",
      href: `'https://example.org/styles/author"s-style'`,
      parentId: 'https://example.org/styles/author"s-style',
    },
    {
      name: "an href without either quote in the value",
      href: '"https://example.org/styles/author-style"',
      parentId: "https://example.org/styles/author-style",
    },
  ])("reads the whole parent ID from $name", ({ href, parentId }) => {
    const xml = `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      <info>
        <title>Dependent Style</title>
        <id>https://example.org/styles/dependent</id>
        <link href=${href} rel="independent-parent"/>
      </info>
    </style>`;

    expect(styleFileOf("dependent.csl", xml)?.parentId).toBe(parentId);
  });
});

describe("isStandaloneCslStyle", () => {
  const citation =
    '<citation><layout><text variable="title"/></layout></citation>';

  it("rejects a bibliography without a layout even if the citation has one", () => {
    const xml = `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      ${citation}
      <bibliography><sort><key variable="author"/></sort></bibliography>
    </style>`;

    expect(isStandaloneCslStyle(xml)).toBe(false);
  });

  it("accepts a citation and a bibliography that each have a layout", () => {
    const xml = `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      ${citation}
      <bibliography><layout><text variable="title"/></layout></bibliography>
    </style>`;

    expect(isStandaloneCslStyle(xml)).toBe(true);
  });

  it("rejects a style with no rendering elements", () => {
    const xml =
      '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"/>';

    expect(isStandaloneCslStyle(xml)).toBe(false);
  });
});
