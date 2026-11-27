import type { Thing, WithContext } from "schema-dts";

import * as m from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

import type { SiteLocale } from "./i18n.ts";
import { getPageLocaleState } from "./locale-state.ts";
import type { OgType } from "./shared.ts";
import { appName, baseURL, ogImageUrl } from "./shared.ts";
import { absoluteUrl, serializeJsonLd } from "./structured-data.ts";

const OG_IMAGE_DIMENSIONS = { width: "1200", height: "630" } as const;

export const appDescription = m.docs_site_description;

export const HOME_OG_ALT = m.docs_og_home_alt;

export interface PageSeo {
  title?: string;
  fullTitle?: string;
  description?: string;
  path: string;
  card: { type: OgType; slugs?: string[]; alt: string };
  article?: {
    publishedTime: string;
    modifiedTime?: string;
    authors?: string[];
  };
  feeds?: Record<string, string>;
  schemas?: WithContext<Thing>[];
}

export function ogImageMeta(
  type: OgType,
  alt: string,
  { slugs, locale }: { slugs?: string[]; locale?: SiteLocale } = {},
) {
  const url = absoluteUrl(ogImageUrl(type, { slugs, locale }));
  return [
    { property: "og:image", content: url },
    { property: "og:image:width", content: OG_IMAGE_DIMENSIONS.width },
    { property: "og:image:height", content: OG_IMAGE_DIMENSIONS.height },
    { property: "og:image:type", content: "image/webp" },
    { property: "og:image:alt", content: alt },
    { name: "twitter:image", content: url },
  ];
}

function documentTitle({ title, fullTitle }: PageSeo) {
  if (fullTitle) return fullTitle;
  return title ? `${title} | ${appName}` : appName;
}

export function pageHead(seo: PageSeo) {
  const ogTitle = seo.fullTitle ?? seo.title ?? appName;
  const localeState = getPageLocaleState(seo.path, getLocale());
  const canonical = absoluteUrl(localeState.canonicalPath);

  return {
    meta: [
      {
        name: "robots",
        content: localeState.isFallback ? "noindex, follow" : "index, follow",
      },
      {
        property: "og:locale",
        content: localeState.contentLocale === "zh-CN" ? "zh_CN" : "en_US",
      },
      { title: documentTitle(seo) },
      ...(seo.description === undefined
        ? []
        : [
            { name: "description", content: seo.description },
            { property: "og:description", content: seo.description },
            { name: "twitter:description", content: seo.description },
          ]),
      { property: "og:url", content: canonical },
      { property: "og:title", content: ogTitle },
      { name: "twitter:title", content: ogTitle },
      ...(seo.article
        ? [
            { property: "og:type", content: "article" },
            {
              property: "article:published_time",
              content: seo.article.publishedTime,
            },
            ...(seo.article.modifiedTime === undefined
              ? []
              : [
                  {
                    property: "article:modified_time",
                    content: seo.article.modifiedTime,
                  },
                ]),
            ...(seo.article.authors ?? []).map((author) => ({
              property: "article:author",
              content: author,
            })),
          ]
        : [{ property: "og:type", content: "website" }]),
      ...ogImageMeta(seo.card.type, seo.card.alt, {
        slugs: seo.card.slugs,
        locale: localeState.contentLocale,
      }),
    ],
    links: [
      { rel: "canonical", href: canonical },
      ...localeState.alternates.map(({ locale, path }) => ({
        rel: "alternate",
        hrefLang: locale,
        href: absoluteUrl(path),
      })),
      ...Object.entries(seo.feeds ?? {}).map(([type, path]) => ({
        rel: "alternate",
        type,
        href: `${baseURL}${path}`,
      })),
    ],
    scripts: (seo.schemas ?? []).map((schema) => ({
      type: "application/ld+json",
      children: serializeJsonLd(schema),
    })),
  };
}
