# Docs chrome adapts owned Fumadocs slots

## Context

The site shares Fumadocs navigation behavior but uses the Journal typography and layout. The stock slots expose only some of the points that need styling.

## Decision

Own just the home header, docs sidebar, and docs page footer slot files under `apps/docs/src/layouts/`. Keep their other dependencies on package entry points and compare those slots on a Fumadocs upgrade. Use the same header on the not-found page because it renders outside the home shell. Draw the lower hairline below the navigation border and hide it while the mobile drawer supplies its own edge. Keep the search and other controls in the sans stack and apply uppercase mono to apparatus labels. On home routes, put the language notice beneath the header and cap it at the narrowest page content width. Mark a Chinese-first browser before the body paints to reveal the notice without a layout shift.

The header's navigation list places its descendants in Base UI's Composite focus scope. Registration updates trigger attributes after mount, so apply the hydration warning suppression only on the affected search and drawer buttons. The packaged icon search trigger forwards the class name but does not spread the hydration prop onto its button. The local mobile trigger uses the same dialog handle and button structure, with the site's label and classes, and applies the prop to the actual control.

Key the sidebar folder on active state because the base component opens a newly active folder but keeps a previously opened folder open. Reset the previous folder to its default on an active-section change. Give root tree entries and folder rows orange uppercase labels, nested page links near-ink text, and separators and standalone layout links a muted uppercase voice. Keep the top links and page tree in the same vertical rhythm. Use one presentational previous/next card grid on docs and blog pages. The docs footer obtains links from the navigation tree while the blog passes its own neighbors.

Use the narrow Learn shell for the course and lessons so they fit beside Obsidian. Carry the redirect notice because old permalinks can land there. The course prerenders without progress because the saved checklist lives in the browser. After mount, Continue can link to the first incomplete step of an in-progress lesson. When no lesson is in progress, it can link to the first unfinished lesson. Lesson 1 appears as the required starting card and becomes a strip after completion. At wide desktop sizes the other lesson cards follow the three-over-two grid.

Choose the tiled favicon so it stays legible against a dark browser tab. Put the ICO fallback first and retain its pixel-fit 16 px size with the 32 px tile. Use giscus' base themes for syntax highlighting and loader assets. Override their surface and button colors with matching Journal tones. Emit a static CORS header on `/giscus/*` from `apps/docs/src/lib/headers.ts` because the discussion iframe loads those styles cross-origin.

The [site design](../../DESIGN.md) records the current type roles and layout styles.

## Other shared chrome

The banner adapts `@fumadocs/base-ui`'s `components/banner` at 16.14.0, including its base32 id encoding and rainbow branch. Compare it on dependency upgrades. The configured height is a minimum so it can wrap instead of overflowing. On mount and resize, sync its measured height to the CSS variable the sticky header and sidebar use. An id lets the banner remember a dismissal. A close callback can offer dismissal while leaving persistence to its caller.

The docs mobile header wraps the packaged subnav to add the second hairline. The blog and changelog back crumbs use a text arrow with the uppercase mono voice. Inline the GitHub, Discord, and Obsidian marks as SVG so they can take their parent color. Inline ZotLit's mark to retain a sharp diagonal at high pixel density. Its light and dark fills use the shared brand tokens and its small variant follows the 16 px optical grid.

Place the discussion below the docs previous/next cards. Use the page path without its leading slash as the stable discussion term. Leave the count heading to giscus. Its iframe needs an absolute theme URL, so derive that URL from the current host in the browser after mount.

The shared Learn header puts the wordmark and a mono Learn label before the muted course and docs links, above a single hairline. Keep the shell distinct from the docs navigation so it fits in a narrow window beside Obsidian.

The owned layouts also copy the small ref-merging helper because Fumadocs does not export it on a package entry point. Compare that copy when updating the owned slots.
