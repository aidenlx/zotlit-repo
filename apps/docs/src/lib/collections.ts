import { defineCollections, defineDocs } from "fumadocs-mdx/macro";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    lastModified: true,
    files: ["**/[^_]*.mdx"],
    schema: (await import("#content-config")).docsSchema,
    postprocess: {
      includeProcessedMarkdown: (await import("#content-config"))
        .markdownEdition,
    },
  },
  meta: {
    schema: (await import("#content-config")).metaSchema,
  },
});

export const changelogs = defineCollections({
  type: "doc",
  dir: "content/changelog",
  async: true,
  schema: (await import("#content-config")).changelogSchema,
  postprocess: {
    includeProcessedMarkdown: (await import("#content-config")).markdownEdition,
  },
});

export const lessons = defineCollections({
  type: "doc",
  dir: "content/learn",
  async: true,
  lastModified: true,
  schema: (await import("#content-config")).learnSchema,
  postprocess: {
    includeProcessedMarkdown: (await import("#content-config")).markdownEdition,
  },
});

export const blogs = defineCollections({
  type: "doc",
  dir: "content/blog",
  async: true,
  lastModified: true,
  schema: (await import("#content-config")).blogSchema,
  postprocess: {
    includeProcessedMarkdown: (await import("#content-config")).markdownEdition,
  },
});
