import { Window } from "happy-dom";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LandingPage } from "@/components/landing/landing-page.tsx";
import { paraglideMiddleware } from "@/paraglide/server.js";
import { Route as HomeRoute } from "@/routes/_home/index.tsx";

import type { SiteLocale } from "./i18n.ts";
import { docsPageTitle } from "./shared.ts";
import { blog, source } from "./source.ts";

const origin = "https://zotlit.aidenlx.site";

async function inLocale<T>(path: string, work: () => T | Promise<T>) {
  let result: T | undefined;
  await paraglideMiddleware(new Request(`${origin}${path}`), async () => {
    result = await work();
    return new Response();
  });
  return result as T;
}

function documentOf(node: ReactNode) {
  const { document } = new Window();
  document.body.innerHTML = renderToStaticMarkup(node);
  return document;
}

describe("search intent of titled pages", () => {
  it("titles the home page as the research desk", async () => {
    const head = await inLocale("/", () =>
      HomeRoute.options.head!({} as never),
    );
    expect(head?.meta).toContainEqual({
      title: "ZotLit: a Zotero research desk in Obsidian",
    });
  });

  it.each([
    ["/", "/docs/how-to/migrate-from-zotero-integration"],
    ["/zh-CN", "/zh-CN/docs/how-to/migrate-from-zotero-integration"],
  ])(
    "links the Zotero Integration migration guide from %s",
    async (path, href) => {
      const document = await inLocale(path, () =>
        documentOf(createElement(LandingPage, { footer: null })),
      );
      const link = document.querySelector(`a[href="${href}"]`);
      expect(link?.textContent).toMatch(/Zotero Integration/);
    },
  );

  it("titles the installer guide for the ZotLit load error", () => {
    const page = source.getPage(["how-to", "update-obsidian-installer"], "en");
    expect(page && docsPageTitle(page.data)).toBe(
      'Fix ZotLit "Failed to load plugin": update the installer',
    );
  });

  it.each<[SiteLocale, string, RegExp]>([
    [
      "en",
      "/blog/v2.2-release",
      /Obsidian 1\.15\.1\+ desktop with installer 1\.13\.4\+\. ZotLit 2\.2\.3 raised the Obsidian minimum from 1\.14\.5 to 1\.15\.1\./,
    ],
    [
      "zh-CN",
      "/zh-CN/blog/v2.2-release",
      /Obsidian 1\.15\.1\+ 桌面端（安装包 1\.13\.4\+）。ZotLit 2\.2\.3 将 Obsidian 最低版本从 1\.14\.5 提高到 1\.15\.1。/,
    ],
  ])(
    "states the Obsidian and installer minimums in the %s 2.2 post",
    async (locale, path, requirement) => {
      const page = blog.getPage(["v2.2-release"], locale)!;
      const { body: Body } = await page.data.load();
      const document = await inLocale(path, () =>
        documentOf(createElement(Body)),
      );
      expect(document.body.textContent).toMatch(requirement);
    },
  );
});
