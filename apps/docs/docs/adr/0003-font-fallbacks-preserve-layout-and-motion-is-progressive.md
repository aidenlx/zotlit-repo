# Font fallbacks preserve layout and motion is progressive

## Context

The docs site serves English and Simplified Chinese through the same theme. Fonts must preserve the layout as web fonts arrive. The landing examples must also remain readable before animations start and when motion is reduced.

## Decisions

Self-host role fonts and load Unicode subsets on demand. Keep Archivo limited to the wordmark. Gelasio and Inter use the metric-adjusted fallbacks carried over from the pre-migration Next.js 16.3.0 font metrics. Plex Mono uses fixed-pitch locals with the same 0.6 em advance. Matching advances leave only vertical metrics to override. A proportional fallback fits mixed-case prose differently from the short uppercase labels. Consolas has a narrower advance, so list the compatible locals by full face or PostScript name and finish with Courier New before the ordinary monospace stack. Use sans as the app-wide default, including portals and not-found pages, and opt editorial surfaces into serif. Theme tokens connect Tailwind utilities and CSS variables to the same role stacks.

Load the Chinese stylesheet only for Chinese content. Keep Latin text in its usual face and use WenKai GB Screen for CJK serif and Noto Sans SC for CJK sans and mono. The Chinese web fonts use SIL OFL 1.1 and load as Unicode slices. Use local Kai fallbacks with WenKai's hhea vertical metrics of 1900, -500, and 0 at 2048 units per em. The ideographs keep the same advance across those faces. Prefer existing local sans-face installs in the Chinese stack. Put narrow punctuation-only faces ahead of Latin because the code points for double quotes, em dashes, and ellipses occur in both sets. Keep single quotes with Latin so the apostrophe keeps its Latin form. Reuse the Chinese font slices for the punctuation glyphs. Chinese prose uses upright editorial runs, emphasis dots, strict line breaks, autospace, and punctuation trim. Keep the upright rules outside utility layers so they govern editorial runs and captions while bibliographic `<i>` can still use italics.

The Journal tokens supply one palette for docs and landing surfaces, with a separate tone for accent text and focus marks. Keep Zotero annotation colors the same in both schemes and use them where the examples depict Zotero highlights. Lesson completion colors and landing window colors have separate tokens. Use the existing `#toc-title` selector because Fumadocs exposes that stable id and no class hook at the heading.

Place the landing animations under motion-safe so the static and reduced-motion versions show the final state. The desk drop stops at the object's base transform. Use backward fill to retain the first frame during its delay without leaving the text on a composited layer after the drop. The citation picker, typed text, mark, and reference share one 11-second loop with a 1.7-second initial delay. Within the cycle, typing starts at 0.6 seconds, the picker opens at 1.4 seconds, typing finishes at 1.85 seconds, selection occurs at 3.6 seconds, and the citation and reference arrive at 4.4 seconds. The mark fades from 8.4 to 9 seconds. Clear the example after 10.4 seconds. Change the matching keyframes together if the timing changes.

See the [site design](../../DESIGN.md), [theme stylesheet](../../src/styles.css), and [Chinese font faces](../../src/fonts-zh-cn.css) for the current roles and values.

Preload upright Gelasio for headings and italic Gelasio for ledes because serif display appears on most routes. Inter and Plex Mono rely on their adjusted fallback faces. The Archivo subset is small enough for Vite to inline in the stylesheet.

## Prose modifiers

Use element modifiers for the docs and blog prose so they apply at the typography layer and honor the `not-prose` boundary. Set serif headings one step above the base size to compensate for Gelasio's x-height. When a nested list or paragraph selector needs a descendant relationship, the single-element typography variant cannot express it. The Tailwind arbitrary variant supplies the relationship and does not carry the typography guard. Chinese headings use looser lines and plain tracking to accommodate full-em characters, while body prose already uses open leading. The changelog list and detail share the same roles for its mono category, accent rule, serif feature title, and square inline code. Each surface owns its own spacing and size.

## Social images

Build the 1200 by 630 WebP social cards with the native Takumi renderer in Node. The card inventory reads the content scan under the same frontmatter schemas as the routes. Use the English card for a fallback and emit a native card only for a translated file or catalog page. Resolve the Paraglide facade during the asset hook after generation. Each card uses the Journal label, headline, deck and brand footer. The home card has a larger title, and long titles step down so their descriptions fit. Chinese text steps down sooner, with more leading, a wider deck and lighter tracking.

Reuse one renderer and the same Archivo wordmark subset the site uses. Load Latin fonts once. For Chinese cards, read the site's WenKai GB Screen subset rules and load their local slices only when needed. Use Noto Sans SC for Chinese sans and mono fallback. Reuse registration promises so concurrent cards share the same font work. Limit retries on transient font network failures and stop when the renderer's timeout aborts. The mark is inlined so the image renderer needs no separate SVG loader.
