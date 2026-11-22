import { afterEach, expect, test, vi } from "vitest";

const language = vi.hoisted(() => ({ current: "en" }));
vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<typeof import("obsidian")>()),
  getLanguage: () => language.current,
}));

const { DOCS_SITE_URL } = await import("@zotlit/plugin-kernel/constants.ts");
const { docsUrl } = await import("./docs-url.ts");

afterEach(() => {
  language.current = "en";
});

test("docs links open the edition in Obsidian's language", () => {
  expect(docsUrl("/docs/how-to/fix-stale-data")).toBe(
    `${DOCS_SITE_URL}/docs/how-to/fix-stale-data`,
  );
  language.current = "zh";
  expect(docsUrl("/docs/how-to/fix-stale-data")).toBe(
    `${DOCS_SITE_URL}/zh-CN/docs/how-to/fix-stale-data`,
  );
  expect(docsUrl("")).toBe(`${DOCS_SITE_URL}/zh-CN`);
  language.current = "fr";
  expect(docsUrl("/learn")).toBe(`${DOCS_SITE_URL}/learn`);
});
