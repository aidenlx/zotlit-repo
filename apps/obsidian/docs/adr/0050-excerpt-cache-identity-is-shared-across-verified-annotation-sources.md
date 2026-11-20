# Excerpt cache identity is shared across verified Annotation Sources

An Excerpt Image generated from a Zotero Local API snapshot can be requested again during a database-backed note operation. Both requests share a generated-image cache identity when their sources are verified as belonging to the same Zotero database and their source scope, Library, Attachment, Annotation, rendering inputs, renderer version, and PDF engine match. PDF freshness retains the size and modification-time checks in [ADR 0049](0049-excerpt-images-use-zotlits-cache-and-renderer-before-zoteros-cache.md).

The selected Annotation Source continues to supply the complete snapshot used by each consumer. Cache reuse compares that snapshot's pixel inputs; it preserves atomic source selection and database isolation. Requests whose database equivalence cannot be verified retain separate identities.

This trades source-specific cache partitioning for verified reuse across viewing and note operations, avoiding duplicate PDF parsing and rendering for identical pixels. The identity change must preserve existing durable vault assets and their links.

## Update: the PDF engine is part of the cache identity (2026-11-20)

The cache identity names the PDF engine that drew the crop: ZotLit Reader's pdf.js, by its build, when the Reader is connected with a build ZotLit was tested with, and Obsidian's own pdf.js otherwise. A crop from one engine is not served for the other. A durable vault asset keeps its name without the engine: the name digests the identity without the engine and the image bytes, so the same request and bytes keep one file and link across a Reader toggle.
