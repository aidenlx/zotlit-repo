import { describe, expect, it } from "vitest";

import { checkGuide, countGuide } from "./agent-guide-size.ts";

const words = (count: number) =>
  Array.from({ length: count }, (_, index) => `w${index}`).join(" ");
const lines = (count: number) =>
  Array.from({ length: count }, () => "a").join("\n");
const message = (result: ReturnType<typeof checkGuide>) =>
  result.ok ? "" : result.message;

describe("countGuide", () => {
  it("counts lines and words outside the generated blocks", () => {
    const text = [
      "# Guide",
      "one two three",
      "<!-- BEGIN:turborepo-agent-rules -->",
      "many words that a tool writes",
      "<!-- END:turborepo-agent-rules -->",
      "<!-- intent-skills:start -->",
      "more tool words",
      "<!-- intent-skills:end -->",
      "four",
      "",
    ].join("\n");
    expect(countGuide(text)).toEqual({ lines: 3, words: 6 });
  });

  it("closes a generated block only with its own end marker", () => {
    expect(() =>
      countGuide(
        [
          "<!-- intent-skills:start -->",
          "tool words",
          "hand-written words",
          "<!-- BEGIN:turborepo-agent-rules -->",
          "tool words",
          "<!-- END:turborepo-agent-rules -->",
        ].join("\n"),
      ),
    ).toThrow("line 1: <!-- intent-skills:start --> has no end marker");
  });

  it("closes a block only at an end marker with the exact name, with any space around it", () => {
    expect(
      countGuide(
        [
          "<!-- intent-skills:start -->",
          "tool words",
          "<!--   intent-skills:end   -->",
          "one",
        ].join("\n"),
      ),
    ).toEqual({ lines: 1, words: 1 });
    expect(() =>
      countGuide(
        [
          "<!-- intent-skills:start -->",
          "tool words",
          "<!-- intent- skills:end -->",
          "one",
        ].join("\n"),
      ),
    ).toThrow("line 1: <!-- intent-skills:start --> has no end marker");
  });

  it("refuses a generated block without its end marker", () => {
    expect(() =>
      countGuide(
        ["# Guide", "<!-- intent-skills:start -->", "words", "more"].join("\n"),
      ),
    ).toThrow("line 2: <!-- intent-skills:start --> has no end marker");
  });
});

describe("checkGuide", () => {
  const pkg = "packages/zotero-reads/AGENTS.md";

  it.each([
    [pkg, 1200, true],
    [pkg, 1201, false],
    ["AGENTS.md", 2400, true],
    ["AGENTS.md", 2401, false],
  ])("%s with %i words passes: %s", (path, count, ok) => {
    expect(checkGuide(path, words(count), undefined).ok).toBe(ok);
  });

  it.each([
    [pkg, 100, true],
    [pkg, 101, false],
    ["AGENTS.md", 200, true],
    ["AGENTS.md", 201, false],
  ])("%s with %i lines passes: %s", (path, count, ok) => {
    expect(checkGuide(path, lines(count), undefined).ok).toBe(ok);
  });

  it("passes the 511-word package guide and fails the same guide at 3,232 words", () => {
    expect(checkGuide(pkg, words(511), undefined)).toEqual({ ok: true });
    const text = message(checkGuide(pkg, words(3232), undefined));
    expect(text).toContain(pkg);
    expect(text).toContain("3,232 words");
    expect(text).toContain("1,200 words");
    expect(text).toContain("agents-md");
  });

  it("names the line count of a guide over the line limit", () => {
    expect(message(checkGuide(pkg, lines(101), undefined))).toContain(
      "101 lines",
    );
  });

  const path = "packages/item-query/AGENTS.md";
  const baseline = { lines: 1, words: 2000 };

  it("passes a baselined guide at its count and fails it when it grows", () => {
    expect(checkGuide(path, words(2000), baseline)).toEqual({ ok: true });
    expect(message(checkGuide(path, words(2001), baseline))).toContain(
      "2,001 words, above its baseline of 2,000",
    );
  });

  it("passes a baselined guide below its baseline with a note of the count to set", () => {
    expect(checkGuide(path, words(1900), baseline)).toEqual({
      ok: true,
      note: expect.stringContaining(
        "lower its baseline to { lines: 1, words: 1900 }",
      ),
    });
  });

  it("passes a baselined guide that is now under the limit with a note to remove it", () => {
    expect(checkGuide(path, words(1200), baseline)).toEqual({
      ok: true,
      note: expect.stringContaining("remove it from GUIDE_BASELINE"),
    });
  });
});
