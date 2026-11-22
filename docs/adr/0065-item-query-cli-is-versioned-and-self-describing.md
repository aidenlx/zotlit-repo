# Item Query CLI is versioned and self-describing

> Amended 2026-10-16: `format=csv` or `format=tsv` beside `output` writes one delimited line for each row to the file in place of the JSON envelope, with `file.format` naming the format; the CLI answer stays JSON. This is an addition to version 3.

> Amended 2026-10-10 by ADR 0071: contract version 3 exposes one `zotlit:query` command with `from=`, comma-list `fields` and `sort` beside the JSON form, one `library` argument, `group=`, and selection through the filter alone.

> Amended 2026-10-09: contract version 2 keeps every version-1 field of a diagnostic and adds the Diagnostic Report, the structured excerpt, what was found and expected, suggestions, severity, and `warnings` on a successful answer. Version 2 grows by additions without a bump; a changed meaning of an existing field bumps. See ADR 0070.

The Obsidian CLI exposes Item Query through flat arguments and returns the established ZotLit JSON envelope: an independent Item Query `contractVersion`, `command`, and `ok`, followed by command-specific top-level fields. Query success adds the existing Workbench source identity, the stable Target Libraries, the normalized request, `returnedCount`, `truncated`, and Query Rows. `fields` is a JSON array of Projection Path strings, and `sort` is a JSON array of `{ field, direction }` objects. These encodings preserve punctuation in custom field names without a second escaping grammar. A tiered guide and a machine-readable schema expose the current fields, relations, functions, and types from the same registries that the query command uses.

The schema command returns a version-pinned `schema` download (`url` and `fileName`), source identity, live `customFields`, and CLI `defaults`. The package build generates the static catalog of fields, functions, methods, properties, and types from the execution registries. Release CI stages `item-query.schema.json` on the matching Resource Release and verifies its public bytes before publishing the plugin, following ADR 0019. Static catalog generation lives in a build-only package entry; the runtime reads only custom-field capabilities. Agents download the catalog once and inspect selected entries locally with `jq`. Development builds use the catalog generated from their own checkout.

The Item Query wire contract starts at version 1 and evolves independently from the Template Contract. The CLI defaults to 100 rows in descending modification order and accepts `limit=all` for a complete result; the normalized request represents this as `limit: null`. Supplied numeric limits are positive integers. The package interface remains unbounded when the caller omits a limit.

An omitted filter matches all Items; an explicitly empty filter is invalid. An omitted `fields` argument uses the default projection, while `fields=[]` returns identity-only rows. A limited result reports `returnedCount` and `truncated` and does not compute an exact total. The engine orders every result in memory and keeps one extra matching Item to prove truncation.

When `fields` is absent, each row projects `itemType`, `title`, `creators`, `date`, and `dateModified`; Indexed Key is always present as row identity. The query schema reports the JSON type and filter, projection, and sort capabilities of each field or path, including custom fields from the active Zotero source.

A query reads a set of Target Libraries. With no Library argument, the set is the available Libraries of Library Scope, so a query reads what ZotLit searches. `library` names one Library as `personal` or `group:<groupID>`. `libraries` names a set as a JSON array of those selector strings, each Library once, or as the word `all` for every local Library; a named Library can be outside Library Scope. When a call has both arguments, `libraries` decides and `library` has no effect.

The envelope reports `libraries`: a list with one entry for each Target Library, also for one Library, in the canonical order of Library Scope (My Library first, then groups by ascending group ID). Each entry is `{ type: "personal" }` or `{ type: "group", groupID, name }`; local database `libraryID` values never enter the CLI contract. The normalized request carries the same Libraries as selector strings, so it shows how the default, `all`, or `library` was applied. The CLI converts request, source-readiness, Target Library, and known database-access failures into the standard diagnostic envelope. A named Library that the source does not hold is `library-not-found`; a Library Scope with no available Library is `no-library-available`. The default resolves with the rule of the Library Scope service on Library rows from the layout-checked Item Query reader, so it holds on every database copy that Item Query can read. Cancellation and implementation defects remain distinct failures. The guide follows the Workbench convention of tiered literal-English text, while query and schema success always use pretty JSON.

A query's inline response is bounded to 1 MiB of UTF-8 JSON. Larger results use an explicit `output` argument with an absolute path to a new file. The file contains the complete response envelope; the CLI receipt has the same metadata and a `file` object (`path`, `bytes`, and `format: "json"`) in place of `rows`. Publication exposes a complete file and preserves an existing destination. This keeps large result strings out of Obsidian's renderer and CLI transport. The guide gives the limit and recovery command through `result-too-large` and `output-error` diagnostics.

## Delimited export bytes

`packages/shared/src/delimited.ts` writes CSV with CRLF and a UTF-8 byte order
mark for Excel. It writes TSV with LF and no byte order mark for spreadsheet
paste. The streaming writer emits the mark once, then emits terminated rows
without inserting a mark between chunks. The UTF-8 mark is constructed from a
code point because the formatter writes its string escape as a literal mark.

## Catalog and active-source schema

Generate one static catalog per plugin version from the same dataset descriptors and language registries used by the planner. Keep the functional capability and description strings in those registries. The catalog shares function, method, property, and type definitions across datasets. The live response adds active custom fields and dataset defaults. A null limit means all matches.

Derive each path's filter capability by planning its text. List index samples use index zero. A path with an Item-dependent filter type reports `any`, and a path that cannot be filtered reports null. A filter-only name that matches an already-described nested projection path keeps that path's projection and grouping capabilities. Report dates and durations as ISO strings in JSON rows. Include bounds on typed parameters, such as nullability and a closed set of string values, and publish the names that element-expression methods bind.

Schema tests run the advertised capabilities through real query validation against a scenario shared by read-only cases. Supply valid literals for the registry parameter types and closed sets so each advertised call is checked with legal arguments. Function, method, and property descriptions are single sentences.

Use the same function signature formatter in the reference, completion list, and Signature Hint. Render required, optional, and rest parameters in order. Show closed text values or the accepted types, including null when allowed. Show a varying return type as `any`.

## Renderer decoding and export contract

Decode flat CLI arguments once in the renderer and pass plain JSON to the worker. A list can be a comma list or a JSON array. Ignore commas inside quotes or bracketed Projection Paths. Require named Libraries once each and sort them canonically, with My Library first. Use the borrowed copy to resolve selectors. The public Library identity stays independent of its local numerical database ID. Formula names are caller text, so use a dictionary without a prototype.

Share command parameters and defaults with the guide. Render command, flag, guide, and diagnostic text in English under the CLI text policy. A guide response is plain text unless a topic is rejected. Keep the structured envelope for a rejected command and for the immediate reply to a file export. CSV and TSV require an output path. Emit one delimited line per group membership with the same value formatter as the Query View.

Build the guide's examples through its command and Filter Expression helpers. Collect those examples and run them against a real source in tests. Share the topic registry between parsing, generated help, and the index. Use the same parameter constants and defaults in the synopsis and handlers.

The Template Workbench CLI shares selector vocabulary between request validation and the guide so accepted values and examples use the same words and order.

### Desktop command and export proof

Dispatch through Obsidian's registered CLI, including its required flags
and normalization of format aliases. The omitted Library argument reads
the available Library Scope. A named range can arrive in any order.
Exercise regex and Creator element expressions through installed Bases
helpers. A held Snapshot can coexist with a new query of the changed
source, including an integer beyond JavaScript's exact range.

Check a file export against the same query and preserve an existing file.
A grouped CSV places the group column first and uses a BOM with CRLF.
TSV uses LF without a BOM. A response without a file uses JSON. A failed
projection produces an Error Value cell, while a failed filter excludes
the Item. A multi-tag Item can appear in multiple groups. Own this
case's Fixture Vault so linked Attachment paths remain valid. Verify
corrections, ordered suggestions, successful warnings, and the legacy
report boundary in serialized output. Use the same lexical collation
in Electron and Node.
[Desktop Query cases](../../packages/e2e/src/query-cli.e2e.ts)
