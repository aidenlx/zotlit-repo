import { llms } from "fumadocs-core/source";
import { describe, expect, it } from "vitest";

import { getLlmsIndex, getMarkdownEdition } from "./markdown-editions.tsx";
import { docsPageTitle } from "./shared.ts";
import { source } from "./source.ts";

const retitled = source
  .getPages("en")
  .filter((page) => page.data.searchTitle !== undefined);

describe("docs page titles in the Markdown surface", () => {
  it("has pages whose search title differs from their sidebar label", () => {
    expect(retitled.length).toBeGreaterThan(0);
  });

  it("lists a page in llms.txt under its own title, and nothing else in the docs tree changes", () => {
    const expected = retitled
      .reduce(
        (index, page) =>
          index.replace(
            `[${page.data.title}](${page.url})`,
            `[${docsPageTitle(page.data)}](${page.url})`,
          ),
        llms(source).index("en"),
      )
      .trimEnd();
    expect(getLlmsIndex().slice(0, expected.length)).toBe(expected);
  });

  it.each([
    ["en", ""],
    ["zh-CN", "/zh-CN"],
  ] as const)(
    "names a lesson's Go further pages by their own titles, linked in %s",
    async (locale, prefix) => {
      const edition = await getMarkdownEdition(
        { section: "learn", slugs: ["cite-in-obsidian-with-zotero"] },
        { locale },
      );
      const further = edition?.split(/^## .+$/m).at(-1);
      const guide = source.getPage(["how-to", "insert-citations"], locale)!;
      expect(further).toContain(
        `- [${docsPageTitle(guide.data)}](${prefix}/docs/how-to/insert-citations.md): `,
      );
      expect(edition).toContain(
        `](${prefix}/learn/export-obsidian-to-word-with-citations.md): `,
      );
    },
  );

  it("heads a page's edition with its own title", async () => {
    const page = retitled[0]!;
    const edition = await getMarkdownEdition({
      section: "docs",
      slugs: page.slugs,
    });
    expect(edition?.split("\n")[0]).toBe(
      `# ${page.data.searchTitle} (${page.url})`,
    );
  });
});

const decisionLessons = [
  {
    slug: "annotate-zotero-pdfs-in-obsidian",
    shot: "annotate-pdfs-in-obsidian/step-4",
    guides: [
      "/docs/how-to/open-pdf-in-obsidian.md",
      "/docs/how-to/edit-pdf-annotations.md",
      "/docs/how-to/use-annotation-view.md",
    ],
    job: {
      en: "read and annotate a Zotero PDF in Obsidian",
      "zh-CN": "在 Obsidian 中阅读并标注 Zotero 的 PDF",
    },
  },
  {
    slug: "export-obsidian-to-word-with-citations",
    shot: "export-to-word-with-a-bibliography/step-2",
    guides: [
      "/docs/how-to/export-note-with-citations.md",
      "/docs/how-to/export-with-native-pandoc.md",
      "/docs/how-to/pandoc-citation-workflow.md",
    ],
    job: {
      en: "export a cited Obsidian draft to Word",
      "zh-CN": "把带引用的 Obsidian 草稿导出为 Word",
    },
  },
] as const;

describe("lesson decision openings", () => {
  it.each(
    decisionLessons.flatMap((lesson) =>
      (["en", "zh-CN"] as const).map((locale) => ({ ...lesson, locale })),
    ),
  )(
    "$slug states the research job before step 1 in $locale",
    async ({ slug, shot, guides, job, locale }) => {
      const edition = await getMarkdownEdition(
        { section: "learn", slugs: [slug] },
        { locale },
      );
      const stepAt = edition?.search(/^## (?:Step 1|第 1 )\b/m) ?? -1;
      const opening = edition?.slice(0, stepAt) ?? "";
      const prefix = locale === "zh-CN" ? "/zh-CN" : "";
      expect(stepAt).toBeGreaterThan(0);
      expect(opening).toContain(job[locale]);
      expect(opening).toContain(
        locale === "zh-CN"
          ? "研究者、学生或学者"
          : "researchers, students, or scholars",
      );
      expect(opening).toContain("Zotero 10");
      expect(opening).toContain(locale === "zh-CN" ? "标注" : "annotations");
      expect(opening).toContain(
        locale === "zh-CN" ? "保存文库和 PDF" : "keeps the library and the PDF",
      );
      expect(opening).toContain(
        locale === "zh-CN" ? "保存你的思考" : "keeps your thinking",
      );
      expect(opening).toContain(
        locale === "zh-CN" ? "引文样式" : "citation styles installed in Zotero",
      );
      expect(opening).toContain(
        locale === "zh-CN" ? "普通的 Markdown" : "ordinary Markdown",
      );
      expect(opening).toContain("1.15.1");
      expect(opening).toContain("1.13.4");
      expect(opening).toContain("2.2.4");
      expect(opening).toContain(locale === "zh-CN" ? "桌面端" : "desktop only");
      expect(opening).toContain("Markdown");
      expect(opening).toContain(`/img/learn/${shot}`);
      expect(opening).toContain(`](${prefix}/docs/install-zotlit.md)`);
      expect(opening).toContain(`](${prefix}/learn.md)`);
      expect(opening).toContain("](#1)");
      expect(opening).not.toContain("/changelog/2.2.4");
      for (const guide of guides) {
        expect(opening).toContain(`](${prefix}${guide})`);
      }
      expect(opening).not.toContain("2.3.0");
      expect(edition?.slice(stepAt)).toContain("## ");
    },
  );
});

describe("old anchors in the Markdown surface", () => {
  it("leaves them out, and the step they stood before reads on", async () => {
    const edition = await getMarkdownEdition({
      section: "docs",
      slugs: ["how-to", "insert-citations"],
    });
    expect(edition).not.toContain("<span");
    expect(edition).toContain("\n2. Keep typing words from the title");
    expect(edition).toContain("\n- **Nothing happens when I type `@` alone:**");
  });
});
