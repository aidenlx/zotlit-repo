import { scanContent } from "./content-scan.ts";
import { chineseCatalogPages, localizedPath } from "./i18n.ts";
import type { MarkdownSection } from "./markdown-routes.ts";
import {
  contentRouteUrl,
  markdownSections,
  suffixEditionUrl,
} from "./markdown-routes.ts";

interface PrerenderPage {
  path: string;
}

const landingSections: MarkdownSection[] = ["changelog", "blog"];

const seoPages: PrerenderPage[] = [
  { path: "/sitemap.xml" },
  { path: "/robots.txt" },
  { path: "/changelog/rss.xml" },
];

function machineRoutePages(
  content: Record<MarkdownSection, { slugs: string[] }[]>,
  { landings }: { landings: boolean },
): PrerenderPage[] {
  const pages: PrerenderPage[] = [];

  for (const section of markdownSections) {
    const slugSets = content[section].map((entry) => entry.slugs);
    if (landings && landingSections.includes(section)) slugSets.push([]);

    for (const slugs of slugSets) {
      const page = { section, slugs };
      pages.push({ path: suffixEditionUrl(page) });
      pages.push({ path: contentRouteUrl(page) });
    }
  }

  return pages;
}

function htmlPages(
  content: Record<MarkdownSection, { slugs: string[] }[]>,
  { landings }: { landings: boolean },
): PrerenderPage[] {
  const docs = content.docs.map((entry) => ({
    path: `/${["docs", ...entry.slugs].join("/")}`,
  }));
  const blog = content.blog.map((entry) => ({
    path: `/${["blog", ...entry.slugs].join("/")}`,
  }));
  const changelog = content.changelog.map((entry) => ({
    path: `/${["changelog", ...entry.slugs].join("/")}`,
  }));
  const learn = content.learn.map((entry) => ({
    path: `/${["learn", ...entry.slugs].join("/")}`,
  }));

  return [
    ...(landings
      ? [
          { path: "/" },
          { path: "/community" },
          { path: "/privacy" },
          { path: "/terms" },
        ]
      : []),
    ...docs,
    ...blog,
    ...changelog,
    ...learn,
    ...(landings ? [{ path: "/blog" }, { path: "/changelog" }] : []),
  ];
}

function chineseCatalogPagesWithEditions(): PrerenderPage[] {
  return chineseCatalogPages.flatMap((path) => {
    const section = path.slice(1);
    const listing =
      section === "learn" || section === "changelog" || section === "blog";
    return [
      { path },
      ...(listing
        ? [
            { path: suffixEditionUrl({ section, slugs: [] }) },
            { path: contentRouteUrl({ section, slugs: [] }) },
          ]
        : []),
    ];
  });
}

export function prerenderPages(packageRoot: string): PrerenderPage[] {
  const content = scanContent(packageRoot);

  const chinese = scanContent(packageRoot, { locale: "zh-CN" });
  return [
    ...seoPages,
    { path: "/llms.txt" },
    { path: "/llms-full.txt" },
    ...machineRoutePages(content, { landings: true }),
    ...htmlPages(content, { landings: true }),
    { path: "/learn" },
    { path: suffixEditionUrl({ section: "learn", slugs: [] }) },
    { path: contentRouteUrl({ section: "learn", slugs: [] }) },
    ...[
      ...machineRoutePages(chinese, { landings: false }),
      ...htmlPages(chinese, { landings: false }),
      ...chineseCatalogPagesWithEditions(),
    ].map(({ path }) => ({ path: localizedPath(path, "zh-CN") })),
  ];
}
