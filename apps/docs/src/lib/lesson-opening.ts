import { stepMedia } from "@/components/learn/step-picture.tsx";
import * as m from "@/paraglide/messages.js";

import type { SiteLocale } from "./i18n.ts";
import { docsPageTitle, learnRoute } from "./shared.ts";
import { lessonFurther, source } from "./source.ts";

const installPath = "/docs/install-zotlit";

export interface LessonOpeningCopy {
  heading: string;
  job: string;
  audience: string;
  difference: string[];
  limits: string;
  next: string;
  shot: number;
}

export interface LessonOpeningLink {
  title: string;
  href: string;
}

export interface LessonOpeningView {
  heading: string;
  job: string;
  audience: string;
  difference: string[];
  limits: string;
  next: string;
  shot: number;
  imageAlt: string;
  links: LessonOpeningLink[];
}

export function lessonOpeningImage(media: string, shot: number) {
  const src = stepMedia(media, shot)?.still.src;
  if (!src) {
    throw new Error(
      `The opening picture for ${media} step ${shot} is missing.`,
    );
  }
  return src;
}

export function lessonOpeningLinks(
  further: readonly { slug: string; when: string }[],
  locale: SiteLocale,
): LessonOpeningLink[] {
  const install = source.getPage(["install-zotlit"], locale);
  if (!install) throw new Error("The install page is missing.");
  return [
    { title: docsPageTitle(install.data), href: installPath },
    {
      title: m.docs_learn_start_step({ number: 1, begun: "no" }, { locale }),
      href: "#1",
    },
    ...lessonFurther(further, locale).map(({ title, href }) => ({
      title,
      href,
    })),
    { title: m.docs_learn_title({}, { locale }), href: learnRoute },
  ];
}

export function lessonOpeningView(
  data: {
    opening?: LessonOpeningCopy;
    media: string;
    steps: { alt: string }[];
    further: readonly { slug: string; when: string }[];
  },
  locale: SiteLocale,
): LessonOpeningView | undefined {
  const opening = data.opening;
  if (!opening) return undefined;
  const step = data.steps[opening.shot - 1];
  if (!step) {
    throw new Error(
      `The opening picture is step ${opening.shot}, and this lesson has ${data.steps.length} steps.`,
    );
  }
  return {
    heading: opening.heading,
    job: opening.job,
    audience: opening.audience,
    difference: opening.difference,
    limits: opening.limits,
    next: opening.next,
    shot: opening.shot,
    imageAlt: step.alt,
    links: lessonOpeningLinks(data.further, locale),
  };
}

export function markdownHref(href: string) {
  return href.startsWith("#") ? href : `${href}.md`;
}

export function lessonOpeningMarkdown(view: LessonOpeningView, media: string) {
  const difference = view.difference.map((line) => `- ${line}`).join("\n");
  const links = view.links
    .map((link) => `- [${link.title}](${markdownHref(link.href)})`)
    .join("\n");
  return `## ${view.heading}

${view.job}

${view.audience}

${difference}

${view.limits}

![${view.imageAlt}](${lessonOpeningImage(media, view.shot)})

${view.next}

${links}
`;
}
