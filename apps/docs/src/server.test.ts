import { beforeEach, describe, expect, it, vi } from "vitest";

const { assetsFetch, ssrFetch, workerEnv } = vi.hoisted(() => {
  const assetsFetch = vi.fn();
  return {
    assetsFetch,
    ssrFetch: vi.fn(),
    workerEnv: {
      ASSETS: { fetch: assetsFetch },
      DOCS_LINE: "production",
      CF_VERSION_METADATA: {
        id: "v-1",
        tag: "site-3",
        timestamp: "2026-11-24T00:00:00Z",
      },
    },
  };
});

vi.mock("cloudflare:workers", () => ({ env: workerEnv }));
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: ssrFetch },
  createServerEntry: (entry: unknown) => entry,
}));

import server from "./server.ts";

beforeEach(() => {
  vi.clearAllMocks();
  workerEnv.DOCS_LINE = "production";
  assetsFetch.mockResolvedValue(new Response("Not found", { status: 404 }));
  ssrFetch.mockResolvedValue(new Response("Rendered before assets exist"));
});

describe("global machine endpoint locale aliases", () => {
  it.each(
    [
      "/llms.txt",
      "/llms-full.txt",
      "/sitemap.xml",
      "/robots.txt",
      "/changelog/rss.xml",
    ].flatMap((path) => [path, `${path}/`]),
  )(
    "renders unprefixed %s when prerender has not written its asset",
    async (path) => {
      const response = await server.fetch(
        new Request(`https://zotlit.aidenlx.site${path}`),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toBe("Rendered before assets exist");
      expect(assetsFetch).toHaveBeenCalledOnce();
      expect(ssrFetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["/zh-CN/llms.txt", "/llms.txt"],
    ["/zh-cn/llms-full.txt/", "/llms-full.txt"],
    ["/zh-CN/sitemap.xml/", "/sitemap.xml"],
    ["/zh-cn/robots.txt/", "/robots.txt"],
    ["/en/changelog/rss.xml/", "/changelog/rss.xml"],
  ])(
    "redirects the explicit locale alias %s with its query",
    async (path, target) => {
      const response = await server.fetch(
        new Request(`https://zotlit.aidenlx.site${path}?keep=1&lang=fr`),
      );

      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        `https://zotlit.aidenlx.site${target}?keep=1&lang=fr`,
      );
      expect(assetsFetch).not.toHaveBeenCalled();
      expect(ssrFetch).not.toHaveBeenCalled();
    },
  );
});

describe("Markdown answers", () => {
  const page = "/docs/reference/functions-and-methods";
  const canonical = `<https://zotlit.aidenlx.site${page}>; rel="canonical"`;

  beforeEach(() => {
    assetsFetch.mockImplementation((request: Request) => {
      const { pathname } = new URL(request.url);
      const markdown =
        pathname.endsWith(".md") || pathname.startsWith("/llms.mdx/");
      return Promise.resolve(
        new Response(markdown ? "# Functions and methods" : "<html></html>", {
          headers: {
            "content-type": markdown
              ? "text/markdown; charset=utf-8"
              : "text/html; charset=utf-8",
          },
        }),
      );
    });
  });

  async function fetchPage(path: string, accept: string) {
    return server.fetch(
      new Request(`https://zotlit.aidenlx.site${path}`, {
        headers: { accept },
      }),
    );
  }

  it.each([
    ["a `.md` edition", `${page}.md`, "*/*"],
    ["a negotiated page", page, "text/markdown"],
    ["a Chinese fallback's edition", `/zh-CN${page}.md`, "*/*"],
  ])(
    "keeps %s out of the index and names its HTML page canonical",
    async (_, path, accept) => {
      const response = await fetchPage(path, accept);
      expect(response.headers.get("content-type")).toMatch(/^text\/markdown/);
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(response.headers.get("link")).toBe(canonical);
    },
  );

  it.each([
    ["HTML", "text/html"],
    ["Markdown", "text/markdown"],
  ])("marks a page's %s answer as varying by Accept", async (_, accept) => {
    const response = await fetchPage(page, accept);
    expect(response.headers.get("vary")).toMatch(/\bAccept\b/);
  });

  it("leaves the HTML answer indexable with no canonical header", async () => {
    const response = await fetchPage(page, "text/html");
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("link")).toBeNull();
  });

  it.each(["/", `${page}.md`])(
    "adds no Vary to %s, whose answer ignores Accept",
    async (path) => {
      const response = await fetchPage(path, "text/markdown");
      expect(response.headers.get("vary")).toBeNull();
    },
  );
});

describe("beta line", () => {
  it.each(["/docs/how-to/insert-citations", "/zh-CN/learn"])(
    "keeps the Worker's answer for %s out of the index",
    async (path) => {
      workerEnv.DOCS_LINE = "beta";
      const response = await server.fetch(
        new Request(`https://zotlit-beta.aidenlx.site${path}`),
      );
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
    },
  );
});

describe("version document", () => {
  it("names the live site release without caching it", async () => {
    const response = await server.fetch(
      new Request("https://zotlit.aidenlx.site/version.json"),
    );
    expect(await response.json()).toEqual({
      tag: "site-3",
      versionId: "v-1",
      uploadedAt: "2026-11-24T00:00:00Z",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(assetsFetch).not.toHaveBeenCalled();
  });
});

describe("version URLs", () => {
  it("keeps a page served on a version URL out of the index", async () => {
    const response = await server.fetch(
      new Request(
        "https://site-3-zotlit-docs.aidenlx.workers.dev/docs/how-to/insert-citations",
      ),
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("lets the production host be indexed", async () => {
    const response = await server.fetch(
      new Request("https://zotlit.aidenlx.site/docs/how-to/insert-citations"),
    );
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });
});
