---
status: accepted
---

# The built-in export cites what Pandoc reads

The built-in export reads the document with Pandoc before it resolves anything. The sandbox filter turns each Literature Note wikilink into a Citation that names its Item by an Injected Id, and Pandoc's own reader supplies every literal `@citation-key` Citation. An Injected Id starts with a character no Pandoc citation key can start with, so the two identities share no spelling and one Item's Indexed Key is never read as another Item's Citation Key. That one prepared document is the export's complete Citation set, and the same prepared document is what citeproc formats.

Each cited Item then takes one canonical CSL `id`: the Citation Key the author wrote, where a literal Citation named the Item, and otherwise the `id` its bibliography source gave it. The prepared document's Citation ids are rewritten onto that canonical id before citeproc runs.

This decision keeps the export's own membership contract, which ADR-0022 leaves to it. It settles how that membership is decided.

## Consequences

- Both Citation Syntaxes reach the bibliography. A note that cites only literal Citation Keys exports with formatted citations and a bibliography.
- Membership has one implementation, and it is Pandoc's. A Citation Key inside code, inside an escape, or inside any other construct Pandoc reads as ordinary text is no Citation of the export, with no second scanner to agree with.
- A `nocite` metadata Citation is a Citation of the document, so its Item reaches the bibliography without taking a number in the prose. Pandoc's `nocite` wildcard names no work: it resolves to nothing and reaches citeproc as the document wrote it.
- An Item cited as a wikilink and as a literal Citation Key collects one bibliography entry.
- A literal Citation Key that names no live Item in the Library Scope, or that several Items answer to, stops the export and names the keys. The alternative is Pandoc's undefined-citation output — a bold key and a missing entry — inside a document the user is about to send somewhere.
- Literal Citation Keys resolve through the citekey resolution snapshot, so an export cites what Live Preview shows, under the same Library Scope.
- Every Citation of the rendered document has bibliography data, checked against the document itself before citeproc runs. A document that fails the check writes no output file.
- An export runs two conversions rather than one. The prepared document stays inside the engine between them.
- The Native Pandoc Workflow keeps its own contract: its filter variant resolves through `zotlit:resolve`, and the user supplies its bibliography.

## Considered options

- **Add a literal-citekey scanner to link-based discovery**: fixes the reported case, but keeps two implementations of what a document cites, and any Citation the scanner and Pandoc read differently stays a defect waiting to be noticed.
- **Check the rendered output for unresolved citations**: reports the same defect later, after citeproc has already written it, and reads Pandoc's rendering rather than the document.

## Citation Fragment validation in Live Preview

The Lua filter in `packages/citations/src/core/pandoc/filter/zotlit-cite.lua` and the TypeScript parser in `packages/plugin-kernel/src/citation-fragment.ts` apply the same validation rules in the same order. A rejected value gets the same reason in both paths. Live Preview leaves the link as raw text when export would reject it.

Both parsers percent-decode each value byte by byte, then validate UTF-8. This gives malformed escapes and invalid UTF-8 distinct errors. Each parameter is recorded only after its value passes validation, so duplicate checks mirror the Lua filter's `seen` table. Both parsers check whitespace, line breaks and controls on code points, as the amendment "one code-point contract for Citation Fragments" states. [Unicode validation](https://github.com/aidenlx/zotlit-repo/issues/41)

A resolved Literature Note uses the native Zotero citation key from the Citation Index. If the key is absent or empty, Live Preview derives one from the note's filename without the extension. A link without a fragment uses normal mode. The caller handles subpaths outside the `cite:` syntax.

For previews that build Pandoc source, TypeScript prepares locator abbreviations from the [CSL en-US short forms](https://github.com/citation-style-language/locales/blob/v0.0.97/locales-en-US.xml). A locator with no label uses the page form. The parameter and mode tables use exhaustive records so a new value requires a matching parser entry.

## Lua citation and Markdown conversion

For wikilink paths, the filter decodes valid percent escapes and leaves
a bare percent sign literal. Citation Fragment values use strict percent
decoding and UTF-8 validation. The Lua and TypeScript tests share a
fragment corpus. The filter records issues across the document before
stopping, and caches classification by link target so retrying a failed
Citation Run member does not duplicate the diagnostic.

One inline-list pass turns same-line, semicolon-separated links into
one Cite. Spaces can surround the separator, and a soft line break ends
the run. The pass applies to inline lists throughout the document.
Locator labels enter the Citation suffix because citeproc interprets
them there. The filter's label table follows citeproc's parsed terms.
Additional CSL labels that citeproc would pass through as literal text
stay outside that table.

The same walk converts Obsidian callouts to block quotes. It removes the
marker and keeps any custom title as a bold first line. A break on the
marker line separates the title from the body. Ordinary block quotes
keep their original shape.

When the sandbox injects markers for literal citation selection, it
reparses the original Markdown without those markers to assign heading
identifiers. This lets Pandoc handle collisions with explicit IDs.

## Preview inputs and language tags

The shared fragment fixture ties the TypeScript parser's results and error reasons to the native Pandoc filter's output. Its plain output describes citeproc's rendering of the same fixture link, under the fixed Doe 2020 case.

The wikilink derivation starts from the note target and checks the same Literature Note identity as the Citation Index. Heading links, block links, and subpath-only links keep their native meaning. The preview validates the derived citation source and leaves the original link visible if the source cannot be formatted. A filename-derived citekey is display text and may repeat for two works. Indexed Keys identify the rendered works, even when their displayed keys match.

The preview builds each Citation Run from the surface's links in document order. A link that produces no citation ends the run. The surface can also end the run at a paragraph or container boundary. Match the Pandoc separator by allowing spaces or tabs around the semicolon and ending the run at a line break.

The vault's Citation Locale and a document's Language use the same BCP 47 grammar. It accepts case-insensitive grandfathered, extended, and private-use forms, as well as extension sequences such as a Unicode collation preference. The grammar checks subtag shape first. A second pass rejects duplicate variant subtags and extension singletons. Private-use subtags may repeat. The Document Language is standard Pandoc `lang` metadata and also supplies the document's citation locale. The document's Zotero CSL ID takes precedence over the vault style. [BCP 47 grammar and constraints](https://www.rfc-editor.org/rfc/rfc5646#section-2.1) · [CSL locale fallback](https://docs.citationstyles.org/en/v1.0.2/specification.html#locale-fallback)

## Amendment: one code-point contract for Citation Fragments

Accepted 2026-11-23 with [#41](https://github.com/aidenlx/zotlit-repo/issues/41) and [PR 249](https://github.com/aidenlx/zotlit-repo/pull/249) (`2f60e7583`). The byte classes of Lua (`%s`, `%c`, `%S+`) depend on the C locale: native Pandoc under `C.UTF-8` rejected values that the Resource Pack's pandoc-wasm accepted, and the TypeScript parser checked UTF-8 bytes. After percent decoding and strict UTF-8 validation (U+FEFF stays, surrogates are rejected), the TypeScript parser and the Lua filter now check code points in this order:

1. An empty value.
2. A first or last code point in Unicode White_Space: edge whitespace.
3. U+000A, U+000D, U+0085, U+2028 or U+2029: a line break.
4. A Cc code point (U+0000 to U+001F, U+007F to U+009F): a control character.

The Lua filter splits values into Pandoc words on ASCII whitespace only, on every path that converts text to inlines. Values such as `voil%C3%A0`, a euro sign or an ideographic space parse the same way in the TypeScript parser, native Pandoc and pandoc-wasm. The shared Citation Fragment fixture defines the cases, and both suites run it.

Accepted limits:

- Each language holds the code-point lists as literals in its own file. The shared fixture keeps the two lists in agreement.
- Live Preview was checked at the data level only, through the wikilink citation parser, with no desktop run.
- The editor and the note scanner trim and NFC-normalize a raw link target before the parser receives it. A raw edge space and an encoded edge space can therefore give different results at those entry points.
