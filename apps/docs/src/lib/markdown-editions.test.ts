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
