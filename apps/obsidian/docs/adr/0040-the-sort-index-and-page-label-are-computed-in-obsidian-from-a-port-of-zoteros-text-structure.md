# The Sort Index and Page Label are computed in Obsidian from a port of Zotero's text structure

Only Zotero's reader computes a PDF Annotation's Sort Index and Page Label; the backend stores whatever string the Zotero Local API receives, and the reader recomputes the Sort Index only when the user moves that mark. The offset field is the index of the nearest glyph in the page's Structured Characters, so it depends on Zotero's own pdf.js extraction, dedupe, and line grouping, and the Page Label comes from a heuristic over the same characters. Obsidian's bundled pdf.js already exposes per-glyph rectangles through `includeChars`, so ZotLit carries a port of the `structure.js` and `page-label.js` modules from `zotero/pdf.js` (Apache-2.0, pinned to one reader commit in the file header), feeds it Obsidian's glyphs through four filter rules — drop space glyphs, drop control characters, NFKD-normalize `c`, keep `u` raw — and computes both values in Obsidian at creation. Normalizing `c` means Zotero's own `normalizeChar`: NFKD, then the 22-entry table that recomposes the common accented Latin letters, because plain NFKD leaves a decomposed `è` where Zotero writes a precomposed one. A page with no characters gets offset `000000` and the geometric `top`, as Zotero's reader does. A committed golden test compares the port's per-page characters and Page Labels index for index against Zotero's fork on the fixture PDFs; the port is refreshed only when that test fails against a newer Zotero.

## Considered Options

- **Ask the running Zotero reader for `getAnnotationMeta`** (rejected): it needs a reader open on that Attachment at the moment of creation, which is the exception on a path whose point is annotating in Obsidian, and an inbound channel to the Companion that ADR 0036 refused.
- **Emit offset `000000` always** (rejected): the write succeeds, but every ZotLit mark sorts above every Zotero mark on its page, in Zotero's sidebar, item pane, note-from-annotations, and ZotLit's own Annotation View, because the offset field outranks the top field.
- **Catalog page labels only** (rejected): a journal article with no `/PageLabels` shows `1` where Zotero shows `233`, and the label reaches citations.
- **Port the text structure and the label heuristic, guarded by a parity test** (chosen).

## Consequences

- Structured Characters are computed lazily per page and memoized per Reader Session; the label pass runs in idle time after the document loads and is awaited only when a creation arrives first.
- A Sort Index is never rewritten after creation. Colour and comment edits send none; ordering repairs are left to Zotero's reader, which recomputes on drag.
- Parity means parity with the pinned fork. Drift across Zotero versions is accepted, as Zotero's own import worker already produces it.
- The parity fixture needs PDFs beyond `rougier-2014`: one that enters the rotation, ligature, or multi-column branches of the line grouping, and one scanned page with no text layer.

## Amendment: a Geometry Edit recomputes the Sort Index

ZotLit computes the Sort Index at creation and recomputes it on a Geometry Edit, the one edit Zotero's own reader recomputes it for. The new value comes from the moved position through the same text structure call a creation makes, from the unrounded geometry, and travels in the same patch as the position and, for a highlight or underline, the quoted text. The Page Label is not recomputed, because a Geometry Edit keeps the page. This replaces the consequence "A Sort Index is never rewritten after creation": colour and comment edits still send none, and a Geometry Edit is now the one write after creation that sends one.

## Mapping the browser selection

`selection-capture.ts` reads the existing browser text layers and passes
UTF-16 offsets, layer text, and rectangles to the text structure port. It
clamps the selected range to each text layer. Measuring only selected text
nodes prevents a range across a page break from capturing whole-page boxes
for the canvas or end-of-content elements. The code uses the constants on
the Range instance so clipping also works in pop-out windows.

The client rectangles clip to the page padding box and convert back to PDF
points through the inverse of the PDF.js viewport matrix. A rectangle with
no area after clipping draws nothing. The tests cover zoom, quarter-turn
rotation, and page borders. The PDF adapter supplies the fork's per-glyph
text content, page boxes, and catalog labels.

[Zotero range measurement](https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/native-text-selection.js#L572-L609)
[PDF.js viewport](https://github.com/mozilla/pdf.js/blob/v5.3.31/src/display/display_utils.js)
[PDF.js matrix utilities](https://github.com/mozilla/pdf.js/blob/v5.3.31/src/shared/util.js)

## Text structure, labels, and range parity

Each Reader Session shares an in-flight page extraction and keeps successful
results for synchronous text rotation. The close signal releases pending
Sort Index and Page Label requests when PDF.js stops answering. A blocked
Sort Index read rejects and a blocked label read can use the page number.
The host starts one shared Page Label pass when idle. A failed extraction
leaves the memo so the next request reads the page again, as the amendment
"a failed page read is read again" states.
[Failed read retry](https://github.com/aidenlx/zotlit-repo/issues/68)

Structured characters use PDF page coordinates. The upstream grouping
deduplicates glyphs by character and rectangle, mutates the supplied records,
and sets offsets that index the resulting page. The caller stamps page
indexes. Line rectangles stretch to the line height or width. Sort Index
uses the rectangle with the largest right edge, following Zotero's code.
Ties keep the earlier rectangle. Ink uses the bounds of its points. The
first glyph at the minimum rectangle distance wins. A page without text
uses offset zero, keeps the geometric top, and logs once per session.

The printed-page heuristic reads the first 25 pages and extends the run
using the catalog, extracted Arabic numbers, or page numbers. The core
page shim uses zero-based indexes. The new annotation can continue the
latest usable annotation's manual numbering when the extracted numbers
and page indexes advance by the same amount. The first eligible prior
annotation decides whether to continue the run. Numeric strings with
leading zeroes and page ranges follow Zotero's coercion and parsing.

Browser offsets count UTF-16 code units. The alignment uses NFKD code
points after dropping whitespace. An offset inside a surrogate pair
uses the previous boundary. The upstream alignment maps DOM boundaries
to character boundaries, with distinct start and end mappings. The
quoted text ignores whitespace and discretionary line-end hyphens when
checked against the browser selection. If alignment fails that check,
the selected text-node rectangles give a second way to place it. A
selection keeps at most two adjacent pages with characters. The second
page's rectangles go into the stored position and a space joins its
text to the first page. Each line's rectangle is the union of its
inline rectangles, rounded to three decimals.

A stored range recovers its ends from glyph centres in the stored
rectangles. A pointer crosses the glyph boundary at its midpoint along
the text direction. A horizontal step moves one character and a
vertical step chooses the closest glyph on the next or previous line.
Ties follow Zotero's glyph order. The adjustment keeps the start on
the annotation's page and permits the end on the next page. A pointer
drag past the anchor leaves one character. A collapsing step is refused.
A drag onto the same characters keeps the original stored geometry.
Text rotation comes from the most frequent rotation under the rectangle,
with the greater rotation winning a tie.

The golden oracle loads the pinned Zotero sources directly. Its module
hooks reproduce webpack aliases, and its browser stubs and worker-source
value allow Node to load pdf.js before extraction. The extractor copies
the glyphs before structuring mutates them. The oracle has its own
Page Label shim so it can check the implementation independently.
The test requires clean checkouts of the pinned root, Reader, and
pdf.js revisions, and reports why it skips when those are unavailable.
It uses identical Structured Characters as inputs when checking
selection against the Reader and compares the recorded Sort Index
strings of the six annotation types on the Fixture's RGRPDF24 attachment.
The special Fixture PDFs must still cover the rotated and multi-column
layouts they were generated to exercise. Parity tests allow the port's
deliberate range-edit differences and compare only the text when a drag
keeps the existing geometry.

[Zotero selection code](https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js)
[Zotero native text alignment](https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/native-text-selection.js)
[Zotero view behavior](https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/pdf-view.js)

The port has hand-written TypeScript declarations for the used portions
of the copied JavaScript. TypeScript sees those narrow interfaces while
the bundler reads the copied bodies. The standalone extractor writes JSON
to stdout. Run it with `node --import ./oracle/register.mjs ./oracle/extract.mjs <file.pdf>`
from the package and set `ZOTLIT_ZOTERO_CHECKOUT` to the pinned checkout.
The oracle formats glyph coordinates at six decimal places in its
diagnostic fingerprints. Its JavaScript helper has a structural
declaration outside the package's source aliases.

Carry the stored page label and Sort Index through both sources. Narrow the stored position JSON during the read so a redraw can use the parsed value. A geometry undo restores both the position and its Sort Index. A restore supplies the stored index because the Zotero create request requires it. A text-only edit leaves the geometry and Sort Index unchanged. [Repository model](../../../../packages/annotations/src/obsidian/annotation-repository/core/model.ts)

Send the PDF position as a serialized JSON string. Preserve second-page rectangles for a cross-page selection and omit unsupported selectors from write proposals. Round coordinates and ink width to three decimal places. Preserve a text box's font size and counterclockwise turn. Keep Quoted Text specific to highlights and underlines. The writer checks the serialized position limit before sending a request. Normalize color values to lower-case hexadecimal as required by Zotero's shared color setter. The wire test adds fourth decimal places to the Fixture underline to make the rounding visible. [Request builders](../../../../packages/annotations/src/obsidian/annotation-repository/write.ts) · [Wire tests](../../../../packages/annotations/src/obsidian/annotation-repository/write.test.ts)

- [Zotero item.js L4512-L4518](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4512-L4518)
- [Zotero item.js L4586-L4605](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4586-L4605)
- [Zotero utilities.js L686-L712](https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/lib/utilities.js#L686-L712)
- [Zotero item.js L4506-L4510](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4506-L4510)

The image Geometry Edit fixture extends the right edge of the source rectangle by 40 points and sends the Sort Index computed from the unrounded position. Keep Sort Index and Page Label out of recolor requests.

A save from the Quoted Text editor sends only the text and version. A Zotero-side Geometry Edit can change that text, so a draft can conflict even when the researcher made no geometry change.

### Geometry edit input

Use one Geometry Edit save path for a released pointer and a keyboard edit. Shift moves a text range end, and Shift with the host Mod key moves its start. Shift resizes an image or ink mark, and Alt nudges it. Ignore a new keyboard edit while an adjustment is active. A pointer on a grip captures the drag and suppresses browser text selection. Re-read the page box on movement so a zoom or scroll does not displace the adjustment. Place the start on the original page and the end on the nearer of the original and next page. Ignore obsolete range replies and retain the last valid position when a point has no range. A reply from a drag cancelled with Escape must leave a new drag on the same handle alone. Wait for the final range reply on release. A view that closes before placement completes sends no write. [Mark Selection](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/selection.ts)

The geometry tests use a Letter page with its PDF origin at the bottom left and its client origin at the top left. Test the bordered content box independently of its border, and test a quarter turn where PDF x and y map to client y and x. The adjustment completion and pending write state let tests await the released geometry.

Snapshot the browser selection and its page boxes when the gesture settles, before awaiting text structure. Compute placement metadata from the unrounded position. Align Page Labels to the prior PDF Annotations in the order the source returned them. Skip prior records with no PDF page. The selection test provides client rectangles on the Range prototype so clamped clones give the same layout data. [Creation placement](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/creation.ts)

Start an adjustment from the selected record's confirmed editable position. Suppress redundant geometry moves and release without a write when the stored position would be the same. Carry Quoted Text along with a proposed text range. A released adjustment or image capture stops accepting pointer moves. Hold a large enough capture as a saving preview and show no comment editor for it.

Read the active document on each text structure request. Reuse its per-page memo and schedule one Page Label pass at idle. A create that arrives first joins the same pass. Closing the structure cancels its scheduled pass and releases reads still waiting for pages or labels. Search painted pages for browser selection geometry. A selected range starts with upright handle rotation until its Structured Characters arrive. Read them on demand and patch the selected mark to align the handles with the text.

Check a stored rectangle against the Sort Index from the text
structure. Dragging the bottom-right handle can keep the top
edge unchanged. Lowering a rectangle moves its top edge
toward the PDF origin and can change the top component of its
Sort Index. Use the stored geometry and confirm the index
through the Local API.

[Paired index checks](../../../../packages/e2e/src/paired-mark-handles.e2e.ts)

For a range edit, wait for the text layer and choose a point
inside the intended word. A release past the midpoint of
punctuation can include it. Compare text across line and
word boundaries against Zotero, including the space added by
the text structure. Recompute the Sort Index from the
resulting rectangle or range in all geometry cases.

[Range and geometry proof](../../../../packages/e2e/src/paired-mark-handles.e2e.ts)

## Amendment: a failed page read is read again

Accepted 2026-11-23 with [#68](https://github.com/aidenlx/zotlit-repo/issues/68) and [PR 241](https://github.com/aidenlx/zotlit-repo/pull/241) (`79ba097d0`). Two caches hold a page's text: the page memo of the text structure session and the Reader's per-document text map, which the session reads through. Each cache deletes an entry when its read rejects. A pending read stays shared, and a successful read stays cached. The session eviction alone retries no real read, because the Reader's map would return the same rejection, so both caches evict. The eviction has no identity guard: no path replaces a pending entry, and no read starts after the Reader clears its map at retirement.

Accepted limits:

- The page-proxy cache of the vendored pdf.js build keeps a rejected `getPage`. A failure there still blocks a retry of that page until the document reopens.
- Each cache holds its own copy of the eviction rule, about three lines. A shared helper would add a workspace dependency to the Reader package.
- The Page Label heuristic, a verbatim copy of Zotero's code, catches a page failure and returns no labels. The session then uses physical page numbers until it ends.

The maintainer kept the fix on 2026-11-23. The failure is rare and unmeasured: it needs a temporary extraction error in the PDF worker on a live document.
