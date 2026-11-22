import * as v from "valibot";

import {
  RELEASE_REPOSITORY,
  SOURCE_BRANCH,
  SOURCE_REPOSITORY,
} from "@zotlit/config/repositories";

import type { SiteLocale } from "./i18n.ts";

export const appName = "ZotLit";
export type DocsLine = "beta" | "production";
export const baseURL = "https://zotlit.aidenlx.site";
export const docsRoute = "/docs";
export const changelogRoute = "/changelog";
export const changelogFeedRoute = `${changelogRoute}/rss.xml`;
export const blogRoute = "/blog";
export const learnRoute = "/learn";

const [releaseOwner, releaseName] = RELEASE_REPOSITORY.split("/") as [
  string,
  string,
];

export const gitConfig = {
  user: releaseOwner,
  repo: releaseName,
  branch: "main",
};

export function docsPageTitle(data: { title: string; searchTitle?: string }) {
  return data.searchTitle ?? data.title;
}

export function markdownEditionHeaders(pagePath: string) {
  return {
    "X-Robots-Tag": "noindex",
    Link: `<${baseURL}${pagePath}>; rel="canonical"`,
  };
}

export const repoSlug = RELEASE_REPOSITORY;

export const repoUrl = `https://github.com/${repoSlug}`;

export const sourceRepoUrl = `https://github.com/${SOURCE_REPOSITORY}`;
export const sourceBlobUrl = `${sourceRepoUrl}/blob/${SOURCE_BRANCH}`;

export const zotlitLegacyUrl = "https://zotlit-v1.aidenlx.site";
export const zotlitBetaUrl = "https://zotlit-beta.aidenlx.site";

export const ogTypes = [
  "home",
  "community",
  "blog",
  "changelog",
  "docs",
  "learn",
] as const;
export type OgType = (typeof ogTypes)[number];

export function ogImageUrl(
  type: OgType,
  { slugs = [], locale = "en" }: { slugs?: string[]; locale?: SiteLocale } = {},
) {
  const edition = locale === "zh-CN" ? ["zh-CN"] : [];
  return `/og/${[...edition, type, ...slugs, "image.webp"].join("/")}`;
}

export const publishedOn = v.pipe(
  v.union([v.pipe(v.string(), v.isoDate()), v.date()]),
  v.transform((val) =>
    typeof val === "string" ? val : val.toISOString().slice(0, 10),
  ),
);

export function currentYear() {
  return new Date().getFullYear();
}

export function formatReleaseDate(
  isoDay: string,
  { locale = "en" }: { locale?: string } = {},
) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${isoDay}T00:00:00Z`));
}

export function formatReleaseInstant(
  iso: string,
  { locale = "en" }: { locale?: string } = {},
) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}
