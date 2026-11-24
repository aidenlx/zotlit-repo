import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { m } from "@/paraglide/messages.js";

import { docsPageTitle } from "./shared.ts";
import { source } from "./source.ts";

const contentDirectory = resolve(import.meta.dirname, "../../content");

describe("search intent of titled pages", () => {
  it("titles the home page as the research desk, so comparison searches reach the comparison and migration pages", () => {
    expect(m.docs_home_document_title({}, { locale: "en" })).toBe(
      "ZotLit: a Zotero research desk in Obsidian",
    );
  });

  it("titles the installer guide for the load error that brings readers to it", () => {
    const page = source.getPage(["how-to", "update-obsidian-installer"], "en");
    expect(page && docsPageTitle(page.data)).toContain(
      '"Failed to load plugin"',
    );
  });

  it.each(["v2.2-release.mdx", "v2.2-release.zh-CN.mdx"])(
    "states the current Obsidian and installer minimums in %s",
    (file) => {
      const body = readFileSync(
        resolve(contentDirectory, "blog", file),
        "utf8",
      );
      expect(body).toContain("1.15.1+");
      expect(body).toContain("1.13.4+");
      expect(body).not.toContain("1.14.5");
    },
  );
});
