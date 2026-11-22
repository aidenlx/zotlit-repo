import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { rcompare } from "semver";
import { describe, expect, it } from "vitest";

import { cjkGlyph, textWidth } from "./cjk.ts";
import { docsPageTitle } from "./shared.ts";
import {
  getBlogPages,
  getChangelogPages,
  getLessonPages,
  source,
} from "./source.ts";

describe("docs collection", () => {
  it("loads every page but the `_` partials", () => {
    const pages = source.getPages();
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.map((page) => page.url)).not.toContainEqual(
      expect.stringContaining("/_"),
    );
  });

  it("titles each page and lesson once, within search-result limits", () => {
    const pages = [
      ...source.getPages("en").map((page) => ({
        url: page.url,
        title: docsPageTitle(page.data),
        description: page.data.description ?? "",
      })),
      ...getLessonPages().map((page) => ({
        url: page.url,
        title: page.data.title,
        description: page.data.description,
      })),
    ];
    expect(pages.filter(({ title }) => title.length > 60)).toEqual([]);
    expect(pages.filter(({ description }) => description.length > 160)).toEqual(
      [],
    );
    const titles = pages.map(({ title }) => title.toLowerCase());
    expect(titles.filter((title, i) => titles.indexOf(title) !== i)).toEqual(
      [],
    );
  });

  it("titles each Chinese edition once, within search-result width", () => {
    const pages = [
      ...source.getPages("zh-CN").map((page) => ({
        url: page.url,
        title: docsPageTitle(page.data),
        description: page.data.description ?? "",
      })),
      ...getLessonPages({ locale: "zh-CN" }).map((page) => ({
        url: page.url,
        title: page.data.title,
        description: page.data.description,
      })),
    ].filter(({ title }) => cjkGlyph.test(title));
    expect(pages.filter(({ title }) => textWidth(title) > 60)).toEqual([]);
    expect(
      pages.filter(({ description }) => textWidth(description) > 160),
    ).toEqual([]);
    const titles = pages.map(({ title }) => title);
    expect(titles.filter((title, i) => titles.indexOf(title) !== i)).toEqual(
      [],
    );
  });

  it("publishes a `faq` list that matches the page's Questions section", () => {
    const pages = source.getPages().filter((page) => page.data.faq);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const body = readFileSync(join(docsDirectory, page.path), "utf8");
      expect({ page: page.path, faq: questionsSection(body) }).toEqual({
        page: page.path,
        faq: page.data.faq,
      });
    }
  });
});

const docsDirectory = resolve(import.meta.dirname, "../../content/docs");

function plainText(markdown: string): string {
  return markdown
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("**", "")
    .replaceAll("`", "")
    .split(/\s+/)
    .join(" ")
    .trim();
}

function questionsSection(body: string) {
  const [, section = ""] = body.split(
    /^## (?:Questions\b.*|.*\[#questions\]\s*)$/m,
  );
  const [questions = ""] = section.split(/^## /m);
  return questions
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [heading = "", ...rest] = block.split("\n");
      const [answer = ""] = rest
        .join("\n")
        .trim()
        .split(/\n\s*\n/);
      const question = heading.replace(/\s*\[#[^\]]+\]\s*$/, "").trim();
      return { question, answer: plainText(answer) };
    });
}

describe("changelog collection", () => {
  it("loads every entry newest-first", () => {
    const entries = getChangelogPages().map((page) => page.data);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual(
      [...entries].sort(
        (a, b) =>
          b.date.localeCompare(a.date) || rcompare(a.version, b.version),
      ),
    );
  });
});

describe("blog collection", () => {
  it("loads every post newest-first", () => {
    const dates = getBlogPages().map((page) => page.data.date);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
