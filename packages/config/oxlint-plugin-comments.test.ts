import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { noTrackerReference } from "./oxlint-plugin-comments.ts";

RuleTester.describe = (name, fn) => {
  void describe(name, fn);
};
RuleTester.it = (name, fn) => {
  void it(name, fn);
};
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
tester.run("no-tracker-reference", noTrackerReference, {
  valid: [
    "// A draft stays in memory until Zotero accepts the write.",
    "// Zotero bug: https://github.com/zotero/zotero/issues/1234",
    "// Draws the border in #333333 and the fill in #000.",
    "// A tag of digits only, such as `#1984`, is not a tag in Obsidian.",
    "// Step #1 reads the heading anchor (note.md#12-results).",
    'const locator = "[@doe2020]#12"; const tag = "#2024";',
    'it("parses a heading link", () => { parse("[[note#12]]"); });',
    'expect(render("#1502")).toBe("#1502");',
  ],
  invalid: [
    {
      code: "// Regression for #1314.",
      errors: [{ messageId: "comment", data: { reference: "#1314" } }],
    },
    {
      code: "/** See https://github.com/aidenlx/zotlit/issues/1157. */",
      errors: [{ messageId: "comment" }],
    },
    {
      code: "// aidenlx/zotlit#880 moved this.",
      errors: [{ messageId: "comment" }],
    },
    {
      code: "// https://github.com/aidenlx/zotlit-repo/pull/12",
      errors: [{ messageId: "comment" }],
    },
    {
      code: "// Fixed in PR 1502 and issue #1503.",
      errors: [{ messageId: "comment" }],
    },
    {
      code: 'it("keeps the draft (#1314)", () => {});',
      errors: [{ messageId: "name", data: { reference: "#1314" } }],
    },
    {
      code: "describe.each(rows)(`issue 1695: %s`, () => {});",
      errors: [{ messageId: "name" }],
    },
  ],
});
