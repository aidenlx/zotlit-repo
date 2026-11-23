# The docs site prerenders asset-first and falls through to an SSR Worker

The docs site moves from a patched pre-release Next.js on Vercel to TanStack Start on Cloudflare Workers. Two forces shape the deployment: hosting has to stay free at current traffic, and the site has to keep serving the Web Template Workbench and the Template Directory later without a second re-platform. A fully static export would meet the first force and fail the second; a fully server-rendered site would meet the second and spend a Worker invocation on every request, including the ones a CDN can answer on its own.

The site therefore deploys as **one Worker with a static-asset binding, and prerenders every route that is safe to build ahead of time**. Cloudflare serves a prerendered file straight from the asset layer, unmetered and free; a request with no matching file falls through to the SSR Worker. Server rendering stays scoped to routes with request-time behavior: the release-fact endpoints behind the install pages' ledger and the landing and community pages' counters, the search endpoint, the Pre-release Docs fallback on the changelog surfaces — which runs only when a version misses the asset layer — and the English fallback for a `/zh-CN` page that has no Chinese file, which likewise misses the asset layer because only native Chinese editions prerender. The pages with GitHub data — the landing and community counters, the install pages' snapshot — prerender with the facts their build saw, and the browser replaces them with the latest after mount. Redirects and headers stay in the asset layer as generated `_redirects` and `_headers` files, so a v1 permalink costs no invocation at all.

Markdown negotiation is the one place where asset-first costs something. An agent that sends `Accept: text/markdown` on a bare page URL expects the authored Markdown edition, and the asset layer answers before the Worker ever sees the header. The Worker is therefore registered ahead of the assets on HTML page paths alone, through scoped `run_worker_first` globs: it applies fumadocs' `isMarkdownPreferred` check, and hands the request back to the prerendered asset when the reader wants HTML. Every HTML page view thus spends one Worker invocation, and the authored Markdown editions — including the `<ContractTable>` tables rendered as GFM — stay the negotiated payload instead of Cloudflare's auto-converting "Markdown for Agents".

## Consequences

- The daily free-plan request quota is consumed by HTML page views and the SSR routes; images, CSS, JS, `.md` editions, feeds, and redirects never touch it. AI Crawl Control per-crawler blocks and one WAF rate-limit rule run before the Worker to keep that budget from being spent by a crawler storm.
- The worst case is a degradation, not an outage: with the quota exhausted, worker-first HTML paths fall back to their prerendered assets — losing negotiation, keeping the pages — and the SSR routes stay unavailable until the UTC reset.
- Adding a request-time feature means dropping one route out of the prerender list, not moving the site to another platform. Cloudflare bindings stay available to every server route, which is what keeps the Template Directory's later architecture open.
- Authored Markdown stays a build output of the content pipeline rather than a runtime conversion, so the Markdown edition of a page is reviewable in the repo and identical for every consumer.

## Worker routing and canonical URLs

The TanStack server entry wrapper negotiates Markdown and hands HTML
requests back to the prerendered files through the `ASSETS` binding.
Each deployment uses one canonical custom domain and turns off its
`workers.dev` hostname. The custom domain routes all paths to that
deployment and creates its DNS record. The route's fail-open policy is
managed in the Cloudflare dashboard.

Canonical page URLs omit a trailing slash. The asset setting serves
`<page>/index.html` for those URLs without redirecting to a slash.
Only the selected page sections need the worker-first route patterns.
Images, styles, feeds, and redirect files can use the asset layer
directly. Excluding a route from worker-first prevents a request with
no asset from reaching the Worker. Markdown editions in those page
sections must still be eligible to reach it so a missing changelog
edition can use the pre-release fallback. The RSS route has an explicit
exclusion because the build always produces it as a file. The
`DOCS_LINE` value distinguishes the sites so a fallback cannot bounce
between them.

## Request handling

Resolve the locale before the Markdown suffix rewrite to keep both editions on the typed route tree. Outgoing links use the reader's locale. Requests that prefer Markdown but have no Markdown edition proceed as HTML. Keep asset requests in manual redirect mode so generated redirect rules reach the reader. Check legacy slash aliases before locale normalization to preserve a one-hop redirect. Global machine inventories have a single English edition, so their locale-prefixed URLs redirect to the shared path. Unprefixed slash variants can still render during asset generation.

Give Markdown responses their HTML canonical URL and exclude them from search indexing. Vary the bare route by Accept so caches keep the two representations separate. Exclude the Pre-release Docs line from indexing through both asset headers and Worker responses. The server suite tests these headers and a Chinese fallback using a generated reference page with no native Chinese edition.

## Compiled content

Compile each authored Markdown edition as a function so the prose comes from source and embedded JSX retains evaluated props. The Markdown renderer supplies its component map. Components can supply their own Markdown representation, and other components serialize as JSX. Resolve the optional search title for the visible heading, page metadata, social card, Markdown title, and inventory entry. The short title still labels the sidebar. Require FAQ structured data to match the visible Questions section.

A lesson puts build-time metadata in frontmatter and the labelled instructions and checks in ordered Step elements in its body. Lesson tests compare the two. Use the media slug to locate the numbered recordings and stills. The course card uses the chore, the lesson opener states its replacement and can address a concern about the reader's library, and the Markdown edition gets a plain outcome and a next-step line. The completion view uses the result title and capability caption. Related links use the current docs page title and a phrase that names when the reader needs it. Blog descriptions supply the standfirst on both the page and the index.

## Build and development paths

Emit asset redirects and headers as static files. Emit binary social cards and skill archives from Vite, with equivalent development middleware, because the prerender pass writes text and the native renderer and archive reads need Node. The Worker resolves the real Fumadocs server module through an environment-specific resolution hook so its Markdown renderer is available. The client resolves the browser stub to keep that renderer out of its bundle. Explicit prerender entries cover safe HTML and machine routes and leave request-time routes to the Worker.

Point the app alias at source explicitly. In development, prebundle the CommonJS external-store shim for Base UI before hydration, scan the lazy Workbench entry before the first request, and prebundle the dependencies that macros and MDX introduce on the server. These steps keep the dependency graph from being rebuilt after the first page request. Group translations by locale in development to avoid one HTTP request per message. Store local Miniflare state with the project's ignored runtime files.

Vite defines native Chinese paths, step media, content first-commit dates, and media-store URLs for the Worker and browser at build time. Share one video scan across the lesson and media plugins. The uploader uses each video's content hash as its object key and uploads missing keys only, so unchanged recordings require no repeat upload.

## Machine routes and page metadata

Keep release data, community counts, search, and social-card misses in server-only route files. A route with only a `server` property stays out of the browser route tree and the prerender pass. The release and community endpoints supply fresh values after the pages render with their baked values. Search uses the docs collection only. Its index starts with the first query in an isolate and reuses that work. Keep the default multilingual tokenizer so it can segment Chinese. The default search dialog fetches `/api/search`.

One Markdown splat route handles a section landing edition, every deeper page edition, and incoming requests rewritten from the public `.md` suffix. A missing changelog edition redirects through the public suffix URL because the nested machine path is excluded by robots.txt. Apply the same policy to machine duplicates of HTML content. Advertised social cards are static binaries. A changelog card missing from that output can use the pre-release fallback.

The root route supplies page metadata defaults. A route's head overrides individual tags. The compiled blog and lesson bodies carry their Git modification dates. Show a blog revision date only when it follows publication. In the newest-first index, the next array element is the older blog post. Use the post path for the giscus discussion so a title change cannot detach its thread. For the changelog feed, parse the normalized publication date as a UTC instant and let the feed library format it. Prefix the repeated section anchors on the changelog index with the release version so fragment links stay unique.

Inject the public Cloudflare Web Analytics site token at build time. A build without a token omits the beacon. The token selects the analytics property.

The sidebar server function sends a typed page tree that holds icon names, and the layout resolves the names to icons, as the 2026-11-23 amendment states. [Sidebar serialization](https://github.com/aidenlx/zotlit-repo/issues/104)

## Shared page components

Load the docs body and its table of contents from the compiled MDX module. This keeps the TOC's React nodes off the server wire. The loader sends title, description, and other head data separately because the route can render metadata before the module resolves. Read the modification date from the compiled module as the sitemap does. Render the ISO day up to hydration, then format it for the reader in UTC to preserve the calendar date in every time zone. The `dateTime` attribute keeps the ISO day. Publish TechArticle data for docs pages and FAQPage data when the page supplies a FAQ. Omit breadcrumb data for the docs index and pages with no sidebar trail.

Give Fumadocs its public, localized path while the router matches its unprefixed paths. Keep the active path stable while navigation is pending. Packaged controls and search take the URL locale, even when the body falls back to English. Paraglide owns the locale switch and an explicit choice of English stops the suggestion. The translator controls the order of named React slots inside a message.

Use one banner to explain a missing Chinese body and a different banner to offer a Chinese edition to a Chinese-first browser. The latter renders hidden until the head script marks the reader and leaves no reserved gap on other pages. Keep it off full-height app shells so their footer still fits. The fallback uses the banner offset for sticky chrome. Use native anchors for locale changes so the router does not apply its outgoing locale rewrite. Preserve the query and hash when switching editions. Fragments are absent on the server, so use the browser snapshot after hydration and refresh on both history and router location changes.

The legacy notice uses the redirect's `from=v1` and `src` query values. Treat a locale hint alone as insufficient to show it. Validate the source as a path before appending it to the fixed archive origin. Preserve the original archive locale when a reader chooses the English edition of the new page. The prerender has no arrival query, so the notice reads it in the browser from the router location after hydration, as the 2026-11-23 amendment states. [Redirect notice](https://github.com/aidenlx/zotlit-repo/issues/105)

Page loaders supply initial release data only for the install pages and the install lesson. Pass it through context because the consumers sit inside MDX bodies below the route. Refresh after mount, and keep the baked facts on a failed lookup. An ineligible page has a null snapshot even when the preceding page fetched one. This was fixed on 2026-11-23 in [PR 247](https://github.com/aidenlx/zotlit-repo/pull/247). [Snapshot](https://github.com/aidenlx/zotlit-repo/issues/106)

The ledger uses a status row when a channel has no active release and omits the ledger when the facts are unavailable. The Companion download links directly to its latest XPI and falls back to its releases page. Since the Companion has no separate changelog entry here, share the Companion version aside between the changelog list and detail routes. Keep the repository link usable and omit only the counters that were unavailable.

## Prose elements and Markdown editions

Keep action links readable as ordinary links in the Markdown edition and append a supplied download filename. Use block framing for standalone links so the label from MDX becomes one link rather than its own block. In HTML, launch an Obsidian deep link in the current tab so it leaves no empty tab. Web links that explicitly open outside the site can use a new tab.

Render a callout as an Obsidian callout header and a quoted body in Markdown. Render a command name as code, adding a blockquote label for the block form. Omit the block form's copy affordance in Markdown, where the command is already text. Catalog command names take the ZotLit prefix. Literal children preserve names owned by other products. Source ZotLit labels and settings names from the product Message catalog. The Settings Path keeps Obsidian's Settings label and the plugin tab name as literal prose. Keep prose tabs behind the shared component so the site can adapt their styling without editing authored pages.

Resolve lesson link titles and duration from lesson frontmatter so prose follows a retitle or time change. Use the native Chinese title where available.

## Prerender inventory and locale selection

Build the prerender list from the content scan plus named catalog routes. The fully translated catalog routes include the home, community, policy, Learn, changelog and blog listings, and the Workbench. Publish both the suffix and content-route editions for section listings, including the Learn course. The machine inventories, sitemap, robots file, and feed have public static entries. Compare the prerender list to the public loaders in the locale suite.

Keep English paths unprefixed, Chinese paths under the v1-compatible `/zh-CN` prefix, and English as the fallback for missing content. Derive locale alternates from native files and named catalog pages, and identify the HTML canonical for both HTML and Markdown requests.

Use the first browser language at the pre-paint head script and let any Chinese locale, including Traditional Chinese, trigger the published Chinese edition suggestion. The head marker shows the strip in the already rendered page. A saved English choice suppresses that suggestion, and choosing English or closing the strip clears its marker immediately. Persist the choice when browser storage is available. A blocked read skips only persistence, and the suggestion and the language choice still work. This was fixed on 2026-11-23 in [PR 247](https://github.com/aidenlx/zotlit-repo/pull/247). [Browser storage](https://github.com/aidenlx/zotlit-repo/issues/112)

## Content inputs and publication dates

Keep validation and Markdown transforms in the Fumadocs macro arguments so they run in Node and leave the app bundle. Underscore-prefixed docs files enter the page through includes and remain outside the public collection. The four collections supply server metadata and lazy MDX bodies. Vite config is outside their import graph, so the build's prerender list and card inventory scan files. Use Fumadocs slug and frontmatter helpers to keep group and index handling aligned. Hand raw frontmatter to the collection schemas, and strip the locale infix before deriving a native Chinese slug. The development watcher restarts Vite when an edition arrives or leaves so app and SSR definitions reflect the same page set. Compare the resulting definition to the inventory and restart again if a second change arrived during a coalesced restart.

Build an ISO publication day from the first Git author date in UTC. Carry it across detected renames so a page keeps its structured publication date. Use full history and fail for a shallow or absent clone. The runtime gets that map through `__FIRST_COMMIT_DAYS__`, while compiled content carries the last-modified date separately. Normalize YAML date values and authored ISO strings to one ISO day for the JSON collection index and social-card scan. Compare those days as strings. Changelog ties sort by descending semver and blog ties by title. Lesson order comes from the course position. Resolve a lesson's related guide names through the docs loader so the UI and Markdown use the guide's own localized title. Unknown guide slugs fail generation.

The canonical origin covers the page metadata, social images, sitemap, and feed. A shared social-card type list drives both the rendered card inventory and URLs in the head. Native Chinese pages get their Chinese card and fallbacks use the English one. Link edit and license actions to the source trunk, and link repository counters and discussions to the publishing repository. Keep Date at the Worker boundary for the render year and UTC release labels because this runtime lacks Temporal.

## Markdown assets and links

The four content sections share a pure URL scheme across the router, content route, prerender list, and Accept negotiation. A suffix rewrite sends `/docs/example.md` to `/llms.mdx/docs/example/content.md`. Bare section paths use an empty slug list. The changelog feed and suffix editions bypass negotiation, while ordinary slugs can contain periods. Each edition compiles authored Markdown through the module's component map. Strip empty HTML anchors used only to preserve fragments on the page. A lesson edition includes the opener, steps with pictures, and next lesson or related guides. The docs index uses its own body. Changelog, blog, and Learn listings build an edition from their entries and localize links. Use the version as the changelog entry's label when it has no title.

Serve both `llms*.txt` inventories as plain text. The short index preserves folder labels and takes each page entry's own title, then lists lessons. The full index concatenates docs and lessons. The asset rule and Worker share the Markdown canonical and noindex headers.

Rewrite localized Markdown link destinations by source offset to preserve code, image destinations, labels, titles, and unrelated URLs. A definition used by an image remains in its authored form. HTML and JSX links keep their authored destinations, except components such as ActionLink that render ordinary Markdown. A destination that starts with an escaped slash is localized too, as the 2026-11-23 amendment states. [Link rewriting](https://github.com/aidenlx/zotlit-repo/issues/113)

Adapt translations from the root message catalog to Fumadocs' native registry. Pass its URL and query placeholders through so the provider can interpolate them at the point of use.

## Release-data boundary

Release API calls run in the Worker and use its GitHub token only for the API host. The client-safe module holds the public release URLs and the pages and lessons that carry those facts. Send a named User-Agent. Raw files and GitHub assets that redirect to storage use unauthenticated requests. Bound each lookup with a short timeout and cache successful facts for one hour at the edge and browser. Compose the install snapshot in one pass. An unavailable lookup omits its affected facts. Each response is checked against its shape, and a response of the wrong shape counts as unavailable, as the 2026-11-23 amendment states. [Release snapshot validation](https://github.com/aidenlx/zotlit-repo/issues/117)

The stable plugin ledger follows the publish repository's manifest. Choose the highest semver pre-release rather than relying on GitHub creation order, which a re-cut tag can change. Drafts and tags for other products stay out of that choice. Read the pre-release compatibility manifest from the tagged asset. Companion data comes from Mozilla-format auto-update manifests, including the bounds and the tag used for the direct XPI. Treat a pre-release as dormant when its version is at or below stable. Format an absent maximum as open-ended and a trailing wildcard as its whole version line. When available, the GitHub release supplies the publication instant. Fetch stars and downloads independently so a missing count cannot take the repository link away.

### Walkthrough media capture

The citation lesson follows the reader's draft, formatted citation,
reference and sourced quote. Use its step names in the recorded
sequence. The vault already has the Resource Pack, so the install step
shows its status. Frame the active control or result with the pointer
off the text. Keep the file name visible without the Fixture path.
Start the selection clip on the suggestion list before Enter and
finish the quote on the completed drop.

Each landing clip sets up its own Docs Vault Case scene so a single
case can be recorded again with the name filter. Start on a still
frame and finish on the result. Set the content area to 1024 by 640
CSS pixels, retain the whole window without pads, and write 1600 by
1000 posters next to the clips. The Word scene writes only the poster.
Keep notices and the status bar out. Start the paper on page one
despite Obsidian's remembered position. After zoom, wait for the
text layer to redraw before positioning and dragging over the
sentence. Keep highlight selection and pointer placement clear.
Reset the added highlight, generated note or draft before another
take. Open the target tab before closing others and snapshot the
leaf list because closing can change iteration order.

Write in APA and export the chapter without its notes to self. Since
the recording does not open a Word app, render its first page in
Quick Look on a grey 16:10 canvas. Crop below the References and
hold the page top five percent below the canvas top.
[Landing clips](../../packages/e2e/src/docs-walks/landing.walk.ts) ·
[Citation lesson](../../packages/e2e/src/docs-walks/cite-while-writing.walk.ts)

Keep lesson ticks optional when browser storage is unavailable.
A failed language-choice write can show the suggestion again on a
later visit. Prerender native catalog pages in both languages, with
Markdown editions for section listings.

Build cache inputs include the root skill sources because docs builds
the downloadable archives. Restore the Cloudflare deployment pointer
with the dist output. Separate builds by their analytics token,
environment and media origin. The Query function reference reads the
generated Query Schema and checks every registry entry for its
description during the build. The docs compiler includes RegExp.escape
and Temporal types for dynamic text and imported Query source.

## Amendment (2026-11-23): the docs routes send serializable state and check release data

- **Sidebar tree.** The docs loader has no icon plugin. `lib/sidebar-tree.ts` projects the page tree to a typed shape that the server function can serialize, with icon names in place of React elements. The layout route resolves the names through one closed map. The content schemas accept only the names in that map. An icon resolved at build time prerenders with the sidebar.
- **Redirect notice.** The legacy notice reads the router location after hydration, so the prerendered HTML shows no notice and a client navigation removes it. Dismissal applies to the arrival URL, its path and query.
- **Escaped slash.** A Markdown destination that starts with `\/` is localized as one that starts with `/`. The English direction decodes backslash escapes to find the `/zh-CN` prefix before it removes it.
- **Release data.** Each fetch checks its response against a valibot schema and returns null when the shape does not match: releases, plugin manifests, Companion manifests, repository stars and plugin statistics. A malformed Companion manifest then removes only the Companion facts.

Accepted limits:

- The icon map holds only `Book`. An author who wants another icon adds it to the map. The projection keeps only text labels, so a label that is a React element would be lost. No loader makes one.
- Dismissal is kept in memory only. A return to the same arrival URL in the same session keeps the notice dismissed, and a reload shows it again.
- A character reference such as `&#47;` or `&sol;` at the start of a destination stays as written.
- Validation is per response. One malformed entry in the GitHub release list drops the whole list, so the release dates and the Obsidian pre-release ledger are unavailable until the entry is corrected. A manifest `version` must be valid SemVer, because the channel comparison needs it.

Rejected: any Lucide icon name, loaded in the browser through `lucide-react/dynamic`. The prerendered HTML then has no icon, and the icon appears late.

[Issue 104](https://github.com/aidenlx/zotlit-repo/issues/104) · [Issue 105](https://github.com/aidenlx/zotlit-repo/issues/105) · [Issue 117](https://github.com/aidenlx/zotlit-repo/issues/117) · [PR 247](https://github.com/aidenlx/zotlit-repo/pull/247) · [Issue 113](https://github.com/aidenlx/zotlit-repo/issues/113) · [PR 243](https://github.com/aidenlx/zotlit-repo/pull/243)
