# Excerpt cache identity is shared across verified Annotation Sources

An Excerpt Image generated from a Zotero Local API snapshot can be requested again during a database-backed note operation. Both requests share a generated-image cache identity when their sources are verified as belonging to the same Zotero database and their source scope, Library, Attachment, Annotation, rendering inputs, renderer version, and PDF engine match. PDF freshness retains the size and modification-time checks in [ADR 0049](0049-excerpt-images-use-zotlits-cache-and-renderer-before-zoteros-cache.md).

The selected Annotation Source continues to supply the complete snapshot used by each consumer. Cache reuse compares that snapshot's pixel inputs; it preserves atomic source selection and database isolation. Requests whose database equivalence cannot be verified retain separate identities.

This trades source-specific cache partitioning for verified reuse across viewing and note operations, avoiding duplicate PDF parsing and rendering for identical pixels. The identity change must preserve existing durable vault assets and their links.

## Update: the PDF engine is part of the cache identity (2026-11-20)

The cache identity names the PDF engine that drew the crop: ZotLit Reader's pdf.js, by its build, when the Reader is connected with a build ZotLit was tested with, and Obsidian's own pdf.js otherwise. A crop from one engine is not served for the other. A durable vault asset keeps its name without the engine: the name digests the identity without the engine and the image bytes, so the same request and bytes keep one file and link across a Reader toggle.

Use the inputs of the persisted Excerpt Image as the pixel baseline for a session's first read. [Repository state](../../../../packages/annotations/src/obsidian/annotation-repository/core/state.ts)

Compare a refreshed list's canonical pixel fingerprints with the previous published list. On the first read, compare with fingerprints from persisted Excerpt Images. A cache miss or unreadable image leaves the record on demand. A comment change, source switch, or repeated read with the same pixels sends no replacement event. A Zotero edit that changes pixels can be detected by a background reread after a Freshness Signal even when no view is open. The image consumer decides whether its store contains an image to replace. [Read and pixel-change tests](../../../../packages/annotations/src/obsidian/annotation-repository/service.reads.test.ts)

A database without a verified Server ID keeps a local source identity. Once the database and Local API are verified as the same source, both representations can share the same render and stored image.

Read source identity and parent Attachment from the same database Snapshot. If the data directory moves, the selected source cannot be verified, or a required read fails, publish no request for that selection. Treat an empty Server ID as unverified and retain local identity, including the database's source scope for copies. A complete request can represent any Annotation type, while the caller decides which types render images. Keep the durable asset ownership forms from before shared source identity. The generated cache can recompute old keys.

Hash only canonical request components and pixel inputs for the cache key. Keep the display identity and latest reference stable across versions and pixel edits. The release format-version check tracks the renderer version constant. Chromium identity tests use a deterministic substitute for Node's synchronous hash. Request tests exercise the actual SHA-256 path. [Identity contract](../../../../packages/annotations/src/obsidian/excerpt-image/contract.ts) · [Request resolution](../../../../packages/annotations/src/obsidian/excerpt-image/request.ts)
