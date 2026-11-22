# Cite templates use the zt item vocabulary, not raw CSL-JSON

POST_ALPHA §1.4 recommended CSL-JSON field names for the cite-template vocabulary, which implies normalizing the DB leg _to_ CSL (`itemToCSLJSON`-equivalent). We decided the opposite: cite-template items use the same camelCase zt item vocabulary as note templates (`containerTitle`, `creators`, `date`, …), so template authors learn one vocabulary, and the _embedded_ leg (CSL-JSON snapshots in `data-citation-items`) is normalized into zt via a schema-driven reverse mapping (`itemFromCSLJSON`-equivalent, tables generated from the Zotero schema's `csl` section). Citation-scoped properties (locator, label, suppress-author, prefix, suffix) never live on the item; they ride on Citation Items in `zt.citations`, with `zt.items` kept as the derived pure-item array.

## Context worth remembering

- Upstream ground truth (Zotero `editorInstance.js` / note-editor): note citations **never** persist suppress-author, and `citation.properties` is always `{}`. Where Zotero does store suppress-author (word-processor integration), it is per citation-item as `"suppress-author"`. POST_ALPHA's "re-add `properties` to CitationSchema" is therefore refuted — the parser instead accepts the full per-item prop set permissively.
- Zotero's own `itemToCSLJSON`/`itemFromCSLJSON` are schema-driven from `resource/schema/global/schema.json` (`csl.types`, `csl.fields`, `csl.names`) — the same schema `packages/zotero-types` generates from, which is why the reverse mapping is generated, not hand-written.

## Considered options

- **Raw CSL-JSON item data in cite templates** (hyphenated keys, zero mapping on the embedded leg, `itemToCSLJSON` for the DB leg): rejected — splits the user-facing template vocabulary in two (`zt.containerTitle` in note.eta vs `c["container-title"]` in cite.eta) and hyphenated keys are hostile in Eta.
- **Citation-key-only embedded leg** (no reverse mapping): rejected — cross-library and degraded-DB cites would silently render blanks in data-driven cite templates.

## Citation assembly boundaries

Use the live Item, then embedded CSL-JSON, then a citation-key stub. Apply the resolved citation key independently of the data source, since a reference can carry an embedded key and still resolve live Item fields. The narrowed shape omits storage and vault data absent from the snapshot. Keep locators, prefixes, and the other ref-level values on the citation wrapper. Supply defaults for callers with just an Item. The requested variant identifies the gesture and the template chooses its output.

When reversing CSL-JSON, preserve the first declared Zotero creator role for a shared CSL name variable. Resolve text variables with the first valid field mapping. A malformed full date can fall back to its valid year and month, or year alone, as in a live Item. The note importer and the database wrapper share Pandoc's fallback page abbreviation for unknown locator labels.

## CSL input and stored marks

Build CSL-JSON from live Item data using the first populated variable candidate under stored and canonical field names. Prefer a built-in field over a custom field with the same name. Keep the leading ISBN, use event place for Zotero's applicable Item Types, and treat `shortTitle` as an input alias for `title-short`. Preserve Zotero creator order, with the Item Type's primary creator mapped to `author` if that role has no explicit CSL mapping. Convert structured personal names with Zotero's particles and suffixes, and normalize the citation processor's Extra-field syntax. [Zotero CSL conversion](https://github.com/zotero/utilities/blob/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3/utilities_item.js#L51)

Use the persistent Item URI as the CSL id, with the Indexed Key as fallback when no account identity exists. Keep unparseable dates as a literal of the user's text and fall back to month precision for an invalid day. Give a bare SQL calendar date the empty text tail the multipart parser expects. In the differential corpus, omit the database-id comparison and test local-calendar conversion of the access date separately. Convert the corpus's string date parts to numbers before comparing. The fixture adapter maps native JSON fields to Zotero's physical field names and SQL date forms.

Decode the URL-encoded citation and annotation marks independently of the DOM. Keep identifiers and citation options that the importer uses. Skip an invalid mark so it cannot abort the import. Resolve a citation using the first URI that identifies an Item. Use the Attachment URI for an Annotation's Library because they share it. Index embedded CSL-JSON snapshots by each listed URI, preserving their open fields for references the live database cannot resolve. An absent or malformed snapshot returns an empty map. [Zotero mark serialization](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/editorInstance.js#L1614-L1652)
