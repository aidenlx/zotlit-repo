import type { FileRouteTypes } from "@/routeTree.gen.ts";

import type { SiteLocale } from "./i18n.ts";
import { getPageLocaleState } from "./locale-state.ts";
import { baseURL } from "./shared.ts";
import { blog, changelog, getLessonPages, learn, source } from "./source.ts";

const machineRoutes = [
  "/api/search",
  "/api/repo-stats",
  "/api/release-snapshot",
  "/llms.txt",
  "/llms-full.txt",
  "/llms.mdx/$",
  "/og/$",
  "/robots.txt",
  "/sitemap.xml",
  "/changelog/rss.xml",
] as const satisfies readonly FileRouteTypes["to"][];

type PageRoute = Exclude<FileRouteTypes["to"], (typeof machineRoutes)[number]>;

interface Entry {
  pathname?: string;
  lastModified?: Partial<Record<SiteLocale, string>>;
}

export const xmlHeaders = {
  "content-type": "application/xml; charset=utf-8",
};

function renderUrl(loc: string, lastModified?: string): string {
  const lastmod = lastModified ? `<lastmod>${lastModified}</lastmod>` : "";
  return `<url><loc>${loc.replaceAll("&", "&amp;")}</loc>${lastmod}</url>`;
}

async function lastCommitDay(page: {
  data: { load(): Promise<{ lastModified?: Date }> };
}): Promise<string | undefined> {
  const { lastModified } = await page.data.load();
  return lastModified?.toISOString().slice(0, 10);
}

export function nativeChinese<P extends { path: string; slugs: string[] }>(
  collection: { getPage(slugs: string[], locale: SiteLocale): P | undefined },
  page: P,
): P | undefined {
  const chinese = collection.getPage(page.slugs, "zh-CN");
  return chinese && chinese.path !== page.path ? chinese : undefined;
}

async function docsEntries(): Promise<Entry[]> {
  const pages = source.getPages("en").filter((page) => page.slugs.length > 0);
  return Promise.all(
    pages.map(async (page) => {
      const chinese = nativeChinese(source, page);
      return {
        pathname: page.url,
        lastModified: {
          en: await lastCommitDay(page),
          "zh-CN": chinese && (await lastCommitDay(chinese)),
        },
      };
    }),
  );
}

async function blogEntries(): Promise<Entry[]> {
  return Promise.all(
    blog.getPages("en").map(async (page) => {
      const chinese = nativeChinese(blog, page);
      return {
        pathname: page.url,
        lastModified: {
          en: (await lastCommitDay(page)) ?? page.data.date,
          "zh-CN":
            chinese && ((await lastCommitDay(chinese)) ?? chinese.data.date),
        },
      };
    }),
  );
}

export async function renderSitemap(): Promise<string> {
  const routes: Record<PageRoute, Entry[]> = {
    "/": [{ pathname: "" }],
    "/blog": [{}],
    "/changelog": [{}],
    "/community": [{}],
    "/privacy": [{}],
    "/terms": [{}],
    "/docs": [{}],
    "/blog/$slug": await blogEntries(),
    "/changelog/$version": changelog.getPages("en").map((page) => ({
      pathname: page.url,
      lastModified: { en: page.data.date, "zh-CN": page.data.date },
    })),
    "/docs/$": await docsEntries(),
    "/learn": [{}],
    "/learn/$lesson": await Promise.all(
      getLessonPages().map(async (page) => {
        const chinese = nativeChinese(learn, page);
        return {
          pathname: page.url,
          lastModified: {
            en: await lastCommitDay(page),
            "zh-CN": chinese && (await lastCommitDay(chinese)),
          },
        };
      }),
    ),
  };

  const urls = Object.entries(routes).flatMap(([route, entries]) =>
    entries.flatMap(({ pathname, lastModified }) => {
      const path = pathname || route;
      const state = getPageLocaleState(path, "en");
      return state.alternates.flatMap(({ locale, path: href }) =>
        locale === "x-default"
          ? []
          : [
              renderUrl(
                `${baseURL}${href === "/" ? "" : href}`,
                lastModified?.[locale],
              ),
            ],
      );
    }),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}
