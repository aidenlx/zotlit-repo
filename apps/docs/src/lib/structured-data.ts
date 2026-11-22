import type {
  Article,
  BlogPosting,
  BreadcrumbList,
  FAQPage,
  Organization,
  Person,
  SoftwareApplication,
  TechArticle,
  Thing,
  WebSite,
  WithContext,
} from "schema-dts";

import { getLocale } from "@/paraglide/runtime.js";

import { getPageLocaleState } from "./locale-state.ts";
import { appName, baseURL, gitConfig, repoUrl } from "./shared.ts";

const logoUrl = `${baseURL}/logo/zotlit-logo-512.png`;
const obsidianDirectoryUrl = "https://community.obsidian.md/plugins/zotlit";

export function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return path.startsWith("/") ? baseURL + path : `${baseURL}/${path}`;
}

const organization: Organization = {
  "@type": "Organization",
  name: appName,
  url: baseURL,
  logo: logoUrl,
  sameAs: [repoUrl, obsidianDirectoryUrl],
};

export const websiteSchema: WithContext<WebSite> = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: appName,
  url: baseURL,
};

export const organizationSchema: WithContext<Organization> = {
  "@context": "https://schema.org",
  ...organization,
};

export const softwareApplicationSchema: WithContext<SoftwareApplication> = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: appName,
  applicationCategory: "ReferenceApplication",
  operatingSystem: "Windows, macOS, Linux",
  offers: {
    "@type": "Offer",
    price: 0,
    priceCurrency: "USD",
  },
};

function personSchema(author: string): Person {
  return {
    "@type": "Person",
    name: author,
    ...(author === gitConfig.user && {
      url: `https://github.com/${author}`,
    }),
  };
}

export function blogPostingSchema(input: {
  title: string;
  description?: string;
  author: string;
  date: string;
  modified?: string;
  url: string;
  inLanguage: string;
  image?: string;
}): WithContext<BlogPosting> {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    ...(input.description !== undefined && {
      description: input.description,
    }),
    datePublished: input.date,
    ...(input.modified !== undefined && { dateModified: input.modified }),
    inLanguage: input.inLanguage,
    author: personSchema(input.author),
    publisher: organization,
    url: absoluteUrl(input.url),
    ...(input.image !== undefined && { image: absoluteUrl(input.image) }),
  };
}

export function changelogArticleSchema(input: {
  title?: string;
  version: string;
  date: string;
  url: string;
  inLanguage: string;
  image: string;
}): WithContext<Article> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title ?? `${appName} v${input.version}`,
    datePublished: input.date,
    inLanguage: input.inLanguage,
    author: organization,
    publisher: organization,
    url: absoluteUrl(input.url),
    image: absoluteUrl(input.image),
  };
}

function commitDates({
  published,
  modified,
}: {
  published?: string;
  modified?: string;
}) {
  return {
    ...(published !== undefined && { datePublished: published }),
    ...(modified !== undefined && { dateModified: modified }),
  };
}

export function docsArticleSchema(input: {
  title: string;
  description?: string;
  published?: string;
  modified?: string;
  url: string;
  image: string;
}): WithContext<TechArticle> {
  const localeState = getPageLocaleState(input.url, getLocale());
  const url = absoluteUrl(localeState.canonicalPath);
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: input.title,
    ...(input.description !== undefined && {
      description: input.description,
    }),
    ...commitDates(input),
    inLanguage: localeState.contentLocale,
    author: organization,
    publisher: organization,
    url,
    mainEntityOfPage: url,
    image: absoluteUrl(input.image),
  };
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export function faqPageSchema(input: {
  url: string;
  entries: FaqEntry[];
}): WithContext<FAQPage> {
  const localeState = getPageLocaleState(input.url, getLocale());
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: absoluteUrl(localeState.canonicalPath),
    inLanguage: localeState.contentLocale,
    mainEntity: input.entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export function lessonArticleSchema(input: {
  title: string;
  description: string;
  published?: string;
  modified?: string;
  url: string;
  image: string;
}): WithContext<Article> {
  const { contentLocale } = getPageLocaleState(input.url, getLocale());
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    ...commitDates(input),
    inLanguage: contentLocale,
    author: organization,
    publisher: organization,
    url: absoluteUrl(input.url),
    image: absoluteUrl(input.image),
  };
}

export interface Crumb {
  name: string;
  url: string;
}

export function breadcrumbListSchema(
  items: Crumb[],
): WithContext<BreadcrumbList> {
  const locale = getLocale();
  const seen = new Set<string>();
  const canonicalItems = items
    .map((crumb) => ({
      ...crumb,
      url: getPageLocaleState(crumb.url, locale).canonicalPath,
    }))
    .filter((crumb) => !seen.has(crumb.url) && seen.add(crumb.url));
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: canonicalItems.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.url),
    })),
  };
}

export function serializeJsonLd(schema: WithContext<Thing>): string {
  return JSON.stringify(schema).replaceAll("<", "\\u003c");
}
