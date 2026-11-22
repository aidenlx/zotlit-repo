import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";
import { isMarkdownPreferred } from "fumadocs-core/negotiation";

import { localizedPath } from "./lib/i18n.ts";
import type { SiteLocale } from "./lib/i18n.ts";
import { getPageLocaleState } from "./lib/locale-state.ts";
import { negotiatedContentRoute } from "./lib/markdown-routes.ts";
import { markdownEditionHeaders } from "./lib/shared.ts";
import { buildV1Redirects } from "./lib/v1-redirects.ts";
import { deLocalizeUrl } from "./paraglide/runtime.js";
import { paraglideMiddleware } from "./paraglide/server.js";

function negotiate(request: Request, locale: SiteLocale): Request {
  if (!isMarkdownPreferred(request)) return request;

  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const contentRoute = negotiatedContentRoute(deLocalizeUrl(url).pathname);
  if (contentRoute) url.pathname = localizedPath(contentRoute, locale);
  else headers.set("accept", "text/html");

  return new Request(url, { method: request.method, headers });
}

function isMarkdown(headers: Headers): boolean {
  return headers.get("content-type")?.startsWith("text/markdown") ?? false;
}

async function servedAsset(request: Request) {
  const response = await env.ASSETS.fetch(
    new Request(request, { redirect: "manual" }),
  );
  return response.status === 404 ? undefined : response;
}

const globalMachinePaths = new Set([
  "/llms.txt",
  "/llms-full.txt",
  "/sitemap.xml",
  "/robots.txt",
  "/changelog/rss.xml",
]);

const legacyPaths = new Set(buildV1Redirects().map((rule) => rule.source));

export default createServerEntry({
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const unprefixedPath = deLocalizeUrl(url).pathname;
    const machinePath = unprefixedPath.replace(/\/+$/, "");
    if (
      pathname.replace(/\/+$/, "") !== machinePath &&
      globalMachinePaths.has(machinePath)
    ) {
      url.pathname = machinePath;
      return Response.redirect(url, 308);
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      legacyPaths.has(pathname)
    ) {
      const legacy = await servedAsset(request);
      if (legacy) return legacy;
    }
    return paraglideMiddleware(request, async ({ locale }) => {
      if (request.method !== "GET" && request.method !== "HEAD")
        return handler.fetch(request);
      const forwarded = negotiate(request, locale);
      const response =
        (await servedAsset(forwarded)) ?? (await handler.fetch(forwarded));
      const state = getPageLocaleState(pathname, locale);
      const headers = new Headers(response.headers);
      headers.set("content-language", state.contentLocale);
      if (state.isFallback) headers.set("x-robots-tag", "noindex, follow");
      if (negotiatedContentRoute(unprefixedPath))
        headers.append("vary", "Accept");
      if (response.ok && isMarkdown(headers)) {
        for (const [name, value] of Object.entries(
          markdownEditionHeaders(state.canonicalPath),
        ))
          headers.set(name, value);
      }
      if (env.DOCS_LINE === "beta") headers.set("x-robots-tag", "noindex");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  },
});
