import { renderToMarkdown } from "fumadocs-core/server";
import { llms } from "fumadocs-core/source";
import type { ComponentType, ElementType } from "react";

import { ActionLink } from "@/components/action-link.tsx";
import { Callout } from "@/components/callout.tsx";
import { Command } from "@/components/command.tsx";
import { ContractTable } from "@/components/contract-table.tsx";
import { lessonMarkdownComponents } from "@/components/learn/lesson-mdx.tsx";
import { LessonLink } from "@/components/lesson-link.tsx";
import { SettingsPath } from "@/components/settings-path.tsx";
import { UiLabel } from "@/components/ui-label.tsx";
import * as m from "@/paraglide/messages.js";

import type { SiteLocale } from "./i18n.ts";
import { localizeMarkdownLinks } from "./markdown-locale-links.ts";
import type { MarkdownPage } from "./markdown-routes.ts";
import { docsPageTitle } from "./shared.ts";
import {
  blog,
  changelog,
  getBlogPages,
  getChangelogPages,
  getLessonPages,
  learn,
  lessonFurther,
  source,
} from "./source.ts";

export const markdownHeaders = {
  "content-type": "text/markdown; charset=utf-8",
};

export const plainTextHeaders = {
  "content-type": "text/plain; charset=utf-8",
};

const mdxComponents: Record<string, ElementType> = {
  ActionLink,
  Callout,
  Command,
  ContractTable,
  LessonLink,
  SettingsPath,
  UiLabel,
};

type MarkdownBody = ComponentType<{
  components: Record<string, ElementType>;
}>;

interface EditionPage {
  url: string;
  data: { load: () => Promise<{ _exports: Record<string, unknown> }> };
}

const anchorSpan = /<span id="[^"]+"(?: data-accordion-value="[^"]+")? \/>\s*/g;

async function renderBody(
  page: EditionPage,
  locale: SiteLocale,
  components: Record<string, ElementType> = mdxComponents,
) {
  const { _exports } = await page.data.load();
  const Body = _exports._markdown as MarkdownBody | undefined;
  if (!Body) {
    throw new Error(`${page.url} carries no Markdown edition`);
  }

  return localizeMarkdownLinks(
    (await renderToMarkdown(<Body components={components} />)).replaceAll(
      anchorSpan,
      "",
    ),
    locale,
  );
}

async function renderLessonPage(
  page: (typeof learn)["$inferPage"],
  locale: SiteLocale,
) {
  const { data } = page;
  const pages = getLessonPages({ locale });
  const next = pages[pages.findIndex((entry) => entry.url === page.url) + 1];
  const needs = data.needs
    .map(({ item, detail }) => `- **${item}:** ${detail}`)
    .join("\n");
  const body = await renderBody(page, locale, {
    ...mdxComponents,
    ...lessonMarkdownComponents(data),
  });
  const nextLine = next
    ? `[${m.docs_learn_next_lesson({ number: next.data.lesson, title: next.data.title }, { locale })}](${next.url}.md)`
    : `[${m.docs_learn_how_to_guides({}, { locale })}](/docs/how-to.md)`;
  const further = lessonFurther(data.further, locale)
    .map(({ title, href, when }) => `- [${title}](${href}.md): ${when}`)
    .join("\n");

  return localizeMarkdownLinks(
    `# ${data.title} (${page.url})

${[data.lede, data.note].filter(Boolean).join("\n\n")}

${m.docs_learn_lesson_meta({ number: data.lesson, total: pages.length, minutes: data.minutes, steps: data.steps.length }, { locale })}

## ${m.docs_learn_you_need({}, { locale })}

${needs}

${body}

## ${m.docs_learn_md_end({}, { locale })}

**${data.end.title}** ${data.end.caption}

${nextLine}: ${data.end.next}

## ${m.docs_learn_go_further({}, { locale })}

${further}
`,
    locale,
  );
}

async function renderPage(
  heading: string,
  page: EditionPage,
  locale: SiteLocale,
) {
  return `# ${heading} (${page.url})

${await renderBody(page, locale)}`;
}

function renderDocsPage(
  page: (typeof source)["$inferPage"],
  locale: SiteLocale,
) {
  return renderPage(docsPageTitle(page.data), page, locale);
}

function renderIndex<
  Page extends { url: string; data: { description?: string } },
>(heading: string, pages: Page[], label: (page: Page) => string) {
  const items = pages
    .map((page) => {
      const description = page.data.description
        ? `: ${page.data.description}`
        : "";
      return `- [${label(page)}](${page.url}.md)${description}`;
    })
    .join("\n");

  return `# ${heading}

${items}
`;
}

export async function getMarkdownEdition(
  { section, slugs }: MarkdownPage,
  { locale = "en" }: { locale?: SiteLocale } = {},
): Promise<string | undefined> {
  switch (section) {
    case "docs": {
      const page = source.getPage(slugs, locale);
      return page && renderDocsPage(page, locale);
    }
    case "changelog": {
      if (slugs.length === 0) {
        return renderIndex(
          m.docs_nav_changelog({}, { locale }),
          getChangelogPages({ locale }),
          (page) => `v${page.data.version}`,
        );
      }
      const page = changelog.getPage(slugs, locale);
      return (
        page &&
        renderPage(
          page.data.title ?? `ZotLit v${page.data.version}`,
          page,
          locale,
        )
      );
    }
    case "blog": {
      if (slugs.length === 0) {
        return renderIndex(
          m.docs_nav_blog({}, { locale }),
          getBlogPages({ locale }),
          (page) => page.data.title,
        );
      }
      const page = blog.getPage(slugs, locale);
      return page && renderPage(page.data.title, page, locale);
    }
    case "learn": {
      if (slugs.length === 0) {
        return renderIndex(
          m.docs_learn_title({}, { locale }),
          getLessonPages({ locale }),
          (page) =>
            `${m.docs_learn_lesson_number({ number: page.data.lesson }, { locale })}: ${page.data.title}`,
        );
      }
      const page = learn.getPage(slugs, locale);
      return page && renderLessonPage(page, locale);
    }
  }
}

export function getLlmsIndex() {
  const lessons = renderIndex(
    m.docs_learn_title({}, { locale: "en" }),
    getLessonPages(),
    (page) => page.data.title,
  ).replace(/^# /, "## ");
  const docsIndex = llms(source, {
    renderName(node, { lang }) {
      if ("type" in node && node.type === "page") {
        const page = source.getNodePage(node, lang);
        if (page) return docsPageTitle(page.data);
      } else if (!("type" in node) || node.type !== "separator") {
        const meta = source.getNodeMeta(node, lang);
        if (meta?.data.title) return meta.data.title;
      }
      return typeof node.name === "string" ? node.name : "";
    },
  }).index("en");
  return `${docsIndex.trimEnd()}

${lessons}`;
}

export async function getLlmsFullText() {
  const editions = await Promise.all([
    ...source.getPages("en").map((page) => renderDocsPage(page, "en")),
    ...getLessonPages().map((page) => renderLessonPage(page, "en")),
  ]);

  return editions.join("\n\n");
}
