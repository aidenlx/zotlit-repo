# Reader and detached excerpts share cache publication

ZotLit's PDF reader integration and detached excerpt rendering publish generated Excerpt Images to the same ZotLit-owned cache through the shared Excerpt Image service. Both paths use the same verified identity, freshness validation, image-format policy, duplicate-work coordination, and cache-clear generation checks. Reader and detached work must cooperate without changing the reader's visible output or invalidating its owned resources.

This extends [ADR 0049](0049-excerpt-images-use-zotlits-cache-and-renderer-before-zoteros-cache.md) with a reader producer while preserving detached operation when no reader is open. The reader currently paints full pages and Annotation Marks rather than cacheable Excerpt Images; the integration must establish equivalent excerpt content and rendering inputs before sharing entries. Zotero's externally owned PNG cache retains its fallback role.

An excerpt request uses a compatible loaded Obsidian PDF document when available and generates only the requested image or ink crop. Viewing a PDF page alone does not proactively generate all Excerpt Images. Reader-backed excerpts follow the same geometry, saved Annotation snapshot, and lossless WebP policy as detached excerpts; visible reader overlays are not the source of cached pixels.

Batch import and PDF reader viewing are mutually exclusive workloads for this design. Their cache entries remain reusable when the user switches workflows. Excerpt work owns its render task and output canvas while the reader retains ownership of its document, pages, and visible render tasks. Reader closure or document replacement must invalidate access to borrowed resources.

Reader reuse must establish which PDF revision the loaded document represents. A current filesystem size and modification time alone cannot establish that a previously loaded document contains the current bytes. When that evidence is unavailable, detached rendering supplies the validated source. A reader that closes or replaces its document during excerpt work invalidates that attempt; a still-requested excerpt can retry through detached rendering. The existing reader-binding registry supplies document access through a narrow adapter.

Borrow only a current document held by a resolved Reader binding. While a view is loading, closed, or on a file with no Zotero Attachment, render detached. The Reader retains ownership of its document and visible render tasks. The borrower reads a page and creates its own render task and canvas. A file replacement withdraws the old borrow. [Borrow tests](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/borrow.test.ts)

Check the shared PDF size limit before reading a Reader document's bytes. Compare the exact Reader document bytes with a stable, bounded file read. Remember the verdict weakly by document proxy and revision stamp. Recheck that the view still holds the same document after obtaining the page and after the crop. A failed proof or retired document uses detached rendering. Borrowed pages remain the Reader's responsibility. Cancelling a borrow stops waiting without cancelling the Reader's own work. The test harness uses fixed file revision times instead of wall-clock timing.

A queued render can see a PDF revision newer than its preflight stamp, so publish the evidence of the PDF actually rendered. A cache mutation that has started keeps its publication barrier through interruption. [Reader borrowing](../../../../packages/annotations/src/obsidian/excerpt-image/reader-borrow.ts) · [Borrowing tests](../../../../packages/annotations/src/obsidian/excerpt-image/reader-borrow.test.ts)

Only adjust scheduling for the render task the crop created. Withdrawing a Reader document during its page read prevents that page from drawing. Withdrawing it during a render can let that task finish, but only the detached replacement can publish or count as rendered. Reader render tasks remain untouched. Cancelling a borrow that is still waiting for its page releases the crop's slot without waiting for Reader work. The route tests use a fixed canvas fixture to check ownership and cache identity. Decoded pixel parity is exercised separately by the end-to-end comparison. [Borrow route tests](../../../../packages/annotations/src/desktop/excerpt-image/renderer-borrow.test.ts) · [Pixel parity](../../../../packages/e2e/src/excerpt-acceptance.ts)

Use the same crop-box-aware rotated viewport for image bounds and ink paths. Include round-cap spill when cropping small ink paths and draw isolated points as round marks. The geometry tests use independently worked page transformations.

### Reader-backed excerpt proof

Use the Fixture's actual PDF, Annotations, and Literature Note for the
reader-backed case. In a run without Paired Zotero, probe the key used
for write capability instead of attempting a saved write. The
repository indexes verified sources by Attachment. An Annotation key
can yield a read-only or server-changed answer even when its Attachment
is writable.

Drive Refresh through the actual gesture to re-arm the converted
display. For cold and warm multi-PDF reads, group excerpts so the
second request for each PDF uses the resident document. This measures
the running app alongside the Node model. Verify the durable lossless
WebP container through its RIFF, WEBP, and VP8L markers. Verify that
reimport pools outcomes into one summary notice.

[Reader-backed cases](../../../../packages/e2e/src/annotations-excerpts.e2e.ts)

Give the detached Annotation Image command case its own Fixture and
vault so other rebuilds cannot relocate the linked PDF. Remove the
local PDF from its expected path to exercise Zotero's fallback.

[Detached image case](../../../../packages/e2e/src/follow-mode.e2e.ts)

### Borrowed and detached crop proof

Use the running app's renderer counters and the real Annotation
Card publication path. Open the Fixture Attachment without an
Annotation View so one reader-backed crop accounts for its PDF
work. It borrows the reader document without opening or loading a
separate one, and leaves the current page and rendering intact.
Decode the result and warm the cache for the excerpt types the
import template embeds. The Child Note import must reuse those
bytes, without new PDF work, for the durable asset it links.

Pin the Annotation View and isolate an ink Annotation by its
unique color. Close the reader while the card still needs its
image. Use the actual Refresh gesture and hold the detached load
so the old image remains observable. The same request must produce
identical decoded pixels and size from either route. Wait for
publication rather than a different URL. The card can keep a live
URL for unchanged pixels. If it replaces it, release the old URL
only after it has stopped painting it.

[Reader-backed crop and import](../../../../packages/e2e/src/excerpt-acceptance.ts)
