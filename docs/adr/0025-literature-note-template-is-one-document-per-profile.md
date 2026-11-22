---
status: amended by ADR-0031, ADR-0050
---

# The Literature Note Template is one document per Profile

> **Amended by ADR 0055.** `cite` / `cite2` no longer stay as slot files: one Citation Template document replaces them, and partials become `zotlit-partial.<name>.md` files.
>
> **Amended by ADR 0031.** The document is the Profile itself, not a file a Profile points at: its manifest carries the Profile ID, label, and the five bindings as values, and the Template Pack install lifecycle is deleted — a Profile document is discovered in place, never installed.

ZotLit v2.1 stored a Literature Note's template as two files — `note` (whole body on create and overwrite) and `content` (the Managed Region body on update) — plus a `filename` slot file and a settings-held frontmatter field list. An earlier edition of this ADR unified the pair at the presentation layer only, because zero migration was a hard constraint (aidenlx/zotlit#839). Adopting Literature Note Profiles lifted that constraint: each Profile carries its own template set, a per-Profile file pair would multiply the fragment files, and a one-time format migration was accepted (aidenlx/zotlit#841 grilling). We decided the Literature Note Template becomes **one template document per Literature Note Profile**: manifest frontmatter (identity and configuration defaults, including the filename rule — since ADR 0031, the Profile ID, label, and bindings themselves) plus a note body containing the Managed Block.

## The Managed Block

`{% managed %} … {% endmanaged %}`, supported in both Liquid and Eta. It is a **self-contained sub-template**: it renders in isolation, and variables assigned outside the block are not visible inside it, so an update-time render is identical to a create-time render — the property that makes managed updates correct. On create it renders in place within the body; on update it alone re-renders to refill the note's `%%zt-managed%%` Managed Region. The note-side format does not change. Zero blocks is a permitted degenerate form — a static body whose updates touch frontmatter only, reported by a named notice. Two or more blocks fail validation: the render refuses with a diagnostic that names the duplicate.

## Shape rulings

- The body may `{% render %}` shared partials by name. Partials are vault-global — one flat namespace, no per-Profile partial resolution — and a Profile bundles its transitive partials when distributed. The distribution unit is the document itself: envelope fields from the Template Pack draft (aidenlx/zotlit#842) live in the manifest, and a partial-free Profile shares as one copy-pasteable file.
- `cite` / `cite2` stay vault-global template files outside the Profile. The `filename` slot retires into the manifest.
- One rendering language per document; Eta stays behind the JavaScript Templates gate.
- The old format keeps working as the legacy default Profile until a prompted one-shot converter migrates it. The converter's output must render byte-identically for the same item, verified in memory by the Workbench before any write; converted files go to Obsidian's recoverable trash.

## Considered options

- **Presentation-only unification over the two-file pair** (this ADR's earlier edition): correct under the zero-migration constraint, but under Profiles it multiplies fragment files per Profile and leaves the frontmatter field list outside the shareable artifact.
- **Per-Profile folders of the existing slot files**: answers the fragment complaint by grouping instead of merging, and keeps two authoring objects per Profile forever.

## Consequences

- `packages/templates/` and the note-feature pipeline reopen for this work, reversing the earlier edition's off-limits ruling; aidenlx/zotlit#862 and aidenlx/zotlit#863 re-scope against the document format.
- The frontmatter field spec moves into the document's manifest. Its expression design (engine evaluation, no private YAML control-flow syntax; must solve aidenlx/zotlit#641 and aidenlx/zotlit#645) is a separate design ticket and gates the format spec's ratification.
- Note-side coupling stays minimal: `zotero-key`, the Profile stamp, and the `%%zt-managed%%` markers are the whole contract between a note and this format.

## Verification during conversion and editing

Compare the legacy and synthesized output before persisting a converted Profile. Normalize the create output's trailing line break to the current note-writing convention before comparing. Carry legacy field expressions across without rewriting them. Report fields that fail on the verification item so the Profile editor can repair them. A manual body writes its content at creation. A managed body wraps the isolated block in a Managed Region. Keep an indented legacy insertion inline so a line-owning tag does not remove the author's whitespace. Return the line break owned by the closing tag after inserting the Managed Region.

Stream candidate Items from the active Library Scope. Select the first candidate whose note and filename data build, and continue if the fold needs Annotation data that the candidate lacks. Retain the first base candidate so the caller can distinguish a missing Annotation from a missing verification Item. Read the one-item Citation before rendering and supply the same input shape as the citation suggester. Use the Workbench's write-free render path. [Migration verification data](../../packages/notes/src/desktop/template/migration-data.ts)

Offer the migration from the Welcome View when any legacy file remains, including a Citation Template slot or a bare partial. Verify each fold before writing. Report editable template faults with their source files. Keep the Eta source of a mixed-language citation pair. If creating the new documents fails, roll back only documents created in that pass and preserve the legacy files. After the documents are active, record legacy files that resisted trash so the researcher can retry cleanup.

Unload stops the waiting caller, while conversion finishes the writes, cleanup, and final settings flush. The migration tests wait for that flush and check that the new documents and stored result agree. Register each test service with its disposable resources as soon as it starts so a partial startup can still unwind. Test late vault inventory without create events because Obsidian can populate the initial files that way. [Migration](../../packages/notes/src/desktop/template/migration.ts) · [Migration tests](../../packages/notes/src/desktop/template/migration.test.ts)

Compile the body, Managed Block, annotation section, and filename before save. Compilation validates source without evaluation. Its intended contract preserves the registry. [Registry collision follow-up](https://github.com/aidenlx/zotlit-repo/issues/79)

The synthesized manifest stamps the same contract version as the Zotero data contract. The engine has no dependency on the database package, so the format-version gate checks the values in both packages. The Workbench uses the stamp to reject a Profile saved against a different contract.

## Template context assembly

The filename root reads only the Item's own data and facets. Give filename resolvers a separate copy with inert note path and link members so a filename template can use those members without re-entering path resolution. An unresolved Child Note link falls back to Zotero and displays the title or Item key. Sort related Items by locale-aware title with untitled Items last. Use the stored title directly so articles and Zotero's display-title fallback do not alter the order.

Normalise empty field values to absence, and prefer built-in fields when a custom field has the same name. Keep Zotero's canonical field names alongside CSL-inspired aliases. Attach each preview's non-enumerable string conversion after spreading the data, so spreading cannot drop it. An Annotation's parent getter in a Note points to the finished Note root and is read only after that root is assembled.

A generated relative note path drops suffix markers for its first candidate. Only retry a collision when the template supplied a suffix marker, and fill it with a fresh alphanumeric ID. A flat filename sanitizes a slash as part of one segment instead of creating a folder. Surface a localized failure if sanitizing leaves no usable name.
