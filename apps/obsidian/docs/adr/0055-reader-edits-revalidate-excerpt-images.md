# Reader edits revalidate Excerpt Images

Accepted design; implementation is pending.

A saved Annotation edit that changes excerpt pixels makes its previous Excerpt Image stale and triggers revalidation for active excerpt consumers. During revalidation, a consumer can continue displaying the previous image for the same verified source and Annotation. A successful current render replaces that displayed image and publishes the new generated entry through the shared cache. Geometry changes and ink colour changes affect pixels; metadata changes that leave the pixels unchanged preserve cache validity.

Saved pixel-affecting edits also refresh affected excerpts already present in the derived cache when their cards are not visible. A persistent latest-image reference per verified Annotation supports stale display after reopening a view. Untouched, uncached Annotations remain on demand. A failed refresh retains the previous image for display with stale status recorded internally; a subsequent relevant request or saved edit retries revalidation.

TanStack Query (React Query) owns the SWR query lifecycle through the plugin's shared QueryClient, following [root ADR 0060](../../../../docs/adr/0060-held-reads-are-realized-on-tanstack-query-core.md). The existing implementation uses `@tanstack/query-core`; it supplies the shared engine for UI and service consumers. Excerpt queries retain the previous successful result during replacement, coordinate identical requests, and invalidate superseded work. Saved-edit handling explicitly schedules refresh for affected cached excerpts, including those without a mounted UI consumer. Invalidation alone is insufficient because the current service deliberately uses `refetchType: "none"`.

IndexedDB remains the device-local image store and persistent latest-image index. The dedicated PDF queue remains responsible for expensive document and render work. Query state and persisted image metadata distinguish a held stale result from a result validated for the requested fingerprint and PDF revision. Note operations verify that distinction when awaiting current results; the existing Held Read fallback-to-old-value behavior alone does not establish freshness for an import. Query retention must respect the agreed memory bounds rather than retaining a second unbounded copy of image payloads.

This refines the display behavior behind [ADR 0049](0049-excerpt-images-use-zotlits-cache-and-renderer-before-zoteros-cache.md). Stale display reuse is distinct from a validated cache hit: an image made from old rendering inputs retains its old identity and freshness. Stable Annotation identity locates the previous display image, while rendering inputs and PDF freshness identify the required replacement. A late render from a superseded edit must not replace the current displayed result or the current-image reference.

Both reader-backed and detached rendering follow [ADR 0054](0054-reader-and-detached-excerpts-share-cache-publication.md) and publish compatible entries. Draft edits retain the existing saved-Annotation authority boundary. Note operations retain their agreed completion rule: await the requested current outcome before finalizing an embed, with verified previous-asset retention on failure. Display revalidation does not automatically rewrite saved note assets.

Send the confirmed Annotation and its source with an excerpt-pixel event so the consumer can resolve the file without re-reading the list. Ignore comment, Tag and label changes that leave the pixels intact. On the first list read use persisted image fingerprints to detect edits made while ZotLit was closed. [Repository events](../../../../packages/annotations/src/obsidian/annotation-repository/core/model.ts)

For the first list in a session, use each persisted Excerpt Image outcome as the comparison baseline. An Annotation with no stored image has no baseline.

Recoloring and editing the comment leave the rendered pixels unchanged. A Geometry Edit keeps the saved image until the confirmed record is available.

Only a saved snapshot at least as new as the recorded version can advance the latest demand. This also applies to a caller joining an active render and to an old note request admitted after a newer edit. Use admission order when versions are unavailable. Display can read the previous stored bytes during replacement. Zotero fallback or failed replacement leaves the latest reference in place, and evicted bytes or a store without references give no previous image. Read the reference through verified Annotation identity and keep the resolved fingerprint and PDF evidence with it. [Outcome service](../../../../packages/annotations/src/obsidian/excerpt-image/service.ts) · [Service tests](../../../../packages/annotations/src/obsidian/excerpt-image/service.test.ts)

### Live display demand

Key a card's Held Read by verified Annotation identity and carry the pixel identity with each resolved result. Keep the old image through replacement or failure. Share a read among cards and release it when the last card leaves. A note can share the PDF job and keep it live after the display moves on. A remounted card can seed from the persistent latest image when no Held Read remains.

The display compares record versions before accepting a card demand or saved-edit revalidation. Recheck a changed PDF stamp even when the demand targets the same pixels. A retry can invalidate the previous failure without waiting for the query cooldown. Removing the query prevents late publication before interrupting its work. A slot can both seed from storage and run the fresh query. Wait for both because a stored fallback can arrive after fresh resolution fails. Skip the seed when the slot already has an image.

Snapshot identity remains stable until publication. A manual clear releases the Held Read and its displayed bytes even if the card stays mounted. Restating its demand starts a new read. Mounted cards can outlive Query Core's cache entry, so the next saved edit can seed from storage. Leave uncached Annotations on demand. Tests gate rendering independently of the clock and move only the query's retention clock. [Live display](../../../../packages/annotations/src/desktop/excerpt-image/display.ts) · [Display tests](../../../../packages/annotations/src/desktop/excerpt-image/display.test.ts)

Run the refresh trial against the production service, display, and IndexedDB store in Chromium. Supply a deterministic host for filesystem and database dependencies and use real canvas WebP output. Compare stored bytes exactly after restart because a freshly encoded crop can have the same length. Measure retained bytes against the store budget. References use no image bytes and are evicted with their image. Clearing releases display and store state, and work overtaken by the clear cannot restore it. The next demand waits for its own crop. The trial names each awaited step to diagnose stalled work. [Refresh trial](../../../../packages/annotations/src/desktop/excerpt-image/refresh.browser-test.ts)

Interrupt an older request for the same Annotation if a later saved pixel edit arrives while it is reading its Snapshot. A single subscriber handles saves from all Annotation surfaces and ends with its scope. On manual clear, release the display reads before the store clears so a repaint cannot retain bytes the operation removed. A late storage fallback may still paint after a fresh read fails. Test display changes by subscribing to demand notifications and drive render completion with a gate. Cancellation only counts as abandonment before the harness answers a render. For the Chromium composition, order full specifier aliases ahead of prefix aliases and fail on accidental filesystem or database access.

Each Excerpt Image baseline lookup takes a separate database lease. The fixture excludes those leases when measuring repository batch reads.

### Pixel replacement and retained request proof

Use a writable Attachment in the Paired Run. Ask for capability
with the Attachment key because the repository indexes verified
sources by Attachment. A bare Annotation key can produce a
read-only result and bypass the write proof. Clear the image for
the target edit before starting because a cache key follows pixel
inputs across versions. Restore the Fixture record afterward.

Hold the replacement crop during an ink color edit. Verify that
the previous image remains paintable while work is in flight.
When the edit publishes, compare decoded pixels with the saved
record. The painted replacement URL stays live, and the card
releases every URL it superseded. Ignore unrelated URLs the
window-wide probe sees from other cards. A metadata-only edit
does no crop and leaves the painted URL in place.

Resolve a captured older request after a saved edit. It can return
its original pixels, but it must leave the latest reference on
the saved edit. Remount the view in its own leaf and read that
reference through the image the card paints. For the failed
resolver Refresh case, clear the device store and any live
display before starting.

[Saved edit and remount cases](../../../../packages/e2e/src/excerpt-acceptance.ts) ·
[Refresh case](../../../../packages/e2e/src/excerpt-refresh.ts)
