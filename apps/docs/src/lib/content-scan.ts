import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { getSlugs } from "fumadocs-core/source";
import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { SiteLocale } from "./i18n.ts";
import type { MarkdownSection } from "./markdown-routes.ts";

export interface ContentEntry {
  slugs: string[];
  frontmatter: unknown;
}

export const chineseFile = /\.zh-CN(?=\.mdx?$)/;

const sections: Record<MarkdownSection, { dir: string; files: string }> = {
  docs: { dir: "content/docs", files: "**/[!_]*.mdx" },
  changelog: { dir: "content/changelog", files: "**/*.{mdx,md}" },
  blog: { dir: "content/blog", files: "**/*.{mdx,md}" },
  learn: { dir: "content/learn", files: "*.mdx" },
};

export function scanContent(
  packageRoot: string,
  { locale = "en" }: { locale?: SiteLocale } = {},
): Record<MarkdownSection, ContentEntry[]> {
  return Object.fromEntries(
    Object.entries(sections).map(([section, { dir, files }]) => {
      const cwd = resolve(packageRoot, dir);
      const entries = globSync(files, { cwd })
        .filter((file) => chineseFile.test(file) === (locale === "zh-CN"))
        .map((file): ContentEntry => ({
          slugs: getSlugs(file.replace(chineseFile, "")),
          frontmatter: frontmatter(readFileSync(join(cwd, file), "utf8")).data,
        }));
      return [section, entries];
    }),
  ) as Record<MarkdownSection, ContentEntry[]>;
}

export function scanChinesePages(packageRoot: string): string[] {
  return Object.entries(scanContent(packageRoot, { locale: "zh-CN" })).flatMap(
    ([section, pages]) =>
      pages.map(({ slugs }) => `/${[section, ...slugs].join("/")}`),
  );
}
