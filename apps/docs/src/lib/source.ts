import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { rcompare } from "semver";

import { blogs, changelogs, docs, lessons } from "./collections.ts";
import { i18n } from "./i18n.ts";
import type { SiteLocale } from "./i18n.ts";
import { docsPageTitle } from "./shared.ts";

export const source = loader({
  i18n,
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export const changelog = loader({
  i18n,
  baseUrl: "/changelog",
  source: changelogs.toFumadocsSource(),
});

function byNewestDay(a: { date: string }, b: { date: string }) {
  return b.date.localeCompare(a.date);
}

export function getChangelogPages({
  locale = "en",
}: { locale?: SiteLocale } = {}) {
  return changelog.getPages(locale).toSorted((a, b) => {
    const dayCompare = byNewestDay(a.data, b.data);
    if (dayCompare !== 0) return dayCompare;
    return rcompare(a.data.version, b.data.version);
  });
}

export const blog = loader({
  i18n,
  baseUrl: "/blog",
  source: blogs.toFumadocsSource(),
});

export function getBlogPages({ locale = "en" }: { locale?: SiteLocale } = {}) {
  return blog.getPages(locale).toSorted((a, b) => {
    const dayCompare = byNewestDay(a.data, b.data);
    if (dayCompare !== 0) return dayCompare;
    return a.data.title.localeCompare(b.data.title);
  });
}

export const learn = loader({
  i18n,
  baseUrl: "/learn",
  source: lessons.toFumadocsSource(),
});

export function getLessonPages({
  locale = "en",
}: { locale?: SiteLocale } = {}) {
  return learn
    .getPages(locale)
    .toSorted((a, b) => a.data.lesson - b.data.lesson);
}

export function lessonFurther(
  further: readonly { slug: string; when: string }[],
  locale: SiteLocale,
) {
  return further.map(({ slug, when }) => {
    const page = source.getPage(slug.split("/"), locale);
    if (!page) throw new Error(`"Go further" names no docs page: ${slug}`);
    return { title: docsPageTitle(page.data), href: `/docs/${slug}`, when };
  });
}
