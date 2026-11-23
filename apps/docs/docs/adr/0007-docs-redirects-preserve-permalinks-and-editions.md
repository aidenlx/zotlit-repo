# Docs redirects preserve permalinks and editions

## Context

The docs site must keep old links usable across site versions and locales. The build publishes redirects and response metadata with the assets so stable rules can apply without rendering pages.

## Redirect tables

Keep current page moves ahead of the frozen v1 permalink table when emitting `_redirects`. The tables have disjoint sources today. This order protects a specific current move if a legacy wildcard is added. Keep `/` and `/zh-CN` for the new home pages. Map known v1 docs permalinks to the closest current pages in the matching locale. Add both slash forms because those old paths have no files for HTML normalization. Keep the older release-specific changelog entries pointing to the archived versions because their names overlap current changelog routes. The archive's v1.0.0 release is English only. [Cloudflare redirect rules](https://developers.cloudflare.com/workers/static-assets/redirects/)

The v1 redirect passes `from=v1`, a locale-neutral `src`, and, for Chinese links, `lang=zh-CN`. The arrival notice uses those values to rebuild the exact archived URL. The version-specific archive redirects go directly to the archive.

### Add a moved page

Add one entry in `apps/docs/src/lib/v2-redirects.ts`. Use a root-relative old `/docs/…` path and a live destination under `/docs` or `/learn`. Use paths without trailing slashes, query strings, or fragments. Point any existing move or v1 `PAGE_MAP` entry for that page directly to the final destination, so there is one hop. For a moved heading, keep the old heading id at the destination because the browser carries the original fragment without sending it to the server.

The build emits a permanent 308 for the page and both Markdown forms in both locales, even when Chinese content falls back to English. It does not generate a separate social-card redirect. The tests compare the destinations to published routes, check every derived edition, and detect chains in the emitted rules.

The tutorial moved to Learn and two how-to pages. The how-to hub moved to the docs index. Concepts moved into Setup and Reference.

## Changelog misses

The plugin can link directly to any released tag. The earliest 2.0.0 alphas predate the docs changelog, so give versions older than the first changelog entry a permanent 308 to the changelog on both lines. For other misses on production, hand the request to the Pre-release Docs line with a temporary 307. A miss on the Pre-release Docs line returns 404 to avoid a loop. Apply the same policy to HTML, Markdown, and social cards, using the destination for the same resource kind.

## Headers on static responses

Apply `noindex` and the HTML canonical link to the static Markdown editions, and mirror that policy on Worker responses. A placeholder matches one path segment, so generate one content-route rule per depth. Use the native locale path for an edition that the build emits in Chinese. The Pre-release Docs copy applies one site-wide `noindex` and removes narrower copies of that header because the asset layer joins values from matching rules. It preserves other headers when removing the duplicates. [Cloudflare asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)

Use the asset header rules for Chinese content language, giscus stylesheet CORS, and the RSS content type. Missing Chinese pages fall through to the Worker, which labels the English response. The bare Chinese home path has its own rule beside the nested paths' rule, as the 2026-11-23 amendment states. [Home header](https://github.com/aidenlx/zotlit-repo/issues/111)

Cache commit-pinned archives and hash-named assets as immutable because new bytes get new URLs. Keep the chunks crawlable so a search engine can render the page. Exclude the chunks from search results with the response header.

## Amendment (2026-11-23): the bare Chinese home path has its own header rule

A `/zh-CN/*` rule does not match `/zh-CN`, so the prerendered Chinese home page had no `Content-Language`. The asset headers now hold a `/zh-CN` rule beside the `/zh-CN/*` rule. A unit test checks the rule table against every prerendered Chinese path outside the `run_worker_first` patterns, on the production line and on the Pre-release Docs line.

Accepted limit: no automated test reads the built `_headers` file against the asset layer. One local `vite preview` checked by hand that `/zh-CN` and `/zh-CN/docs` answer `content-language: zh-CN` and that a missing Chinese page answers 404 with `content-language: en`.

[Issue 111](https://github.com/aidenlx/zotlit-repo/issues/111) · [PR 247](https://github.com/aidenlx/zotlit-repo/pull/247) (`727c8263a`)
