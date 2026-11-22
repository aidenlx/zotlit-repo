import { asMarkdown, md } from "fumadocs-core/server";
import defaultMdxComponents from "fumadocs-ui/mdx";

import { lessons } from "@/lib/collections.ts";
import * as m from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

const ProseLink = defaultMdxComponents.a;

export function LessonLink({ slug }: { slug: string }) {
  const lesson =
    (getLocale() === "zh-CN" && lessons.get(`${slug}.zh-CN.mdx`)) ||
    lessons.get(`${slug}.mdx`);
  if (!lesson) throw new Error(`<LessonLink> names no lesson: ${slug}`);
  const href = `/learn/${slug}`;
  const length = m.docs_learn_link_minutes({ minutes: lesson.minutes });

  if (asMarkdown()) return md`[${lesson.title}](${href}) ${length}`;

  return (
    <>
      <ProseLink href={href}>{lesson.title}</ProseLink> {length}
    </>
  );
}
