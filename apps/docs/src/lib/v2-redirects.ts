import { i18n, localizedPath } from "./i18n.ts";
import { contentRouteUrl, suffixEditionUrl } from "./markdown-routes.ts";
import type { MarkdownPage, MarkdownSection } from "./markdown-routes.ts";
import type { RedirectRule } from "./v1-redirects.ts";

export const V2_MOVES: Record<string, string> = {
  "/docs/tutorial": "/learn",
  "/docs/tutorial/first-note": "/learn/connect-zotero-to-obsidian",
  "/docs/tutorial/write-and-export-cited-note":
    "/learn/cite-in-obsidian-with-zotero",
  "/docs/tutorial/pandoc-citation-workflow":
    "/docs/how-to/pandoc-citation-workflow",
  "/docs/tutorial/customize-template": "/docs/how-to/customize-template",
  "/docs/how-to": "/docs",
  "/docs/concepts": "/docs/reference",
  "/docs/concepts/how-zotlit-connects-to-zotero":
    "/docs/setup/what-zotlit-reads-and-writes",
  "/docs/concepts/literature-notes-and-the-managed-region":
    "/docs/reference/literature-notes",
  "/docs/concepts/how-citekey-links-work": "/docs/reference/citation-links",
  "/docs/concepts/excerpt-images": "/docs/reference/excerpt-images",
  "/docs/concepts/how-templates-work":
    "/docs/reference/templates/how-templates-work",
  "/docs/concepts/profiles": "/docs/reference/templates/how-templates-work",
  "/docs/concepts/javascript-templates":
    "/docs/reference/templates/how-templates-work",
  "/docs/concepts/how-zotlit-query-works": "/docs/reference/how-queries-work",
  "/docs/concepts/query-files-and-query-blocks":
    "/docs/reference/how-queries-work",
  "/docs/concepts/template-workbench-view":
    "/docs/reference/template-workbench-view",
  "/docs/concepts/template-workbench": "/docs/reference/template-workbench-cli",
};

const destinationSections: MarkdownSection[] = ["docs", "learn"];

function pageOf(path: string, sections: MarkdownSection[]): MarkdownPage {
  const [section, ...slugs] = path.split("/").filter(Boolean);
  const found = sections.find((candidate) => candidate === section);
  if (!found) throw new Error(`${path} is not a ${sections.join(" or ")} path`);
  return { section: found, slugs };
}

export function buildV2Redirects(moves = V2_MOVES): RedirectRule[] {
  return Object.entries(moves).flatMap(([from, to]) => {
    const [old, moved] = [
      pageOf(from, ["docs"]),
      pageOf(to, destinationSections),
    ];
    const pairs = [
      { source: from, destination: to },
      { source: suffixEditionUrl(old), destination: suffixEditionUrl(moved) },
      { source: contentRouteUrl(old), destination: contentRouteUrl(moved) },
    ];
    return i18n.languages.flatMap((locale) =>
      pairs.map(({ source, destination }): RedirectRule => ({
        source: localizedPath(source, locale),
        destination: localizedPath(destination, locale),
        status: 308,
      })),
    );
  });
}
