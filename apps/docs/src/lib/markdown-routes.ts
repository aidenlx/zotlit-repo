import { changelogFeedRoute } from "./shared.ts";

export const markdownSections = ["docs", "changelog", "blog", "learn"] as const;

export type MarkdownSection = (typeof markdownSections)[number];

export interface MarkdownPage {
  section: MarkdownSection;
  slugs: string[];
}

const contentFile = "content.md";

const suffix = ".md";

export function isMarkdownSection(value: string): value is MarkdownSection {
  return (markdownSections as readonly string[]).includes(value);
}

export function suffixEditionUrl({ section, slugs }: MarkdownPage) {
  return `/${[section, ...slugs].join("/")}${suffix}`;
}

export function contentRouteUrl({ section, slugs }: MarkdownPage) {
  return `/llms.mdx/${[section, ...slugs, contentFile].join("/")}`;
}

export function parseContentRoute(splat: string): MarkdownPage | undefined {
  const segments = splat.split("/").filter(Boolean);
  if (segments.pop() !== contentFile) return undefined;

  const [section, ...slugs] = segments;
  if (section === undefined || !isMarkdownSection(section)) return undefined;

  return { section, slugs };
}

export function negotiatedContentRoute(pathname: string): string | undefined {
  if (pathname.endsWith(suffix) || pathname === changelogFeedRoute) {
    return undefined;
  }

  const [section, ...slugs] = pathname.split("/").filter(Boolean);
  if (section === undefined || !isMarkdownSection(section)) return undefined;

  return contentRouteUrl({ section, slugs });
}

export function rewriteMarkdownSuffix(url: URL) {
  const { pathname } = url;
  if (!pathname.endsWith(suffix)) return url;

  const page = pathname.slice(1, -suffix.length);
  const [section, ...slugs] = page.split("/");
  if (section === undefined || !isMarkdownSection(section)) return url;

  url.pathname = contentRouteUrl({ section, slugs });
  return url;
}

export function htmlPagePath(pathname: string): string {
  if (pathname.startsWith("/llms.mdx/")) {
    const page = parseContentRoute(pathname.slice("/llms.mdx/".length));
    if (page) return `/${[page.section, ...page.slugs].join("/")}`;
  }
  if (pathname.endsWith(suffix)) {
    const page = pathname.slice(0, -suffix.length);
    const section = page.split("/")[1];
    if (section && isMarkdownSection(section)) return page;
  }
  return pathname;
}
