import type { LLMsOptions } from "fumadocs-core/mdx-plugins";
import { valid as isValidSemVer } from "semver";
import * as v from "valibot";

import { publishedOn } from "./src/lib/shared.ts";

export const metaSchema = v.object({
  title: v.optional(v.string()),
  pages: v.optional(v.array(v.string())),
  pagesIndex: v.optional(v.string()),
  description: v.optional(v.string()),
  root: v.optional(v.boolean()),
  defaultOpen: v.optional(v.boolean()),
  collapsible: v.optional(v.boolean()),
  icon: v.optional(v.string()),
});

const pageSchema = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  full: v.optional(v.boolean()),
  _openapi: v.optional(v.record(v.string(), v.unknown())),
});

const semverSchema = v.pipe(
  v.string(),
  v.check((val) => isValidSemVer(val) !== null, "Invalid semver version"),
);

export const markdownEdition: LLMsOptions = { output: "function" };

const faqEntrySchema = v.object({
  question: v.string(),
  answer: v.string(),
});

export const docsSchema = v.object({
  ...pageSchema.entries,
  searchTitle: v.optional(v.string()),
  faq: v.optional(v.array(faqEntrySchema)),
});

export const changelogSchema = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  version: semverSchema,
  companion: v.optional(semverSchema),
  date: publishedOn,
});

export const learnSchema = v.object({
  title: v.pipe(v.string(), v.maxLength(60)),
  description: v.pipe(v.string(), v.maxLength(160)),
  lesson: v.pipe(v.number(), v.integer(), v.minValue(1)),
  minutes: v.pipe(v.number(), v.integer(), v.minValue(1)),
  media: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
  chore: v.string(),
  instead: v.string(),
  lede: v.string(),
  note: v.optional(v.string()),
  needs: v.pipe(
    v.array(v.object({ item: v.string(), detail: v.string() })),
    v.minLength(1),
  ),
  steps: v.pipe(
    v.array(
      v.object({
        title: v.string(),
        alt: v.string(),
      }),
    ),
    v.minLength(1),
  ),
  end: v.object({
    title: v.string(),
    caption: v.string(),
    next: v.string(),
  }),
  further: v.pipe(
    v.array(
      v.object({
        slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/)),
        when: v.string(),
      }),
    ),
    v.minLength(2),
    v.maxLength(5),
  ),
});

export const blogSchema = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  author: v.optional(v.string(), "aidenlx"),
  date: publishedOn,
});
