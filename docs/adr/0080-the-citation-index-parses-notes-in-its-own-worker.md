---
status: accepted
---

# The Citation Index parses notes in its own worker

The Citation Index will also index every Durable Annotation Link in the vault, so "where is this Annotation used" and its backlinks can be answered. Obsidian's metadata cache cannot carry these links. Its worker drops every link whose URL contains `:` and does not start with `./` or `../` (`worker.js:7770` in 1.14.4). That happens in every form (`[p. 42](…)`, `[](…)`, `![](…)`) and in every place, and no API lists external links per file. ZotLit therefore parses notes itself. One parse finds Pandoc citations, Wikilink Citations and Annotation Occurrences. It runs in a dedicated worker over a trimmed `@lezer/markdown` grammar, and the renderer keeps the index.

Amends the parse side of the Citation Index. [ADR 0073](0073-the-citation-index-reads-in-the-zoteroreads-worker.md) still owns citation reads. The worker yields through bounded in-flight requests, not the 20-file chunks that follow [ADR 0050](0050-chunked-work-yields-via-messagechannel.md).

The layer starts the parse worker at workspace layout-ready and owns it through its Scope. Keep requests untraced because the index sends one per note. In tests, drive layout readiness through the in-memory workspace and substitute the worker boundary so the harness needs no host bundle. The test owns the ManagedRuntime and disposes it through its Promise API. Fork the parse request as a child so a caller can cancel its own request while the worker continues serving other callers. [Parse service](../../packages/citations/src/obsidian/citation-parse/service.ts) · [Parse fixture](../../packages/citations/src/__fixtures__/citation-parse.ts)

## Why

- **One parse, one exclusion rule set.** Today citekeys come from `maskExclusions` plus `maskWikilinks` plus the Pandoc grammar, and wikilinks come from the metadata cache. The two sources disagree about `%%` comments, because Obsidian records links inside comments. Pandoc export has a third copy of the rules. The masks also approximate CommonMark. They miss code nested in quotes, callouts and lists. They mask `$5 [@k] x$`, ignore `\$`, honour `\` inside wikilinks, and read code spans on one line only.
- **The main thread should not parse Markdown.** Obsidian already parses every note in its own worker. It keeps a main-thread parser only for canvas text under 5,000 characters (`app.js:177815`). ZotLit's backfill and every `changed` event parse on the renderer today.
- **The superlinear citekey scan is a grammar bug, not a reason for the worker.** `scanNormalCitations` (`packages/templates/src/pandoc-citation.ts:426-440`) scans every key in the document for every `[`. That makes it O(brackets × keys), whatever the note's length: 12 ms at 1,000 citations, 120 ms at 4,000, 470 ms at 8,000. The `keys.filter` at `:646` and the key-against-exclusion check at `:413-418` add smaller quadratic terms. The fix is local and still needed, because export and the editor read the same grammar. With it fixed, the linear masks still cost about 17 ms per million characters. The backfill pays that for every note.

## Decision

### What a parse records

- **Annotation Citation.** A Durable Annotation Link whose text is exactly empty (`[](zotero://…?annotation=…)`, also `[](<zotero://…>)`) is a Citation of the Annotation's parent Item, with the page label as its locator.
- **Annotation Occurrence.** Every Durable Annotation Link is an Annotation Occurrence, in one of three forms:
  - citation: `[]`
  - labelled: any other text, including whitespace-only text, and `<zotero://…>`
  - embed: `![…](…)`
- **Not recorded:** bare `zotero://` text, reference-style links, HTML `<a>`, and Attachment File Links with an Annotation Anchor (`file://…#zt-annotation=…`).
- **Malformed citation-form links.** An empty-text `zotero://open/` link that `parseAnnotationOpenUri` rejects is recorded as a malformed Annotation Citation and shown as a Reference Error, mirroring malformed Citation Fragments. An attachment-only link is one case. Other forms that fail to parse are ordinary links to Zotero and are dropped.
- **Classifier.** One worker-safe classifier decides the form. The scanner and the Reading view and Live Preview renderers of [#1678](https://github.com/aidenlx/zotlit/issues/1678) import the same module.
- **Identity.** Occurrences are keyed by the Annotation's Indexed Key, which also covers group Libraries.
- **Wikilink Citations come from this parse too.** They are stored like the other sources, not derived from the metadata cache.

### What a parse excludes

Code (fenced, indented, inline), math (`$…$`, `$$…$$`), `%%` comments and frontmatter are excluded for every source. **The index records what the rendered and exported document references.** Obsidian's backlinks include links inside `%%`. We treat that as Obsidian's flaw and do not copy it. Frontmatter properties are metadata, so their links are not recorded.

### The parser

- **Trimmed `@lezer/markdown`,** already a dependency of `apps/obsidian`.
  - Remove only the inline presentation parsers `Emphasis`, `HardBreak`, and `Entity`. Keep every block parser so headings, rules, and reference definitions preserve the boundary before indented code.
  - Keep `HTMLBlock` so a wikilink in raw HTML stays unindexed, as in the remark-obsidian parity corpus. Keep `HTMLTag` to parse `<url>` autolinks.
  - GFM stays off, so bare URLs are not links.
- **Obsidian-specific extensions only where they change extraction:**
  - wikilinks and embeds (one line, `\` does not escape)
  - `$`/`$$` math (`$` does not open before a digit or a space; `\$` escapes)
  - frontmatter, which opens on a first line of exactly `---` and does not count if never closed
  - `%%` comments, a post-pass outside code nodes, because a comment pairs its markers across container boundaries
- **Reference for Obsidian's behaviour:** `quartz-community/remark-obsidian`, which is tested against Obsidian 1.14.
- **Lezer quirk:** `[@key]` parses as a `Link` with no `URL` child. The scanner treats such a link as text, and the Pandoc grammar reads the text ranges.
- **Retired:** `scanDocumentCitations`, `maskExclusions` and `maskWikilinks` leave the index and export paths. The editor's single-line lookup (`editor-lookup.ts`) stays synchronous on the main thread.

Index delimiter runs per paragraph to avoid rescanning a suffix for repeated unmatched openers of the same width. Consume runs of plain characters together and skip the parse for simple prose with no possible references or export ranges. When display math in a container has no closer, restore the original block structure so later code still masks its citations. Inline code and links keep ownership of their dollar signs.

Decode Markdown link punctuation and character references in one pass so an escaped ampersand cannot start a new reference. Leave invalid percent encoding literal. Treat a no-break space before a quoted title as a separator. Give the shared Annotation classifier the destination after the caller parses the Markdown syntax. Keep a link label masked while recording any nested images or wikilinks.

Return unresolved occurrences with half-open UTF-16 positions. Retain raw links before Citation eligibility and complete Pandoc groups for author-in-text rendering. Export-only ranges are transient. Preserve container prefixes when export adds a blank line before a fence. Mask code before pairing `%%` markers across quote and list boundaries, and merge overlapping ranges before copying the text so each span appears once. [Citation scanner](../../packages/citations/src/core/citation-index/scan-note.ts)

### Who owns what

- **The worker is a stateless parser.** It is a new embedded worker, separate from ZoteroReads, and long-lived from layout-ready. On failure it restarts with backoff, and there is no main-thread fallback. Requests are `{path, generation, text}` in and one file's record out.
- **The renderer owns everything else:**
  - intake: `changed` text, `deleted`, `rename`, and the backfill walk through `cachedRead`
  - generations: a later `changed` makes an in-flight result for that path stale
  - the IndexedDB store, with the renderer as the only writer
  - in-memory reverse maps rebuilt from records: citekey to files, and Annotation Indexed Key to `{path, occurrence}`
  - The backfill keeps a bounded number of requests in flight.

### The store

- **Record shape.** One record per file: `{path, mtime, size, scannerRevision, citekeys, wikilinks, annotations, malformedAnnotationCitations}`.
- **Versioning.** `SCHEMA_VERSION` 2 discards the old records once. After that, a grammar fix bumps `scannerRevision` instead. Stale records keep serving until the backfill rescans them, the same way an mtime or size mismatch is handled.
- **Clearing.** Reset Citation Index clears the store.

Use one IndexedDB database per Obsidian app ID and update one path record at a time. Record the file's modification time and size at scan time. The store is derived, so a missing record costs a rescan. A schema upgrade recreates the store, and the backfill reconstructs it. Register both schema and scanner versions for the release check. [Citation store](../../packages/citations/src/core/citation-index/store.ts) · [Format version registry](../../packages/scripts/lib/format-versions.ts)

### Resolution and membership

- **Lookup on demand.** `CitationLookupRequest` gains `annotationKeys`. ZoteroReads answers them against the published revision as `{parent Item Indexed Key, citekey}` or missing. Occurrences stay raw.
- **New choice.** **Annotation Citations** joins Pandoc Citations and Wikilink Citations as a Document Citation Set choice. The current setting defaults to off.
- **Export.** Pandoc export reads the worker's parse and cites exactly the worker's citations. A Pandoc `Cite` the worker did not report renders as its source text. Export drops each worker-reported `%%` comment, preserving a blank line for whole-line block comments and joining the surrounding text for inline comments. What export emits for an Annotation Citation is left to a follow-up issue linked to [#1678](https://github.com/aidenlx/zotlit/issues/1678). Until then export leaves the link untouched.

### Evidence

- **Tests.**
  - `createCitationIndexHarness` stays the main seam, with an in-process twin of the parse worker, as ZoteroReads already has.
  - A conformance table, text in and occurrences out, covers the parse rules, with cases from `remark-obsidian`'s parity corpus.
  - One end-to-end smoke test runs the real worker.
  - The grammar fix gets a scaling test: doubling the citation count must not quadruple the time.
- **Performance gate.** A committed benchmark (10k, 100k and 1M characters; dense and sparse; with and without links) must show:
  - linear parse time
  - under about 100 ms in the worker for a 1M-character note
  - fixture backfill worker/legacy ≤ 1.0, evaluated as the median of three in-process comparisons; each comparison uses the worker median divided by the legacy median, with three warm-ups and 15 measured samples per path
  - under 2 ms of renderer work (post plus apply) per `changed` at 100k characters

## Considered Options

- **Reuse the metadata cache.** Impossible: it drops every `zotero:` link. Its `referenceLinks` keep only reference-style definitions, which ZotLit never writes.
- **Hand-rolled single pass:** today's masks fused with link extraction. Cheapest, but CommonMark nesting would still be approximate and patched one edge case at a time.
- **Trimmed micromark/mdast,** the family Obsidian uses. Closest to Obsidian's output, but a new and heavier dependency.
- **Parse in the ZoteroReads worker.** A backfill would queue behind SQLite statements and Item search, which ADR 0073 holds to p99 ≤ 16 ms and max ≤ 32 ms, and it would fail with them.
- **Worker owns the backfill and store, reading files through Node `fs`.** This bypasses the vault adapter and `cachedRead`, and makes the store two-writer or a mirror. The renderer cost it saves is one read and one post per file.
- **Include `%%` with a context flag.** Rejected with the principle above: a comment removes text from the document.
- **Preload every Annotation-to-parent mapping into the snapshot.** Publish time and worker memory would grow with the annotation count, mostly for annotations no note cites.
- **Store the parent Item at scan time.** A moved Annotation would stay stale until the note is touched.

## Consequences

- **The citation sidebars become async on first open.** References, Cited By and In-text Citation Rendering wait for the parse result of a document that has just changed. Persisted records cover cold start and worker restarts.
- **Memory and bundle.** An extra worker costs about 18 MiB of baseline heap (measured in ADR 0072). The worker bundle carries lezer.
- **Wikilink Citations change behavior.** A wikilink inside `%%` no longer counts as a citation.
- **Annotation embeds are indexed before they render.** `![](…)` is indexed now. How it renders stays with [#1678](https://github.com/aidenlx/zotlit/issues/1678).

## Worker build and measurement

The worker serves the same stateless RPC parse handler as the in-process path. Keep the service span and skip transport spans because the latter add work during backfill. Launch the server at the worker lifetime boundary.

Encode the scanner's record once as JSON. RPC carries the string in its success envelope, and the plain client decodes it once. The in-process fixture uses the real handlers on an in-memory protocol pair and closes both ends with the call's Scope.

Each connection owns one worker and one RPC client. RPC owns request IDs, replies, and interruption. Parse requests transfer no owned buffers. The connection Scope revokes its object URL and terminates the dedicated worker, since the platform layer only sends a port close message. Observe worker errors and message errors as connection death even when no parse is waiting. Buffer early messages until the RPC listener is attached.

On death, publish the new availability wait before releasing requests from the old connection so retries join the replacement. Keep the attempt and its deadline in the client lifetime Scope, so a caller that abandons a note cannot prevent recovery from a stalled worker. Instrument codec encoding in the send fiber for benchmarks. Leave the unobserved codec on the production path. [Parse RPC client](../../packages/citations/src/core/citation-parse/worker-client.ts) · [Worker connection](../../packages/citations/src/core/citation-parse/worker-host.ts) · [Recovery](../../packages/citations/src/core/citation-parse/recovering-client.ts)

The Node harness builds the RPC client through Vite as well as the embedded worker. The synthetic client entry sits under the script scope so it receives the Effect renderer entry. Start the Node worker inside the RPC spawner so its ready message cannot run ahead of listener attachment. Test malformed input through the RPC decoder and then send valid input to check recovery. Warm the worker before measuring reply posting to avoid counting readiness buffering. The clock fixture separates client encoding from the actual post. [Production worker entry parity](https://github.com/aidenlx/zotlit-repo/issues/98)

Run the host benchmark on an idle machine with `mise exec -- pnpm --filter @zotlit/obsidian bench src/services/citation-parse/scan-pipeline.bench.ts`. Each cell uses three warm-ups and 15 measured samples. A 10x increase in note size permits a 15x increase in median parse time. The benchmark writes each sample, hardware and Node details, and gate outcomes to `.scratch/scan-pipeline-bench/results.json` before reporting a failure. Dense and sparse paragraphs repeat the same sentence two or 30 times, with a citation per paragraph, a callout every fifth paragraph, and a fence every 25th. The stated sizes count UTF-16 code units.

The worker's parse duration excludes message transport. The round-trip sample includes transport. The host post-and-apply sample adds request encoding and posting to the time from reply receipt until the index returns the applied scan. It uses memory persistence and changes citation membership on every edit to exercise reverse-map updates. This sample is diagnostic. The desktop test measures renderer work with the real host and storage.

Use the same CPU-time harness for unmatched math and dense Pandoc Citation scaling. Alternate input sizes and use the lowest of repeated samples to reduce timing noise. Compare the smallest input and an input eight times as large. The threshold of 20 separates the expected linear factor of eight from the quadratic factor of 64 with room for measurement variance. [Math scaling test](../../packages/citations/src/core/citation-index/scan-note-scaling.test.ts) · [Pandoc Citation scaling test](../../packages/templates/src/pandoc-citation-scaling.test.ts)

Generate the backfill Fixture in a Node process so the plugin TypeScript program stays outside the Fixture's Node-only dependencies. Both paths read the same warm files through the same host adapter and use memory persistence. Setup and filesystem cache warming take place before timing. Alternate the path order to reduce the effect of warm runs. The legacy loop follows the parent of `14d461b93`: read, scan, and store sequentially, yielding every 20 files. That loop read wikilinks from metadata at query time and did not maintain reverse maps or annotation records.

The benchmark's legacy scanner is the citekey-only portion of `scan.ts` from `d19be4dbd`. Keep its behavior as a baseline. Its exclusions preserve offsets and line breaks, use four-column tab stops, and distinguish list indentation from code. Closed frontmatter and fences are masked. Inline exclusions advance the cursor to the last masked character, or past the opener when a span stays open. Single-dollar math stays within one line and requires text next to both delimiters, so the price pair `$5 and $6` stays prose. The host and desktop scan budgets share the same synthetic note generator and its fixed UTF-16 length. [Legacy scanner](../../packages/citations/src/__fixtures__/citation-index/legacy-citekey-scan.ts) · [Benchmark input](../../packages/citations/src/__fixtures__/citation-index/scan-pipeline-note.ts)

## Parity corpus

The fixture keeps Obsidian 1.14.4 Markdown verbatim and extracts the link and embed facts from each retained golden case. In a golden fact formatted `RAW=>TARGET|DISPLAY@L:C-L:C`, parse a Wikilink target up to the first pipe and a Markdown destination up to the last pipe. Mark embeds from the embed list, convert the line and column to UTF-16 offsets, and sort by start offset. Project the simple, unaliased, unembedded Wikilinks to record expectations. Those Wikilinks have a nonempty path and no subpath. Use the same normalized target for Citation identity as for link facts. [Pinned Obsidian goldens](https://github.com/quartz-community/remark-obsidian/blob/a80395a3d80f351e67a0afdb63b51a604e010c8e/test/parity/goldens/obsidian.json) · [Corpus fixture license](../../packages/citations/src/__fixtures__/citation-index/scan-note-corpus.LICENSE)

Retain cases with at least one possible reference marker. The extraction omitted 836 rows without one. The corpus tests compare complete occurrence records for all retained rows. Explicit alternatives supply worked expectations for intentional differences, including hidden comment links, bare URLs, and a Pandoc Citation in the escaped email case. A record-only difference keeps the golden link facts. External URLs are absent from the Obsidian cache facts, so supplement them with Annotation cases. Insert reference payloads in upstream code and math examples to show that all forms remain hidden. Use worked coordinates and a visible tail after a closed hidden region so a test also checks where parsing resumes.

The adapted scanner tests retain these source cases by topic. [Pinned parity cases](https://github.com/quartz-community/remark-obsidian/blob/a80395a3d80f351e67a0afdb63b51a604e010c8e/test/parity/corpus.ts) · [Scanner tests](../../packages/citations/src/core/citation-index/scan-note.test.ts)

- Containers and math boundaries use `probe/math-marker/dash-then-opener`, `probe/math-unclosed/callout-title`, `probe/math-unclosed/quote-same-line`, `math/in-blockquote`, `math/text-after-close`, and `probe/math/display-same-line`.
- Nested references use `probe/cross/highlight-wikilink`, `probe/label-wikilink/after-plain-bracket`, `probe/footnote-embed/ref-wikilink`, `context/footnote-definition/wikilink`, `probe/footnote-embed/inline-wikilink`, and `probe/label-precedence/wikilink-inside`.
- Link boundaries use `html/passthrough`, `token/wikilink/newline`, `probe/wikilink-destination/closer-before-paren`, `token/wikilink/escaped-close`, `probe/escape/wikilink-opener`, and `probe/wikilink-destination/paren-inside`. A backslash cannot escape the closing pair of Wikilink brackets.
- Math delimiters use `probe/math/wikilink-inside`, `math/currency`, `probe/math/currency-pair`, `probe/math/inline-padded`, `probe/math/escaped-dollar`, `token/inline-math/escaped-close`, `probe/math/inline-across-line`, `probe/math/display-same-line`, `probe/math/display-own-lines`, `math/empty-block`, and `probe/math/display-open-only`.
- Frontmatter uses `frontmatter/closing-line-trailing-text`, `frontmatter/wikilink-value`, `frontmatter/unclosed-fence`, and `frontmatter/indented-opener-is-not`. Require an exact closing delimiter so an unclosed block remains prose.
- Comments use `comment/inline`, `comment/block`, `comment/unterminated`, and `probe/quote-comment/crossing-text`.

Check legacy syntax cases to preserve Citations that should keep working. Assert the intended scanner differences with expected output from the current scanner. Keep export range checks for notes with no citation opener.

### Desktop renderer measurement

Measure the production changed event through renderer task CPU.
Include reply deserialization, recovery, occurrence map updates,
and IndexedDB serialization. Worker CPU, disk work, and idle waits
are outside it. Synchronous IPC and the harness add renderer work.
Report the same-text floor without subtracting an estimated
baseline. A readonly transaction queued behind the write bounds
the persistence interval. Check its record after timing, and
profile separately to avoid sampling overhead in the gate.
Replace a citation with a same-width citation so the benchmark
changes membership without shifting later positions. Send the
public intake event to exclude editor and Obsidian Markdown work.

The current gate uses the median of 15 samples and reports the
90th percentile separately. Shared-process release runs observed
dense medians up to 6.06 ms. Two garbage collection spikes raised
one sparse 90th percentile to 3.9 ms over a 1.8 ms median. The
original renderer target is tracked in [issue 181](https://github.com/aidenlx/zotlit-repo/issues/181).

Test recovery by crossing the real worker boundary. After restart,
check shifted occurrence offsets to prove that the new worker
parsed the edited note.

[Renderer measurement](../../packages/e2e/src/citation-scan-measure.ts) ·
[Citation scan proof](../../packages/e2e/src/citation-scan.e2e.ts)

## Scaling measurements

The scanner scaling test measures thread CPU time. Runners can report that clock in whole milliseconds or coarser units. Repeat each sample until it has used the minimum CPU duration so a small input's timing remains measurable. The Pandoc citation scaling test uses the same method.
