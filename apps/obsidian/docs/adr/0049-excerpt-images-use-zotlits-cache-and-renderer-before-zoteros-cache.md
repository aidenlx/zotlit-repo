# Excerpt Images use ZotLit's cache and renderer before Zotero's cache

Accepted design; implementation is pending.

Zotero can remove an Excerpt Image after an ink colour or position change, and its PNG carries no stamp that proves which Annotation and PDF inputs produced it. ZotLit resolves a requested Excerpt Image from its own valid cache first, then attempts rendering without opening a PDF reader, and uses Zotero's PNG only as the final fallback when neither step supplies an image. ZotLit owns its generated cache separately from Zotero's cache; Zotero remains the authority for saved Annotation content.

This contract covers image and ink Excerpt Images in the Annotation View, annotation insertion, and Literature Note creation and update, with neither reader open. Imported Notes use it where annotation-template mode already requests live Annotation data; ordinary Child Note image snapshots retain their existing meaning. New creation tools and geometry editing remain separate work.

Rendering targets equivalent PDF content, crop geometry, and ink appearance. Differences in antialiasing and other engine-specific pixels are acceptable. This replaces the coupling of derived-image generation to future image and ink creation in [Scope derived excerpt images for this milestone](https://github.com/aidenlx/zotlit/issues/826#issuecomment-5694174793).

Durable vault images refresh during note update or re-import. Existing notes retain their saved images between those operations; the Annotation View refreshes independently. Durable generated embeds require Attachment Import to be enabled. With it disabled, note output retains a source link and an explicit unavailable-image fallback.

If every image source fails, the note operation continues. An existing vault image is preserved and reported as not refreshed; a new image is represented by an unavailable-image message and source link. Output must not introduce a broken embed.

A Zotero-cache fallback is displayed normally in the Annotation View. Import reports its use in a summary notice per batch, because its freshness is uncertain. The next refresh or import retries the normal resolution order. A fallback stays distinct internally from a validated ZotLit cache entry.

PDF freshness is determined by file size and modification time. Cache validity also includes the Annotation's rendering inputs and the renderer version. A PDF replacement that preserves both size and modification time can therefore reuse an earlier image; this is an accepted trade-off for avoiding a full-file hash on validation.

New vault image versions use distinct, collision-safe names and are immutable. Updating a note changes its embed to the new asset, so other notes retain their saved images. Existing filenames and older assets are preserved; links migrate only when their note is updated.

The derived cache uses versioned IndexedDB storage per vault on this device, with an initial 256 MiB byte budget, least-recently-used eviction, and a manual clear action. Cache eviction and clearing preserve durable vault assets. The initial budget remains subject to measurement.

When the PDF is unavailable, ZotLit can reuse its own cached image if the Annotation's rendering inputs and renderer version still match. The Annotation View displays it normally; import reports that PDF freshness could not be checked in its batch summary. Revalidate when the PDF becomes available. A known Annotation mismatch requires regeneration or the fallback path.

On-demand rendering must complete with neither PDF reader open and while Obsidian is minimized or in the background. Runtime verification must prove this behavior, including the installed PDF.js animation-frame scheduling. The source-based feasibility research does not yet establish that acceptance criterion.

The subsequent trial on Obsidian 1.14.2 with PDF.js 5.3.34 rendered image and ink excerpts with zero PDF readers open. Ordinary display rendering timed out in a minimized window; switching only the matching internal render task to promise scheduling completed while minimized and produced byte-identical PNGs to foreground display rendering for the tested excerpts. Production integration must guard this private scheduling seam and retain display intent. This evidence covers the tested runtime and fixtures; compatibility and broader PDF coverage remain implementation checks.

## Annotation Card image ownership

Use the same image demand for a Zotero database and its Local API representation when both identify the same source. A committed image keeps its object URL through reads or failed replacement attempts. Clearing the image releases the URL with the image bytes, and changing to another Annotation releases the previous Annotation's URL. A clear shows the unavailable output. A new Annotation's demand can show loading until its read settles. [Image ownership tests](../../../../packages/annotations/src/desktop/annot-view/excerpt-image-state.test.ts)

Separate the stable display identity of an Annotation and source from the fingerprint of the required pixels. This keeps the previous image visible during pixel changes and avoids new demands when a refresh changes only tags, comment or record version. Resolve the demands for visible cards concurrently. Each picture owns and revokes the URL it creates. Show loading while a read has no image to paint. If an image passes the format check and fails to decode, show the unavailable message until another image arrives. [Image state](../../../../packages/annotations/src/desktop/annot-view/excerpt-image-state.ts) · [Picture](../../../../packages/annotations/src/desktop/annot-view/excerpt-parts.tsx)

Each card opens and releases an image demand. Resolve the request against the Annotation Source and the data directory it belongs to. An unresolved source yields no request. [Card actions](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

An Annotation Card keeps its demand for its rendered lifetime. As the source or required pixels change, it discards a request that resolves after a newer target supersedes it. That leaves the previous image visible during replacement. [Card image demand](../../../../packages/annotations/src/desktop/annot-view/Annotation.tsx)

A service test pins the case where a replaced PDF has identical size and modification time. This preserves the accepted metadata-validation trade-off.

### Durable assets and note preparation

Collect the template's requested helpers, batch the database inputs in the note's Snapshot before reading the vault, and count only helpers used in the final render. Share one summary across the user operation. Prepare a captured card's asset before rendering its link. Keep an earlier referenced asset on a failed refresh only when its path stays within the vault after resolving symlinks and the source can claim it. Accept the current and previous ownership identities. A legacy filename contains no source identity, so require a byte match with the current source's Zotero image.

Hold one publication gate per destination. Write complete bytes to a hidden temporary file so Obsidian's watcher does not index it. Use an exclusive hard link to publish without overwriting an existing asset. Link creation and recording ownership are one uninterruptible step. Verify the destination and reconcile it into the vault before returning the link so the first embed can resolve it. On interruption or a stale target, remove only the destination this call created. A mixed interrupt and failure still triggers rollback. An ordinary registration failure leaves the immutable content for a later caller. [Materialization](../../../../packages/annotations/src/desktop/excerpt-image/materialize.ts) · [Preparation](../../../../packages/annotations/src/desktop/excerpt-image/prepare.ts)

Read the loaded note's text or the vault copy when finding links to an existing Excerpt Image. The asynchronous metadata cache can still describe the old note. Render the prepared link synchronously in the user's link format.

The local Annotation Image command retains its own envelope and uses Item Query diagnostic codes. Read the request from one Snapshot under the active source's paths. Treat an unreadable path as absent and propagate interruption to the command's Promise ports. Its caller receives PNG even when the shared cache uses WebP. Publish to a content-addressed temporary path by linking complete staged bytes. Each use restamps the destination. Wait for a native write to finish before removing the stage because the write can outlast its caller's wait. The sweep ages published files by last use and abandoned stages by their shorter lifetime. [CLI publication](../../../../packages/annotations/src/desktop/excerpt-image/temp-store.ts) · [Live link lookup](../../../../packages/annotations/src/obsidian/excerpt-image/references.ts)
