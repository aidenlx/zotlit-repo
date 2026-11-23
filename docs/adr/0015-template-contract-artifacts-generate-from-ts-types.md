# Template contract artifacts generate from the TS types via a frozen TS 6 extractor

The `zt` template contract was described in three places — the hand-written TS
types in `packages/db/src/lib/context/`, the hand-maintained docs reference
tables, and (planned) the Template Workbench's JSON Schema — and they already
disagreed (`zt.citation` documented but untyped; the annotation `type` enum
closed in docs, open in code). We decided the TS types plus their JSDoc are the
single source of truth: a ts-morph extractor emits a committed contract IR, and
emitters generate the JSON Schema (per-item-type branches from
`zotero-schema/schema.json`), the docs reference page, and the artifacts the
Workbench CLI serves. A CI check verifies regeneration is clean, so the copies
cannot drift.

The extractor's parser is deliberately **not** the repo's TypeScript. The
catalog pins TypeScript 7 (the native Go port), which ships no programmatic API
until 7.1; ts-morph vendors its own frozen classic TypeScript 6.0.2, and that
vendored copy is the effective parser. Do not add a `typescript` dependency to
"align" the versions — it would be a no-op. Both compilers were verified to
check `packages/db` identically, and TS 6's maintenance freeze is a stability
property for committed-output codegen: a syntax gap fails loudly as a parse
error in the CI regeneration check, never as silently wrong output.

## Considered options

- **ts-json-schema-generator (schema-as-IR)** — maintained and capable, but a
  JSON Schema cannot carry what the docs emitter needs (per-template
  availability, helper filter hints, anchors), and replacing the open item-field
  index signature is cleanest in an IR we own.
- **TypeScript 7 `./unstable` API** — works today, but 7.1 ships a new and
  different API, so adopting it buys a guaranteed rewrite to avoid a
  low-probability one.
- **valibot schema-first** — inverts the whole `packages/db` context-type layer
  for no added fidelity.
- **TypeDoc `--json`** — docs-capable, schema-hostile, version-drifting model.

## Exit triggers

Migrate off the frozen parser when any one fires: the CI regeneration check
fails with a parse error (not a diff); ts-morph ships TypeScript 7 support
(then it is a version bump); or TS 7.1's stable API becomes necessary for
richer type resolution. If forced before ts-morph is ready, repoint the same
extraction at the built `dist/**/*.d.mts` declarations — tsdown preserves JSDoc
there, and declaration-file grammar moves far more slowly than full TypeScript.

## Hand-written additions to the generated reference

The Template Contract supplies the generated reference. Two sections
also include hand-written MDX partials. The field aliases and the
imported-note frontmatter guidance live beside the generated page,
and `apps/docs/src/lib/template-contract/sections.ts` names them in the
section model. The docs build expands those references, so updating the
generated page and editing either partial are separate operations.

The docs generator uses the committed Template Contract IR for type descriptions and the page template in `apps/docs/src/lib/template-contract/sections.ts` for framing. Render unions of string literals as their options and fail generation if an unresolved JSDoc link would reach a reader. The Query functions generator combines the published Query Schema and its function registry with page framing, then runs the repository formatter so the generated page matches the checked format.

The docs contract table and surrounding generated prose share the same page model and committed IR. Markdown expands every detail as GFM because a Markdown row has no interactive expander. The HTML table adapts the Fumadocs Base UI type-table port with ordered, labelled details and prefixed names. Extend the section anchor with the row name for direct links. The contract has no default or deprecated fields for this table to render. Generated paragraphs and inline runs have no separate ids, so the HTML renderer keeps their stable source order as keys.

Generated prose may include literal Markdown code spans. Validate prose so the MDX compiler does not treat a brace or angle bracket in the surrounding text as an expression or element opener. The validator needs Markdown delimiter boundaries to distinguish prose from literal code. [Code span validation follow-up](https://github.com/aidenlx/zotlit-repo/issues/114)

## Shared reference model

The Template Contract page model is framework-free. MDX, React, and GFM derive their sections, rows, examples, and links from the same contract IR. The generator builds the model and commits its sections as JSON, and the React and GFM tables read that JSON. The 2026-11-23 amendment gives the reason. The section registry supplies fixed and included prose after the contract description. Its anchors preserve the handwritten page's public links. Fail generation when a reachable named type has no section. A section can list literal options, an Item Type field map, or tables for multiple object types and object union variants. Multiple tables use ordered captions. Link targets and rows share the same table ids, and inherited references can point back to the already emitted root section.

Flatten wrapped JSDoc lines within each paragraph and preserve paragraph breaks. Keep code spans as code. Resolve type links to their sections, named members to their rows, and bare members relative to the owning type. Leave unresolved targets as code. The collapsed row shows a compact type, and the expanded row has the complete type and helper details. See referenced types through arrays and nullable unions. Put parentheses around a function signature in a union to preserve the return type. Derive sample access, calls, and Liquid filters from the section sample and helper signature. Retarget only the intended example accessor for inherited members. The current substitution also changes matching literals. [Template example follow-up](https://github.com/aidenlx/zotlit-repo/issues/115)

The GFM edition expands row details inline because it cannot offer the HTML disclosure. Escape table-cell pipes even inside code spans, and keep each row on one line. Render normalized paragraphs separately and validate each generated prose run. The Query reference reads the published Filter Expression registry through the Node-compatible package entry and groups methods and properties by receiver in schema order. Give each group an anchor, render signatures as code, and let missing descriptions fail generation.

Declare each resolved Annotation type as an explicit union member so the extractor can read the description before its union separator. A compile-time equality check keeps those members aligned with the numeric Annotation type mapping and the unknown fallback.

Retain Zotero's raw multipart date alongside its interpretation. Treat a missing month as year precision, and reduce an invalid calendar day to year-month or year. A legacy raw string remains available when the multipart pattern cannot read it. Give interpolation a non-enumerable string form so it can display the date while structured transport keeps the data fields. The date's parsed value remains available for locale formatting. [Zotero multipart date pattern](https://github.com/zotero/utilities/blob/fbc4d6ad1c947035404db4321912ed46fb113380/date.js#L668)

Preserve the raw Extra field for interpolation and parse the first separator of a valid named line so later separators stay in its value. A language parser preserves the raw stored value and distinguishes recognised language names, canonical locale tags, and free text. Give it the language-name lookup and optional UI locale from the caller so the database layer can use it on any host.

## Extraction and schema invariants

Build a named definition only for a declaration inside the package. Inline anonymous shapes and reject collisions between distinct declarations or generic instantiations that would use the same definition key. Register a named type before walking its members so a cycle can resolve to a reference. Strip undefined from JSON types and mark members that admit it as optional. Keep the null branch last for readability. Extract the exact helper signature from the written syntax so optional parameter markers survive. Functions without a member name cannot become helper markers. Ignore non-enumerable string coercions.

The last JSDoc block supplies the description and its tags together. For literal unions, read options in declaration order and read the comment in the trivia before the union separator because the checker normalizes order. Read an index signature's own description first, then look up its base interfaces. A documented union option gets its own schema branch so the description stays beside the literal. Apply a member's own description before type-level fallback text. Keep the item-fields index description when expanding the fields by Item Type.

Namespaced tags may appear once per helper. The filter tag names one snake-case Liquid filter. The inert tag is empty and permits the resolver to leave the helper inert. An example tag contains one fenced code block. Reject nested fences that would combine two blocks into one match. The generated JSON marker records the helper name, signature, and zero-argument result or error. The runtime IR retains the shape and omits documentation and emitter-only Item Type tables.

A declared reference substitutes only its reference arm on the owner's immediate object in the declaring root. Keep other branches, including null, and leave nested inline objects alone. Validate that the target path resolves and has each substituted member with an equivalent type and optionality, with the same index signature. Reject an owner that is reachable from another root. Omit definitions reached only through a substituted arm. In reachability tests a self-reference alone does not prove a definition is used.

Check that the source declares the Item Base type and that the extracted contract still has an item-fields index signature. Clear the generated directory before writing the new roots so retired schemas disappear from the diff. The Template Contract version appears in schema identifiers and has its own persisted-version entry. CLI response envelopes version their own contracts. Legacy Template slots use the registry while a Citation Template Document names its root directly.

The verification gate regenerates the template contract, the reference page and its page model, and the Query schema supplies the generated functions and methods page. Fail the gate if these committed outputs differ after generation. Turbo declares the generation inputs and outputs so identical inputs can restore the artifacts from its cache.

The Template Data Export serializes the active Item or Annotation against its contract root. It shares the CLI's `pluginVersion`, `request`, and `zt` fields so the request identifies a reproducible command. Its `templateContractVersion` names the schema of the exported `zt` data. The CLI Contract has its own version. Serialization stops if the committed contract metadata cannot describe the data.

Export accessor formatting, inert placeholder marking and JSON-safe
serialization together so every host reads live Template Data through the
same contract. The extractor follows the root declarations into shared
types, including Annotation kinds, collection paths, dates, Extra and
tags. Keep those descriptions at their declarations as generator inputs.
[Shared Template Data API](../../packages/db/src/template-data/index.ts)

Generate the docs Template Data reference from the Database package's
Template Contract IR.

Keep the synthesized Literature Note manifest's Template Data version
in step with the Database contract version. The Template engine does
not import the Database package to read it.

## Amendment (2026-11-23): the page model is built at generation time

The Template data generator builds the page model from the contract IR and writes its sections to `apps/docs/src/lib/template-contract/generated/page-model.json`. `ContractTable` reads that file for the HTML table and for the GFM edition. The reader's page chunk therefore holds precomputed rows, and the builder and the contract IR stay out of it. The browser does no model work at page load. The verification gate checks the JSON with the other generated artifacts. The model repeats inherited rows that the IR shares, so the page chunk grew from 25.9 kB to 26.7 kB gzip.

Rejected: building the model in the browser with syntax-aware parsers, which adds about 35 kB gzip to the page and parses at page load; small hand-written scanners for code spans and Liquid markup, which copy two grammars into the docs app.
