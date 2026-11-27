import { regex } from "arkregex";

import { chinesePrefix, unlocalizedPath } from "./i18n.ts";
import { htmlPagePath } from "./markdown-routes.ts";
import type { DocsLine } from "./shared.ts";
import { markdownEditionHeaders } from "./shared.ts";

export interface HeaderRule {
  source: string;
  headers: Record<string, string>;
}

const contentRoute = regex("^/llms\\.mdx/(?<page>.+)/content\\.md$");

function markdownEditionRules(pages: readonly string[]): HeaderRule[] {
  const canonicalBySource = new Map<string, string>();
  for (const path of pages) {
    const bare = unlocalizedPath(path);
    const prefix = bare === path ? "" : chinesePrefix;
    const route = contentRoute.exec(bare)?.groups.page;
    if (route !== undefined) {
      const segments = route
        .split("/")
        .map((_, index) => `:p${index + 1}`)
        .join("/");
      canonicalBySource.set(
        `${prefix}/llms.mdx/${segments}/content.md`,
        `${prefix}/${segments}`,
      );
    } else if (/^\/[^/]+\.md$/.test(bare)) {
      canonicalBySource.set(path, `${prefix}${htmlPagePath(bare)}`);
    }
  }
  return [...canonicalBySource].map(([source, page]) => ({
    source,
    headers: markdownEditionHeaders(page),
  }));
}

function betaLineRules(rules: HeaderRule[]): HeaderRule[] {
  return [
    { source: "/*", headers: { "X-Robots-Tag": "noindex" } },
    ...rules
      .map(({ source, headers }) => ({
        source,
        headers: Object.fromEntries(
          Object.entries(headers).filter(([name]) => name !== "X-Robots-Tag"),
        ),
      }))
      .filter(({ headers }) => Object.keys(headers).length > 0),
  ];
}

export function buildHeaderRules(
  pages: readonly string[] = [],
  { docsLine = "production" }: { docsLine?: DocsLine } = {},
): HeaderRule[] {
  const rules = siteRules(pages);
  return docsLine === "beta" ? betaLineRules(rules) : rules;
}

function siteRules(pages: readonly string[]): HeaderRule[] {
  return [
    { source: "/zh-CN", headers: { "Content-Language": "zh-CN" } },
    { source: "/zh-CN/*", headers: { "Content-Language": "zh-CN" } },
    {
      source: "/giscus/*",
      headers: { "Access-Control-Allow-Origin": "https://giscus.app" },
    },
    {
      source: "/changelog/rss.xml",
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
    },
    {
      source: "/.well-known/agent-skills/*/archive.zip",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
    {
      source: "/assets/*",
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Robots-Tag": "noindex",
      },
    },
    ...markdownEditionRules(pages),
  ];
}

export function renderHeadersFile(rules = buildHeaderRules()): string {
  const blocks = rules.map(({ source, headers }) =>
    [
      source,
      ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`),
    ].join("\n"),
  );
  return `${blocks.join("\n\n")}\n`;
}
