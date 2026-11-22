---
status: accepted
---

# Fixture PDF generators produce stable bytes

Build the authored Fixture PDFs from fixed inputs in `packages/scripts/lib/fixture/assets/`. Use a classic cross-reference table and uncompressed Latin-1 streams. Compute object and stream offsets from byte counts. Write stream dictionary entries and trailer additions verbatim so the caller controls the spaces around them. Keep the excerpt generator's PDF 1.7 binary header and final newline to reproduce its committed bytes. Use fixed identifiers and timestamps where the file format requires them.

Keep the corrupt excerpt's cross-reference offset invalid and the encrypted excerpt's credentials fixed. These files provide stable unavailable outcomes. The External Annotation highlight covers the first line alone and has no Zotero key, so Zotero imports it as an External Annotation and keeps it read-only.

The parity layout puts a Differences-encoded ligature line beneath the left column and a rotated baseline to the right of both columns. This separates the layout cases spatially. The scanned parity file has a single image XObject and no text operators, so extraction returns an empty character array.

- [Excerpt rendering fixtures](../../packages/scripts/lib/fixture/assets/excerpt-rendering/NOTICE.md)
- [External Annotation fixture](../../packages/scripts/lib/fixture/assets/external-annotation/NOTICE.md)
- [Sort Index and Page Label parity fixtures](../../packages/scripts/lib/fixture/assets/pdf-parity/NOTICE.md)

The Sort Index and Page Label parity PDFs are direct assets. One
exercises rotation, ligatures, and columns, and the other is a scan
with no text layer. Excerpt acceptance assets also stay out of the
database counts. Check their rendered pixels and geometry against
independent values. The external highlight is embedded in the PDF so
Paired Zotero can import it as read-only. Demo database annotations
use positions recorded from Zotero. The Spec also includes the
imported External Annotation and a duplicate position for the
template lesson. Reuse the same cached image for matching page and
rectangle. Keep the docs highlights on the text boxes in PDF points.

Generate the Mark Landing page because it needs absolute Attachment
paths. Use the shipped Anchor codec so the generated links work in
the reader.
