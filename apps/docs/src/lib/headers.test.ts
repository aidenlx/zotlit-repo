import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

import { buildHeaderRules, renderHeadersFile } from "./headers.ts";
import { chinesePrefix, unlocalizedPath } from "./i18n.ts";
import { prerenderPages } from "./prerender-pages.ts";

function matchesPath(
  pattern: string,
  path: string,
  minimumSplatLength: number,
) {
  const [prefix = "", suffix] = pattern.split("*");
  if (suffix === undefined) return pattern === path;
  return (
    path.startsWith(prefix) &&
    path.endsWith(suffix) &&
    path.length >= prefix.length + suffix.length + minimumSplatLength
  );
}

describe("prerendered Chinese assets", () => {
  const packageRoot = getPackageRoot(import.meta.filename);
  const config = resolve(packageRoot, "wrangler.jsonc");
  const pages = prerenderPages(packageRoot).map(({ path }) => path);

  it.each(["production", "beta"] as const)(
    "sets the content language on every Chinese asset on the %s line",
    (docsLine) => {
      const workerFirst = unstable_readConfig({
        config,
        env: docsLine === "beta" ? "beta" : undefined,
      }).assets?.run_worker_first;
      if (!Array.isArray(workerFirst)) {
        throw new Error("Expected the Worker's route patterns");
      }
      const workerPatterns = workerFirst.filter(
        (path) => !path.startsWith("!"),
      );
      const assetPatterns = workerFirst
        .filter((path) => path.startsWith("!"))
        .map((path) => path.slice(1));
      const chineseAssets = pages.filter(
        (path) =>
          unlocalizedPath(path) !== path &&
          (assetPatterns.some((pattern) => matchesPath(pattern, path, 0)) ||
            !workerPatterns.some((pattern) => matchesPath(pattern, path, 0))),
      );
      const languageRules = buildHeaderRules(pages, { docsLine }).filter(
        ({ headers }) => headers["Content-Language"] === "zh-CN",
      );

      expect(chineseAssets).toContain(chinesePrefix);
      expect(
        chineseAssets.filter(
          (path) =>
            !languageRules.some(({ source }) => matchesPath(source, path, 1)),
        ),
      ).toEqual([]);
    },
  );
});

describe("renderHeadersFile", () => {
  const file = renderHeadersFile();

  it("adds the giscus CORS header to the comment themes", () => {
    expect(file).toContain(
      "/giscus/*\n  Access-Control-Allow-Origin: https://giscus.app",
    );
  });

  it("types the changelog feed as RSS", () => {
    expect(file).toContain(
      "/changelog/rss.xml\n  Content-Type: application/rss+xml; charset=utf-8",
    );
  });

  it("caches the commit-pinned agent-skill archives forever", () => {
    expect(file).toContain(
      "/.well-known/agent-skills/*/archive.zip\n  Cache-Control: public, max-age=31536000, immutable",
    );
  });

  it("caches the hashed chunks forever and keeps them out of the search index", () => {
    expect(file).toContain(
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Robots-Tag: noindex",
    );
  });
});

describe("beta line", () => {
  const file = renderHeadersFile(buildHeaderRules([], { docsLine: "beta" }));

  it("keeps every file out of the search index", () => {
    expect(file.startsWith("/*\n  X-Robots-Tag: noindex\n")).toBe(true);
  });

  it("sends the noindex header once per file", () => {
    expect(file.match(/X-Robots-Tag/g)).toHaveLength(1);
    expect(file).toContain(
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
    );
  });

  it("leaves the production line indexable", () => {
    expect(renderHeadersFile()).not.toContain("/*\n  X-Robots-Tag");
  });
});

describe("Markdown edition rules", () => {
  const rules = buildHeaderRules([
    "/llms.mdx/docs/content.md",
    "/llms.mdx/docs/how-to/insert-citations/content.md",
    "/llms.mdx/blog/v2-release/content.md",
    "/zh-CN/llms.mdx/docs/reference/commands/content.md",
    "/docs.md",
    "/docs/how-to/insert-citations.md",
    "/docs/how-to/insert-citations",
  ]);
  const bySource = new Map(rules.map((rule) => [rule.source, rule.headers]));

  it.each([
    ["/llms.mdx/:p1/content.md", "https://zotlit.aidenlx.site/:p1"],
    [
      "/llms.mdx/:p1/:p2/:p3/content.md",
      "https://zotlit.aidenlx.site/:p1/:p2/:p3",
    ],
    ["/llms.mdx/:p1/:p2/content.md", "https://zotlit.aidenlx.site/:p1/:p2"],
    [
      "/zh-CN/llms.mdx/:p1/:p2/:p3/content.md",
      "https://zotlit.aidenlx.site/zh-CN/:p1/:p2/:p3",
    ],
    ["/docs.md", "https://zotlit.aidenlx.site/docs"],
  ])("keeps %s out of the index, canonical to %s", (source, page) => {
    expect(bySource.get(source)).toEqual({
      "X-Robots-Tag": "noindex",
      Link: `<${page}>; rel="canonical"`,
    });
  });

  it("keeps the canonical link on the beta line", () => {
    const beta = new Map(
      buildHeaderRules(["/docs.md"], { docsLine: "beta" }).map((rule) => [
        rule.source,
        rule.headers,
      ]),
    );
    expect(beta.get("/docs.md")).toEqual({
      Link: `<https://zotlit.aidenlx.site/docs>; rel="canonical"`,
    });
  });

  it("leaves the editions the Worker answers to the Worker", () => {
    expect(
      rules
        .filter((rule) => "Link" in rule.headers)
        .map((rule) => rule.source)
        .toSorted(),
    ).toEqual([
      "/docs.md",
      "/llms.mdx/:p1/:p2/:p3/content.md",
      "/llms.mdx/:p1/:p2/content.md",
      "/llms.mdx/:p1/content.md",
      "/zh-CN/llms.mdx/:p1/:p2/:p3/content.md",
    ]);
  });
});
