---
status: accepted
---

# Zotero Types projects the pinned schema

The TypeScript maps in `packages/zotero-types/src/` are generated from the
committed `zotero-schema/schema.json`. Its version is the source of truth.
Run the package's `generate:fields`, `generate:field-labels`,
`generate:item-types`, and `generate:csl` scripts when updating those maps.

- Field aliases use the schema's `baseField`. Field and item type labels come
  from the bundled English and Simplified Chinese locales. Item types keep
  schema order and their fields keep Zotero's item pane order. The top-level
  picker omits annotations, attachments, and notes.
- The CSL projection preserves the schema's ordered text field candidates
  under their raw Zotero names. A consumer takes the first candidate with a
  value, as Zotero does. The single-field template map uses the first candidate
  and exposes `abstractNote` as `abstract` and `publicationTitle` as
  `containerTitle`. Date and creator maps keep the schema's orientation.
  The reverse item type map covers all candidates because each Zotero type
  belongs to one CSL type.
- The fixture generator checks that its pinned corpus and committed schema
  use the same version. It verifies the digest of each commit-pinned native
  item and CSL-JSON source before parsing, then pairs the original records by
  top-level item type. The fixture records the Zotero release, the date of the
  reviewed upgrade, and the exact source commits and hashes.
- Generator-only imports read the pinned JSON from the package. The
  `no-restricted-imports` directives on those imports preserve that build-time
  boundary while consumer imports use the package's exported paths.

## Scoped dependency substitutions

The pnpm workspace substitutes registry epubjs and the committed
pdf.js fork for two GitHub dependency specs of `zotero-types`.
The substitutions are scoped to that parent so the names keep their
own resolutions elsewhere in the graph. This lets installs keep
`blockExoticSubdeps` enabled.
