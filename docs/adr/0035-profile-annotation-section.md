# A final Annotation Section supplies each Profile's annotation source

The accepted [#940 contract](https://github.com/aidenlx/zotlit/issues/940)
keeps one Profile document in a fixed order: YAML manifest, note source,
and Annotation Section. The exact unindented standalone line
`--- zotlit:annotation ---` starts the required section, which continues
to EOF and can be empty. Both sources use the Profile's language. This
makes the annotation definition distinct from the Managed Block, whose
position controls output in the note.

The parser splits the sources before Liquid or Eta runs. The header has
the same meaning inside Markdown fences and engine raw, comment, or code
regions. Missing, duplicate, and unknown section headers are errors,
including an explicit note header. Splitting consumes only the header
and its following line break, when present. It preserves surrounding
source bytes and LF or CRLF line endings, with ranges into the original
document for diagnostics and edits. Rendered-output conventions remain
separate. The note source retains zero or one Managed Block, its isolated
context, and its existing line-ownership rules.

Every Profile render binds `annotation` to its own Annotation Section.
The shortcuts, native Liquid render and Eta include calls, and calls
from shared partials use that source with isolated Annotation Root data.
Note creation, managed updates, direct insertion, and Imported Notes
therefore use the applicable Profile's source. The binding lasts for that
render alone; other Profiles and generic named-template rendering keep
their own lookup. A manifest partial named `annotation` is a validation
conflict with a rename hint. Other partial resolution stays unchanged.

Export preserves both sources and gathers their reachable shared partials,
including dependencies from the filename template. The local section
satisfies annotation calls. Generated, ejected, and converted documents
use this layout. The released-v2.1 converter retains its independent legacy
lookup and byte-verification baseline. Profile formats remain unreleased,
so this replaces the development format directly. Profile selection,
stamps, inheritance, preview safety, and JavaScript consent are unchanged.

The Annotation tab from
[ADR 0041](0041-annotation-format-has-its-own-workbench-tab.md) edits the final
section independently of calls in the note. Edits use targeted source
edits, one undo history, and the invalid-draft rules of
[ADR 0032](0032-web-workbench-edits-one-source-document.md).
The Workbench work under [#863](https://github.com/aidenlx/zotlit/issues/863)
owns that UI implementation and its interaction tests.
[ADR 0037](0037-annotation-box-opens-on-the-annotation-it-produces.md) records
the earlier inline editor. ADR 0041 replaces that editor with an expandable
preview placeholder and a tab action. A note without a call retains the
insertion action recorded in ADR 0037.

This amends the annotation layout in ADRs 0027 and 0028 and the annotation
lookup in ADR 0034. Managed Block behavior remains as recorded. The fixed
layout avoids a general multipart format and engine-aware boundary rules,
at the cost of reserving one exact document header everywhere in the source.

The built-in annotation sections live in TypeScript so Node can load the package source without a bundler's raw-import extension. The default Annotation Link uses Zotero keys so the passage can open on another computer, including in Zotero itself. The quote includes a citation and a page locator when a page label is present. The live annotation block resolves the current note through `this`, so it also shows annotations added after the note was written.

## Annotation template data

A single Annotation render can read a citation lazily. Entries in a Note's annotation list omit that citation so listing annotations alone does not render them one by one. Convert an Annotation comment to Markdown only when the template reads it. String previews choose the excerpt, then raw comment, then type, so preview conversion does not invoke the lazy Markdown getter. Keep storage IDs and raw position out of the template contract. The derived page and parent attachment key provide the navigation data.

When the Annotation has a page, default the file-link fragment to both the page and Annotation Indexed Key so Obsidian can navigate to the page and ZotLit can place the Mark. Without a page, leave the default fragment empty. Explicit template arguments override the defaults. The host resolves attachment paths and excerpt-image links because the database code does not have the host's storage context. In the standalone annotation path, the parent's note path stays unresolved to avoid resolving a Literature Note while building its annotation.

## Annotation storage forms

Read PDF positions in the forms the Zotero reader writes. Ink uses paths in page coordinates. Free text carries a rectangle with font size and rotation. Rectangular annotations can carry continuation rectangles for the next page. Validate the free-text shape before the rectangular shape, because the general validator strips extra keys and could otherwise accept a free-text position without its font data. [Zotero PDF tool shapes](https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/pdf/pdf-view.js#L2516-L2545) [Zotero position types](https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/common/types.ts#L68-L79)

EPUB positions use a Fragment Selector with an EPUB CFI. Snapshot positions use a CSS Selector with an optional text-position refinement, or an independent Text Position Selector. [Zotero reader selectors](https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/dom/common/lib/selector.ts#L10-L46)

Use the stored Annotation tag names because every source can supply those names. The excerpt can carry Zotero's permitted inline formatting. Treat the sort index as text because Zotero pads its components. Display numeric and Roman page numbers and their ranges with a page prefix, and display named labels on their own. Cache-image links apply to Image and Ink types and use the personal or group cache path and Annotation key. [Zotero Annotation data and cache](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L31-L62) [Zotero sort index](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L4257-L4277) [Zotero excerpt editor](https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L4)

## Stored Zotero colors

Map Annotation colors from the reader swatches and the Citavi import colors. Tag colors are a display overlay, so they do not affect the stored Annotation color. Unknown import colors can remain unnamed. The first five reader swatches came from Zotero 6, and Zotero 7 added three. Citavi can also write orange and plum. [Original reader swatches](https://github.com/zotero/reader/blob/4ebfe4b10fef885190ec3fe061f75c47cbfdc02f/src/lib/colors.js#L3-L9) [Expanded reader swatches](https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/common/defines.js#L2-L11) [Citavi importer](https://github.com/zotero/zotero/blob/451d96a8240bbb607a220f949673d6bc704bb58d/chrome/content/zotero/import/citavi.js#L117-L146)

Keep separate palettes for note highlights and note text. Highlights use half opacity and serialize through Firefox as RGBA, while text uses opaque RGB. Accept legacy hex and normalize to the hue before selecting a name. The palettes share names while their actual hues differ. [Note editor palettes](https://github.com/zotero/note-editor/blob/20ce6e9505512e27c965d96221e8ac634f3d99be/src/core/schema/colors.js#L2-L22) [Note editor highlight serialization](https://github.com/zotero/note-editor/blob/20ce6e9505512e27c965d96221e8ac634f3d99be/src/core/schema/marks.js#L127)

Refuse a Profile document that is missing the required Annotation Section. A documentless Profile can use the bundled default because it has no document to validate.

Render Copy Citation through the same page-pinned citation path as `zt.citation`, from one Annotation Sources read. It never imports an Attachment. For annotation insertion, use the captured card and read its parent because a card from the Local API can arrive before Zotero writes its row to SQLite. Validate the captured database identity and data directory before using the excerpt. Require the destination to remain valid through preparation, and render only after the image outcome is durable. Cite the passage with its Durable Annotation Link so the inserted note does not depend on the current machine's file path.

Share synchronous Annotation resolvers between note composition and batch rendering from already-read Annotation Sources. Direct attachment links use the source filename and anchor to the page and Annotation when available. A caller can override the link label and anchor. Return no link when the source path is unavailable. Direct links bypass Attachment Import, while the excerpt-cache fallback uses the destination note's attachment decision and queues approved copies. Resolver tests use a decision port that blocks copies. [Annotation rendering](../../packages/notes/src/desktop/template/annotation-render.ts)

### Static listing fixture

The listing Profile places a static Annotation listing in a
Managed Block where the Default Profile normally uses a Query
Block. Use it to check rendering into the note body and refilling
on update. Restore the Default Profile first when the test vault
already has a customized document.

[Listing Profile fixture](../../packages/e2e/src/listing-profile.ts)
