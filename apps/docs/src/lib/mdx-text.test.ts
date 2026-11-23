import { describe, expect, it } from "vitest";

import { plainMdxText } from "./mdx-text.ts";

describe("plainMdxText", () => {
  it.each([
    [
      "double-backtick code with internal backticks and braces",
      "``a `{b}` c``",
    ],
    [
      "double-backtick code that opens with braces before a literal backtick",
      "``{a}`b``",
    ],
    ["single-backtick code with braces", "`x {y}`"],
    ["plain prose", "Text with no MDX opener."],
  ])("preserves %s", (_name, text) => {
    expect(plainMdxText(text, "Description")).toBe(text);
  });

  it.each([
    ["escaped backtick delimiters", "\\`{a}\\`", "{"],
    ["unmatched backtick runs", "``{a}`", "{"],
    ["opening braces in prose", "{a}", "{"],
    ["less-than signs in prose", "a < b", "<"],
    ["closing braces in prose", "}", "}"],
    ["autolinks", "<https://example.com>", "<"],
    ["HTML", "<span>text</span>", "<"],
    ["escaped braces in prose", "\\{a\\}", "{"],
    ["fenced code blocks", "```md\n{a}\n```", "{"],
    ["indented code blocks", "    `{a}`", "{"],
  ])("rejects MDX openers in %s", (_name, text, opener) => {
    expect(() => plainMdxText(text, "Description")).toThrow(
      `Description carries the MDX opener ${opener} outside a code span`,
    );
  });
});
